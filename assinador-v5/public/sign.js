/* Página do destinatário (aberta pelo link recebido) */
const token = new URLSearchParams(location.search).get('t');
const vals = {};
const boxes = new Map();
let D = null, pageObjs = [];

const call = async (method, path = '', body) => {
  const r = await fetch(`/api/sign/${token}${path}`, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  if (path.startsWith('/pdf')) return r.ok ? r.arrayBuffer() : Promise.reject(new Error('Não consegui carregar o PDF.'));
  if (path.startsWith('/final')) return r.ok ? r.blob() : Promise.reject(new Error((await r.json().catch(() => ({}))).error || 'Erro'));
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Erro ' + r.status);
  return d;
};
const initials = n => n.split(/\s+/).filter(Boolean).map(w => w[0].toUpperCase()).slice(0, 3).join('');
const today = () => new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
const AUTO = ['date', 'name', 'email'];

function showError(msg) { $('#loading').classList.add('hide'); $('#app').classList.add('hide'); const e = $('#error'); e.textContent = msg; e.classList.remove('hide'); }
function banner(msg) { const b = $('#banner'); b.textContent = msg; b.classList.remove('hide'); }

(async function boot() {
  if (!token) return showError('Link inválido.');
  try {
    D = await call('GET');
    const nd = D.envelope.docs.length;
    $('#loading').textContent = nd > 1 ? `Carregando ${nd} documentos...` : 'Carregando documento...';
    const pdf = [];
    for (let i = 0; i < nd; i++) pdf.push(await pdfjsLib.getDocument({ data: await call('GET', '/pdf/' + i) }).promise);
    $('#loading').classList.add('hide'); $('#app').classList.remove('hide');
    document.title = 'Assinar: ' + D.envelope.title;
    $('#ttl').textContent = D.envelope.title;
    const fit = (window.innerWidth - 24) / Math.max(...D.envelope.pages.map(p => p.w));
    const metas = D.envelope.pages.map((p, k) => {
      const di = D.envelope.docs.findIndex(d => k >= d.pageStart && k < d.pageStart + d.pageCount);
      const dd = D.envelope.docs[di];
      return { ...p, d: di, n: k - dd.pageStart + 1, label: nd > 1 && k === dd.pageStart ? `Documento ${di + 1} de ${nd}: ${dd.name}` : undefined };
    });
    pageObjs = buildPages($('#pages'), pdf, metas, Math.min(1.6, fit), () => { });
    setupFields();
    setupState();
  } catch (e) { showError(e.message); }
})();

function setupState() {
  const { me, envelope } = D;
  if (envelope.status === 'voided') return banner('Este envelope foi cancelado pelo remetente.');
  if (me.status === 'signed') {
    banner(envelope.status === 'completed' ? '✅ Todos assinaram. Você já pode baixar as cópias finais.' : '✅ Você já assinou. Falta(m) outro(s) signatário(s); depois que todos assinarem a cópia final fica disponível neste link.');
    if (envelope.status === 'completed') showDownload();
    return;
  }
  if (!me.canSign) return banner('Ainda não é a sua vez: aguarde o(s) signatário(s) anterior(es) concluírem.');
  $('#consent').classList.remove('hide');
  $('#btnNext').classList.remove('hide'); $('#btnFinish').classList.remove('hide');
  $('#agree').onchange = refresh;
  $('#btnNext').onclick = goNext;
  $('#btnFinish').onclick = finish;
  refresh();
}
function showDownload() {
  const box = $('#dls'); box.innerHTML = '';
  const many = D.envelope.docs.length > 1;
  D.envelope.docs.forEach((d, i) => box.append(el('button', { class: 'primary', onclick: async () => {
    try { const blob = await call('GET', '/final/' + i); const a = el('a', { href: URL.createObjectURL(blob), download: d.name + '-assinado.pdf' }); document.body.append(a); a.click(); a.remove(); }
    catch (e) { alert(e.message); }
  } }, many ? 'Baixar assinado: ' + (d.name.length > 24 ? d.name.slice(0, 24) + '…' : d.name) : 'Baixar documento assinado')));
}

/* ---------- campos ---------- */
const mine = () => D.fields.filter(f => f.mine);
function missing() {
  return mine().filter(f => f.required && !AUTO.includes(f.type) && !vals[f.id])
    .sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);
}
function setupFields() {
  const interactive = D.me.canSign && D.envelope.status === 'sent';
  for (const f of D.fields) {
    const p = pageObjs[f.page]; if (!p) continue;
    const place = d => Object.assign(d.style, { left: f.x * p.w + 'px', top: f.y * p.h + 'px', width: f.w * p.w + 'px', height: f.h * p.h + 'px' });
    if (!(f.mine && interactive)) {
      if (!f.value) continue;
      const d = el('div', { class: 'sf ro' }); place(d);
      if (f.type === 'signature' || f.type === 'initials') d.append(el('img', { src: f.value }));
      else d.textContent = f.type === 'checkbox' ? (f.value === 'true' ? '✕' : '') : f.value;
      d.style.fontSize = Math.max(8, Math.min(14, f.h * p.h * 0.6)) + 'px';
      p.ov.append(d); continue;
    }
    const d = el('div', { class: 'sf' }); place(d); boxes.set(f.id, d); p.ov.append(d);
    d.style.fontSize = Math.max(9, Math.min(14, f.h * p.h * 0.55)) + 'px';
    if (f.type === 'signature' || f.type === 'initials') {
      d.onclick = async () => {
        const url = await signatureModal(f.type, f.type === 'initials' ? initials(D.me.name) : D.me.name);
        if (!url) return;
        vals[f.id] = url; draw(f);   // cada campo é assinado individualmente
        refresh();
      };
    } else if (f.type === 'checkbox') {
      d.onclick = () => { vals[f.id] = vals[f.id] ? '' : 'true'; draw(f); refresh(); };
    } else if (f.type === 'dropdown') {
      const s = el('select', { onchange: e => { vals[f.id] = e.target.value; refresh(); } }, el('option', { value: '' }, 'Selecione'), (f.options || []).map(o => el('option', { value: o }, o)));
      d.append(s); d.classList.add('done'); d.style.background = 'rgba(255,236,150,.55)';
    } else if (AUTO.includes(f.type)) {
      d.className = 'sf ro'; d.textContent = f.type === 'date' ? today() : f.type === 'name' ? D.me.name : D.me.email;
    } else {
      const i = el('input', { type: 'text', placeholder: FIELD_META[f.type].label + (f.required ? ' *' : ''), inputmode: f.type === 'number' ? 'decimal' : 'text', oninput: e => { vals[f.id] = e.target.value.trim() ? e.target.value : ''; refresh(); } });
      d.append(i);
    }
    draw(f);
  }
}
function draw(f) {
  const d = boxes.get(f.id); if (!d) return;
  if (f.type === 'signature' || f.type === 'initials') {
    d.innerHTML = '';
    if (vals[f.id]) { d.append(el('img', { src: vals[f.id] })); d.classList.add('done'); }
    else {
      const ini = f.type === 'initials';
      const btn = el('span', { class: 'signbtn' }, el('span', {}, ini ? 'Rubrica' : 'Assinar'));
      btn.insertAdjacentHTML('beforeend', '<svg viewBox="0 0 24 24"><path d="M4 20h16"/><path d="M14.5 5.5l4 4L8 20H4v-4z"/></svg>');
      d.append(el('span', { class: 'signtag' }, `${f.required ? 'Exigido' : 'Opcional'} - ${ini ? 'Rubricar aqui' : 'Assinar aqui'}`), btn);
      d.classList.remove('done');
    }
  } else if (f.type === 'checkbox') {
    d.textContent = vals[f.id] ? '✕' : ''; d.classList.toggle('done', !!vals[f.id]);
  }
}
function refresh() {
  const m = missing();
  const total = mine().filter(f => f.required && !AUTO.includes(f.type)).length;
  $('#progress').textContent = total ? `${total - m.length} de ${total} campos` : '';
  $('#btnNext').textContent = m.length ? (m.length === total ? 'Começar' : 'Próximo') : 'Revisar';
  $('#btnFinish').disabled = m.length > 0 || !$('#agree').checked;
}
function goNext() {
  const m = missing();
  const f = m[0] || null;
  if (!f) { $('#btnFinish').scrollIntoView({ block: 'center' }); if (!$('#agree').checked) $('#consent').scrollIntoView(); return; }
  const d = boxes.get(f.id);
  d.scrollIntoView({ behavior: 'smooth', block: 'center' });
  d.classList.remove('flash'); void d.offsetWidth; d.classList.add('flash');
}
async function finish() {
  const btn = $('#btnFinish'); btn.disabled = true; btn.textContent = 'Enviando...';
  try {
    const values = {};
    mine().forEach(f => { if (!AUTO.includes(f.type) && vals[f.id]) values[f.id] = vals[f.id]; });
    const r = await call('POST', '', { values });
    ['#btnNext', '#btnFinish', '#consent'].forEach(s => $(s).classList.add('hide'));
    document.querySelectorAll('.sf').forEach(x => { x.style.pointerEvents = 'none'; x.querySelectorAll('input,select').forEach(i => i.disabled = true); });
    if (r.completed) { banner(D.envelope.docs.length > 1 ? '✅ Documentos assinados! Todos já assinaram: baixe as cópias finais.' : '✅ Documento assinado! Todos já assinaram: baixe a cópia final.'); showDownload(); }
    else banner('✅ Assinado com sucesso! Falta(m) outro(s) signatário(s); depois que todos assinarem, a cópia final fica disponível neste mesmo link.');
    window.scrollTo(0, 0);
  } catch (e) { alert(e.message); btn.disabled = false; btn.textContent = 'Finalizar'; }
}
