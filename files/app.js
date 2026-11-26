/* Painel do remetente */
const COLORS = ['#5fd4f4', '#6fdc9c', '#b9a3ff', '#ffc94d', '#ff93b5', '#8fb0ff', '#ffa56b', '#b9e05a'];
const ini = r => ((r.name || r.email || '?').trim().split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join('') || '?').toUpperCase();
const avatar = r => el('span', { class: 'av', style: `--c:${r.color}` }, ini(r));
const S = {
  key: localStorage.getItem('adminKey') || '', docs: [], pdf: [], metas: [],
  title: '', message: '', signingOrder: true, recipients: [], fields: [], activeR: null, sel: null, armed: null, zoom: 'fit', pg: [],
};
const els = new Map();
let rcount = 0;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const VIEWS = ['login', 'v-list', 'v-setup', 'v-fields'];
const show = v => { VIEWS.forEach(x => $('#' + x).classList.toggle('hide', x !== v)); window.scrollTo(0, 0); };
const toast = (m, ms = 2500) => { const t = el('div', { class: 'hint' }, m); document.body.append(t); setTimeout(() => t.remove(), ms); };

async function api(method, path, { json, raw, blob } = {}) {
  const r = await fetch('/api/' + path, {
    method, headers: { 'x-admin-key': S.key, ...(json ? { 'content-type': 'application/json' } : {}) },
    body: json ? JSON.stringify(json) : raw,
  });
  if (r.status === 401) { show('login'); throw new Error('Senha incorreta.'); }
  if (blob && r.ok) return r.blob();
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Erro ' + r.status);
  return d;
}
function saveBlob(blob, name) {
  const a = el('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); a.remove();
}

/* ---------- login ---------- */
$('#loginForm').onsubmit = async e => {
  e.preventDefault();
  S.key = $('#pw').value; localStorage.setItem('adminKey', S.key);
  $('#loginErr').textContent = '';
  await loadList();
};
$('#logout').onclick = () => { localStorage.removeItem('adminKey'); S.key = ''; $('#pw').value = ''; show('login'); };

/* ---------- lista de envelopes ---------- */
const STATUS = { draft: 'Rascunho', sent: 'Em andamento', completed: 'Concluído', voided: 'Cancelado' };
async function loadList() {
  try {
    const rows = await api('GET', 'envelopes');
    show('v-list');
    const box = $('#list'); box.innerHTML = '';
    if (!rows.length) return box.append(el('div', { class: 'empty' }, 'Nenhum envelope ainda. Clique em "Novo envelope".'));
    const tb = el('tbody');
    for (const e of rows) {
      const acts = el('div', { class: 'acts' });
      if (e.status !== 'draft') acts.append(el('button', { onclick: async () => showLinks(await api('GET', 'envelopes/' + e.id), 'Links de assinatura') }, 'Links'));
      (e.docs || [e.title]).forEach((dn, di, arr) => acts.append(el('button', { onclick: async () => {
        try { saveBlob(await api('GET', `envelopes/${e.id}/pdf/${di}${e.status === 'completed' ? '?final=1' : ''}`, { blob: true }), dn + (e.status === 'completed' ? '-assinado' : '') + '.pdf'); } catch (x) { alert(x.message); }
      } }, (e.status === 'completed' ? 'Baixar assinado' : 'Baixar original') + (arr.length > 1 ? ': ' + (dn.length > 22 ? dn.slice(0, 22) + '…' : dn) : ''))));
      if (e.status === 'sent') acts.append(el('button', { onclick: async () => { if (confirm('Cancelar este envelope? Os links deixam de funcionar.')) { await api('POST', `envelopes/${e.id}/void`); loadList(); } } }, 'Cancelar'));
      acts.append(el('button', { class: 'danger', onclick: async () => { if (confirm('Excluir este envelope e o documento?')) { await api('DELETE', 'envelopes/' + e.id); loadList(); } } }, 'Excluir'));
      tb.append(el('tr', {},
        el('td', {}, el('b', {}, e.title), (e.docs || []).length > 1 ? el('div', { style: 'font-size:12px;color:#666' }, e.docs.length + ' documentos') : ''),
        el('td', {}, el('span', { class: 'badge b-' + e.status }, STATUS[e.status] || e.status)),
        el('td', {}, e.recipients.map(r => el('div', { style: 'font-size:13px' }, (r.status === 'signed' ? '✅ ' : '⏳ ') + r.name))),
        el('td', {}, new Date(e.createdAt).toLocaleDateString('pt-BR')),
        el('td', {}, acts)));
    }
    box.append(el('table', { class: 'tbl' }, el('thead', {}, el('tr', {}, ['Título', 'Status', 'Destinatários', 'Criado', ''].map(h => el('th', {}, h)))), tb));
  } catch (e) {
    if ($('#login').classList.contains('hide')) alert(e.message);
    else $('#loginErr').textContent = e.message;
  }
}

function showLinks(env, heading) {
  const m = el('div', { class: 'modal', onpointerdown: e => { if (e.target === m) m.remove(); } });
  const box = el('div', { class: 'box' }, el('h3', {}, heading), el('p', { class: 'note', style: 'margin-top:0' },
    'Se o envio de e-mail estiver configurado, cada pessoa já recebeu o convite por e-mail. Você também pode copiar o link ou mandar pelo WhatsApp.'));
  for (const r of env.recipients) {
    const inp = el('input', { type: 'text', readonly: 'readonly', value: r.link });
    box.append(el('div', { class: 'linkrow' },
      el('div', {}, el('b', {}, r.name), ` <${r.email}> · `, r.status === 'signed' ? '✅ assinou' : (env.signingOrder ? `ordem ${r.order} · ` : '') + '⏳ pendente', r.emailSent ? ' · 📧 e-mail enviado' : ''),
      r.emailError && r.status !== 'signed' ? el('div', { class: 'mailerr' }, '⚠️ E-mail não enviado: ' + r.emailError) : '',
      el('div', { class: 'link' }, inp,
        el('button', { onclick: e => { navigator.clipboard.writeText(r.link).then(() => e.target.textContent = 'Copiado!'); } }, 'Copiar'),
        r.status === 'pending' ? el('button', { onclick: async e => {
          const b = e.target; b.disabled = true; b.textContent = 'Enviando...';
          try { const x = await api('POST', `envelopes/${env.id}/resend`, { json: { recipientId: r.id } }); b.textContent = x.ok ? 'E-mail enviado ✔' : 'Falhou'; if (!x.ok) alert('Não consegui enviar o e-mail: ' + x.error); }
          catch (err) { b.textContent = 'Falhou'; alert(err.message); }
          setTimeout(() => { b.disabled = false; b.textContent = 'Enviar e-mail'; }, 3000);
        } }, 'Enviar e-mail') : '',
        el('a', { href: 'https://wa.me/?text=' + encodeURIComponent(`Olá ${r.name}, assine ${env.docs && env.docs.length > 1 ? 'os documentos' : 'o documento'} "${env.title}": ${r.link}`), target: '_blank', rel: 'noopener' }, el('button', {}, 'WhatsApp')))));
  }
  box.append(el('div', { class: 'row' }, el('button', { class: 'primary', style: 'margin-left:auto', onclick: () => { m.remove(); loadList(); } }, 'Fechar')));
  m.append(box); document.body.append(m);
}

/* ---------- novo envelope: configurar ---------- */
$('#newEnv').onclick = () => {
  Object.assign(S, { docs: [], pdf: [], metas: [], title: '', message: '', signingOrder: true, fields: [], sel: null, armed: null });
  rcount = 0; S.recipients = []; addRecipient(); S.activeR = S.recipients[0].id;
  $('#title').value = ''; $('#msg').value = ''; $('#ord').checked = true;
  renderDoc(); renderRecipients(); updateNext(); show('v-setup');
};
$('#sClose').onclick = () => { if (!S.docs.length || confirm('Descartar este envelope?')) loadList(); };

function addRecipient() { rcount++; S.recipients.push({ id: 'r' + rcount, name: '', email: '', order: rcount, color: COLORS[(rcount - 1) % COLORS.length] }); }
$('#addR').onclick = () => { addRecipient(); renderRecipients(); updateNext(); };
$('#ord').onchange = e => { S.signingOrder = e.target.checked; renderRecipients(); };
$('#title').oninput = e => { S.title = e.target.value; updateNext(); };
$('#msg').oninput = e => { S.message = e.target.value; };

function moveR(i, d) {
  const j = i + d; if (j < 0 || j >= S.recipients.length) return;
  [S.recipients[i], S.recipients[j]] = [S.recipients[j], S.recipients[i]];
  S.recipients.forEach((r, k) => { r.order = k + 1; });
  renderRecipients();
}
function renderRecipients() {
  const box = $('#rlist'); box.innerHTML = '';
  if (S.signingOrder) S.recipients.sort((a, b) => a.order - b.order);
  S.recipients.forEach((r, i) => {
    const av = avatar(r);
    box.append(el('div', { class: 'rrow', style: `--c:${r.color}` },
      el('div', { class: 'rhead' }, av,
        S.signingOrder ? el('div', { class: 'ord', title: 'Ordem de assinatura' },
          el('button', { class: 'ghost', title: 'Mover para cima', ...(i === 0 ? { disabled: 'disabled' } : {}), onclick: () => moveR(i, -1) }, '▲'),
          el('input', { type: 'number', min: 1, max: 99, value: r.order, oninput: e => { r.order = parseInt(e.target.value) || 1; }, onchange: () => renderRecipients() }),
          el('button', { class: 'ghost', title: 'Mover para baixo', ...(i === S.recipients.length - 1 ? { disabled: 'disabled' } : {}), onclick: () => moveR(i, 1) }, '▼')) : ''),
      el('div', { class: 'fcol' },
        el('div', { class: 'f' }, el('label', { class: 'lb' }, ['Nome ', el('span', { class: 'req' }, '*')]), el('input', { type: 'text', value: r.name, oninput: e => { r.name = e.target.value; av.textContent = ini(r); updateNext(); } })),
        el('div', { class: 'f' }, el('label', { class: 'lb' }, ['E-mail ', el('span', { class: 'req' }, '*')]), el('input', { type: 'email', value: r.email, oninput: e => { r.email = e.target.value; av.textContent = ini(r); updateNext(); } }))),
      S.recipients.length > 1 ? el('button', { class: 'ghost', title: 'Remover', onclick: () => { S.recipients = S.recipients.filter(x => x !== r); S.fields = S.fields.filter(f => f.recipientId !== r.id); S.recipients.forEach((x, k) => { x.order = k + 1; }); renderRecipients(); updateNext(); } }, '🗑') : ''));
  });
}
function updateNext() {
  const okR = S.recipients.every(r => r.name.trim() && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.email.trim()));
  $('#sNext').disabled = !(S.docs.length && S.title.trim() && okR);
}

/* documento */
$('#pick').onclick = () => $('#file').click();
$('#file').onchange = async e => { const fs = [...e.target.files]; e.target.value = ''; for (const f of fs) await loadPdf(f); };
$('#drop').ondragover = e => { e.preventDefault(); $('#drop').classList.add('over'); };
$('#drop').ondragleave = () => $('#drop').classList.remove('over');
$('#drop').ondrop = async e => { e.preventDefault(); $('#drop').classList.remove('over'); for (const f of [...e.dataTransfer.files]) await loadPdf(f); };
const MAX_BYTES = 6 * 1024 * 1024;
/* Word -> PDF no navegador (renderiza o .docx e transforma cada página em imagem dentro de um PDF) */
async function docxToPdf(f) {
  const note = $('#conv');
  const host = el('div', { style: 'position:absolute;left:-99999px;top:0' });
  document.body.append(host);
  try {
    note.textContent = 'Convertendo o Word...';
    await docx.renderAsync(await f.arrayBuffer(), host, host, { inWrapper: true, breakPages: true, ignoreLastRenderedPageBreak: false, className: 'docx' });
    await document.fonts.ready;
    const secs = [...host.querySelectorAll('section.docx')];
    if (!secs.length) throw new Error('documento vazio');
    for (const [sc, q] of [[2, 0.9], [1.5, 0.8], [1.2, 0.7]]) {   // reduz a qualidade se passar do limite de tamanho
      const out = await PDFLib.PDFDocument.create();
      let i = 0;
      for (const s of secs) {
        note.textContent = `Convertendo página ${++i} de ${secs.length}...`;
        s.style.boxShadow = 'none'; s.style.margin = '0';
        const r = s.getBoundingClientRect();
        const c = await html2canvas(s, { scale: sc, backgroundColor: '#ffffff', useCORS: true });
        // Se o Word não trouxe marcas de quebra de página, a "página" fica mais alta que o papel: corta em fatias do tamanho da folha
        const pageH = parseFloat(getComputedStyle(s).minHeight) || r.height;
        const n = r.height > pageH * 1.05 ? Math.ceil(r.height / pageH - 0.02) : 1;
        for (let k = 0; k < n; k++) {
          let src = c, w = r.width * 0.75, h = r.height * 0.75;
          if (n > 1) {
            const sy = Math.round(k * pageH * sc), sh = Math.min(Math.round(pageH * sc), c.height - sy);
            if (sh <= 0) break;
            src = document.createElement('canvas'); src.width = c.width; src.height = Math.round(pageH * sc);
            const x = src.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, src.width, src.height); x.drawImage(c, 0, sy, c.width, sh, 0, 0, c.width, sh);
            h = pageH * 0.75;
          }
          const img = await out.embedJpg(src.toDataURL('image/jpeg', q));
          out.addPage([w, h]).drawImage(img, { x: 0, y: 0, width: w, height: h });
        }
      }
      const bytes = await out.save();
      if (bytes.length <= MAX_BYTES * 0.95 || sc === 1.2) return bytes;
    }
  } finally { host.remove(); note.textContent = ''; }
}
async function loadPdf(f) {
  const isDocx = /\.docx$/i.test(f.name);
  if (!isDocx && !/\.pdf$/i.test(f.name)) return alert(`"${f.name}": envie um PDF ou Word (.docx). Para .doc antigo, salve como .docx no Word.`);
  if (S.docs.length >= 10) return alert('Máximo de 10 documentos por envelope.');
  if (!isDocx && f.size > MAX_BYTES) return alert(`"${f.name}" tem mais de 6 MB. As funções gratuitas da Netlify aceitam até 6 MB por documento. Comprima o arquivo e tente de novo.`);
  try {
    const bytes = isDocx ? await docxToPdf(f) : new Uint8Array(await f.arrayBuffer());
    if (bytes.length > MAX_BYTES) return alert(`Depois de convertido, "${f.name}" passou de 6 MB (limite das funções gratuitas da Netlify). Exporte para PDF pelo Word, comprima as imagens e tente de novo.`);
    const pdf = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
    const metas = await pdfMetas(pdf);
    S.docs.push({ name: f.name.replace(/\.(pdf|docx)$/i, ''), bytes, pdf, metas });
    if (!S.title.trim()) { S.title = S.docs[0].name; $('#title').value = S.title; }
    rebuildDocs(); renderDoc(); updateNext();
  } catch (e) { alert(`Não consegui abrir "${f.name}": ` + e.message); }
}
/* junta as páginas de todos os documentos numa sequência única (os campos usam o índice global da página) */
function rebuildDocs() {
  S.pdf = S.docs.map(d => d.pdf);
  S.metas = S.docs.flatMap((d, di) => d.metas.map((m, n) => ({ w: m.w, h: m.h, d: di, n: n + 1, label: n === 0 && S.docs.length > 1 ? d.name : undefined })));
}
function removeDoc(di) {
  const start = S.docs.slice(0, di).reduce((a, d) => a + d.metas.length, 0), cnt = S.docs[di].metas.length;
  S.fields = S.fields.filter(f => f.page < start || f.page >= start + cnt);
  S.fields.forEach(f => { if (f.page >= start + cnt) f.page -= cnt; });
  S.docs.splice(di, 1); S.sel = null;
  rebuildDocs(); renderDoc(); updateNext();
}
function renderDoc() {
  const c = $('#docchip'); c.innerHTML = '';
  S.docs.forEach((d, di) => c.append(el('div', { class: 'docchip' }, el('b', {}, d.name), el('small', {}, d.metas.length + ' página(s) · ' + (d.bytes.length / 1048576).toFixed(1) + ' MB'),
    el('div', { style: 'margin-top:8px' }, el('button', { class: 'danger', style: 'padding:3px 10px;font-size:13px', onclick: () => removeDoc(di) }, 'Remover')))));
}

/* ---------- editor de campos ---------- */
$('#sNext').onclick = () => { if (!S.recipients.some(r => r.id === S.activeR)) S.activeR = S.recipients[0].id; enterFields(); };
$('#fBack').onclick = $('#fCrumb').onclick = e => { e.preventDefault(); disarm(); show('v-setup'); };
$('#fClose').onclick = () => { if (confirm('Descartar este envelope?')) loadList(); };
$('#zoom').onchange = e => { S.zoom = e.target.value === 'fit' ? 'fit' : parseFloat(e.target.value); buildStage(); };
window.addEventListener('resize', () => { if (S.zoom === 'fit' && !$('#v-fields').classList.contains('hide')) buildStage(); });
function curScale() {
  if (S.zoom !== 'fit') return S.zoom;
  const w = $('.stage').clientWidth - 48;
  const maior = Math.max(...S.metas.map(m => m.w));
  return Math.max(0.5, Math.min(2, w / maior));
}

function enterFields() { show('v-fields'); $('#zoom').value = String(S.zoom); renderSide(); buildStage(); renderThumbs(); }
function buildStage() {
  els.clear();
  S.pg = buildPages($('#pages'), S.pdf, S.metas, curScale(), p => {
    p.ov.ondragover = e => e.preventDefault();
    p.ov.ondrop = e => {
      e.preventDefault();
      const t = (e.dataTransfer.getData('text/plain') || '').replace('type:', '');
      if (FIELD_META[t]) { const r = p.ov.getBoundingClientRect(); addField(t, p.i, e.clientX - r.left, e.clientY - r.top); }
    };
    p.ov.onpointerdown = e => {
      if (e.target !== p.ov) return;
      select(null);
      if (S.armed) { const r = p.ov.getBoundingClientRect(); addField(S.armed, p.i, e.clientX - r.left, e.clientY - r.top); disarm(); }
    };
  });
  $('#pgcount').textContent = S.metas.length + ' página(s)';
  S.fields.forEach(mountField);
}

/* seletor de destinatário com cores (igual ao DocuSign) */
function recipientPicker(curId, onPick) {
  const cur = S.recipients.find(r => r.id === curId) || S.recipients[0];
  const label = r => r.name || r.email || 'Destinatário';
  const menu = el('div', { class: 'rpmenu hide' },
    S.recipients.map(r => el('div', { class: 'rpitem' + (r.id === cur.id ? ' on' : ''), onclick: () => { menu.classList.add('hide'); onPick(r.id); } },
      avatar(r), el('span', { class: 'nm' }, label(r)), r.id === cur.id ? el('span', { class: 'ck' }, '✓') : '')),
    el('a', { href: '#', class: 'rpedit', onclick: e => { e.preventDefault(); disarm(); show('v-setup'); } }, 'Editar destinatários'));
  const btn = el('button', { class: 'rpbtn', style: `--c:${cur.color}`, onclick: e => { e.stopPropagation(); const open = menu.classList.contains('hide'); document.querySelectorAll('.rpmenu').forEach(m => m.classList.add('hide')); menu.classList.toggle('hide', !open); } },
    avatar(cur), el('span', { class: 'nm' }, label(cur)), el('span', { class: 'chev' }, '⌄'));
  return el('div', { class: 'rpick' }, btn, menu);
}
document.addEventListener('pointerdown', e => { if (!e.target.closest('.rpick')) document.querySelectorAll('.rpmenu').forEach(m => m.classList.add('hide')); });

/* ---------- miniaturas das páginas (painel da direita) ---------- */
let thumbEls = [];
function renderThumbs() {
  const box = $('#thumbs'); box.innerHTML = ''; thumbEls = [];
  const io = new IntersectionObserver(ents => ents.forEach(en => { if (en.isIntersecting) { io.unobserve(en.target); drawThumb(en.target); } }), { root: box, rootMargin: '400px' });
  let g = 0;
  S.docs.forEach((d, di) => {
    const list = el('div', { class: 'tlist' });
    const chev = el('span', { class: 'chev' }, '⌃');
    const head = el('div', { class: 'thead', onclick: () => { list.classList.toggle('hide'); chev.textContent = list.classList.contains('hide') ? '⌄' : '⌃'; } },
      el('div', { class: 'tn' }, el('b', {}, d.name), el('small', {}, d.metas.length + (d.metas.length === 1 ? ' página' : ' páginas'))), chev);
    d.metas.forEach((m, n) => {
      const idx = g++;
      const th = el('div', { class: 'thumb', onclick: () => goPage(idx) },
        el('div', { class: 'tcv', style: `aspect-ratio:${m.w}/${m.h}` }, el('canvas'), el('div', { class: 'marks' })), el('div', { class: 'tnum' }, String(n + 1)));
      th.dataset.di = di; th.dataset.n = n;
      list.append(th); thumbEls.push(th); io.observe(th);
    });
    box.append(el('div', { class: 'tdoc' }, head, list));
  });
  updateMarks(); markCurrentThumb();
}
async function drawThumb(th) {
  try {
    const cv = th.querySelector('canvas');
    const pg = await S.docs[+th.dataset.di].pdf.getPage(+th.dataset.n + 1);
    const vp = pg.getViewport({ scale: 1 }), vp2 = pg.getViewport({ scale: 260 / vp.width });
    cv.width = vp2.width; cv.height = vp2.height;
    await pg.render({ canvasContext: cv.getContext('2d'), viewport: vp2 }).promise;
  } catch { }
}
function updateMarks() {
  thumbEls.forEach((th, idx) => {
    const mk = th.querySelector('.marks'); mk.innerHTML = '';
    S.fields.filter(f => f.page === idx).forEach(f => {
      const r = S.recipients.find(x => x.id === f.recipientId);
      mk.append(el('i', { style: `left:${f.x * 100}%;top:${f.y * 100}%;width:${f.w * 100}%;height:${f.h * 100}%;background:${r ? r.color : '#999'}` }));
    });
  });
}
function goPage(idx) { S.pg[idx] && S.pg[idx].wrap.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
function markCurrentThumb() {
  const stage = $('.stage'); if (!stage || !S.pg.length) return;
  const top = stage.getBoundingClientRect().top + 60;
  let cur = 0;
  for (const p of S.pg) if (p.wrap.getBoundingClientRect().bottom > top) { cur = p.i; break; }
  thumbEls.forEach((t, i) => t.classList.toggle('act', i === cur));
  const t = thumbEls[cur], b = $('#thumbs');
  if (t) { const tr = t.getBoundingClientRect(), br = b.getBoundingClientRect(); if (tr.top < br.top || tr.bottom > br.bottom) b.scrollTop += tr.top - br.top - 20; }
}
let thumbRaf = 0;
$('.stage').addEventListener('scroll', () => { if (!thumbRaf) thumbRaf = requestAnimationFrame(() => { thumbRaf = 0; markCurrentThumb(); }); });

function renderSide() {
  const side = $('#side'); side.innerHTML = '';
  const rec = S.recipients.find(r => r.id === S.activeR) || S.recipients[0];
  side.append(recipientPicker(rec.id, id => { S.activeR = id; renderSide(); }));
  side.append(el('p', { class: 'note' }, 'Clique em um campo e depois no documento, ou arraste o campo até o ponto desejado.'));
  const groups = {};
  Object.entries(FIELD_META).forEach(([t, m]) => (groups[m.group] ??= []).push([t, m]));
  for (const [g, items] of Object.entries(groups)) {
    side.append(el('h3', {}, g));
    side.append(el('div', { class: 'pal' }, items.map(([t, m]) => el('button', {
      draggable: 'true', id: 'pal-' + t, class: S.armed === t ? 'armed' : '',
      ondragstart: e => { e.dataTransfer.setData('text/plain', 'type:' + t); S.armed = null; document.body.classList.remove('armed'); },
      onclick: () => { S.armed === t ? disarm() : arm(t); },
    }, el('span', { class: 'ic' }, m.ic), m.label))));
  }
  side.append(el('div', { class: 'prop', id: 'props' }));
  renderProps();
}
function arm(t) { S.armed = t; document.body.classList.add('armed'); document.querySelectorAll('.pal button').forEach(b => b.classList.toggle('armed', b.id === 'pal-' + t)); toast('Clique no documento onde quer colocar o campo'); }
function disarm() { S.armed = null; document.body.classList.remove('armed'); document.querySelectorAll('.pal button').forEach(b => b.classList.remove('armed')); }

function renderProps() {
  const box = $('#props'); if (!box) return; box.innerHTML = '';
  const f = S.fields.find(x => x.id === S.sel);
  if (!f) return box.append(el('div', { class: 'note' }, 'Selecione um campo no documento para ajustar.'));
  const m = FIELD_META[f.type];
  box.append(el('h3', { style: 'margin-top:0' }, m.label));
  box.append(el('label', { class: 'lb' }, 'Destinatário'));
  box.append(recipientPicker(f.recipientId, id => { f.recipientId = id; remount(f); renderProps(); updateMarks(); }));
  if (!['date', 'name', 'email'].includes(f.type)) box.append(el('label', { class: 'chk' }, el('input', { type: 'checkbox', ...(f.required ? { checked: 'checked' } : {}), onchange: e => { f.required = e.target.checked; } }), 'Obrigatório'));
  if (f.type === 'dropdown') {
    box.append(el('label', { class: 'lb', style: 'margin-top:10px' }, 'Opções (separadas por vírgula)'));
    box.append(el('input', { type: 'text', value: (f.options || []).join(', '), oninput: e => { f.options = e.target.value.split(',').map(s => s.trim()).filter(Boolean); } }));
  }
  box.append(el('div', { class: 'row' }, el('button', { class: 'danger', onclick: () => removeField(f.id) }, 'Excluir campo')));
}

function addField(type, pageIdx, cx, cy) {
  const m = FIELD_META[type], meta = S.metas[pageIdx], p = S.pg[pageIdx];
  const w = m.w / meta.w, h = m.h / meta.h;
  const f = {
    id: 'f' + Math.random().toString(36).slice(2, 10), recipientId: S.activeR, type, page: pageIdx,
    w, h, x: clamp(cx / p.w - w / 2, 0, 1 - w), y: clamp(cy / p.h - h / 2, 0, 1 - h), required: true,
    options: type === 'dropdown' ? ['Opção 1', 'Opção 2'] : undefined,
  };
  S.fields.push(f); mountField(f); select(f.id); updateMarks();
}
function mountField(f) {
  const p = S.pg[f.page]; if (!p) return;
  const m = FIELD_META[f.type], r = S.recipients.find(x => x.id === f.recipientId);
  const d = el('div', { class: 'fbox', style: `--c:${r ? r.color : '#999'}` }, el('span', {}, `${m.ic} ${m.label}`), el('div', { class: 'h' }));
  els.set(f.id, d); place(f); p.ov.append(d);
  d.onpointerdown = e => {
    if (e.target.classList.contains('h')) return;
    select(f.id); d.setPointerCapture(e.pointerId);
    const sx = e.clientX, sy = e.clientY, ox = f.x, oy = f.y;
    d.onpointermove = ev => { f.x = clamp(ox + (ev.clientX - sx) / p.w, 0, 1 - f.w); f.y = clamp(oy + (ev.clientY - sy) / p.h, 0, 1 - f.h); place(f); };
    d.onpointerup = () => { d.onpointermove = d.onpointerup = null; updateMarks(); };
  };
  const h = d.querySelector('.h');
  h.onpointerdown = e => {
    e.stopPropagation(); select(f.id); h.setPointerCapture(e.pointerId);
    const sx = e.clientX, sy = e.clientY, ow = f.w, oh = f.h;
    h.onpointermove = ev => { f.w = clamp(ow + (ev.clientX - sx) / p.w, 8 / p.w, 1 - f.x); f.h = clamp(oh + (ev.clientY - sy) / p.h, 8 / p.h, 1 - f.y); place(f); };
    h.onpointerup = () => { h.onpointermove = h.onpointerup = null; updateMarks(); };
  };
  if (S.sel === f.id) d.classList.add('sel');
}
function place(f) {
  const p = S.pg[f.page], d = els.get(f.id); if (!p || !d) return;
  Object.assign(d.style, { left: f.x * p.w + 'px', top: f.y * p.h + 'px', width: f.w * p.w + 'px', height: f.h * p.h + 'px' });
}
function remount(f) { els.get(f.id)?.remove(); mountField(f); }
function select(id) {
  S.sel = id;
  els.forEach((d, k) => d.classList.toggle('sel', k === id));
  renderProps();
}
function removeField(id) { els.get(id)?.remove(); els.delete(id); S.fields = S.fields.filter(f => f.id !== id); if (S.sel === id) S.sel = null; renderProps(); updateMarks(); }
document.addEventListener('keydown', e => {
  if ((e.key === 'Delete' || e.key === 'Backspace') && S.sel && !$('#v-fields').classList.contains('hide') && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); removeField(S.sel); }
  if (e.key === 'Escape') disarm();
});

/* ---------- enviar ---------- */
$('#fSend').onclick = async () => {
  for (const r of S.recipients) {
    if (!S.fields.some(f => f.recipientId === r.id && (f.type === 'signature' || f.type === 'initials')))
      return alert(`Adicione ao menos um campo de Assinatura para ${r.name || r.email}.`);
  }
  // avisa se alguém não assina algum dos documentos
  if (S.docs.length > 1) {
    const warn = [];
    let start = 0;
    for (const d of S.docs) {
      const end = start + d.metas.length;
      for (const r of S.recipients) if (!S.fields.some(f => f.recipientId === r.id && f.page >= start && f.page < end && (f.type === 'signature' || f.type === 'initials')))
        warn.push(`• ${r.name || r.email} não tem assinatura em "${d.name}"`);
      start = end;
    }
    if (warn.length && !confirm('Atenção:\n' + warn.join('\n') + '\n\nEnviar assim mesmo?')) return;
  }
  const btn = $('#fSend'); btn.disabled = true;
  try {
    btn.textContent = 'Criando...';
    const { id } = await api('POST', 'envelopes', { json: {
      title: S.title.trim(), message: S.message, signingOrder: S.signingOrder,
      docs: S.docs.map(d => ({ name: d.name, pages: d.metas })),
      recipients: S.recipients.map(r => ({ id: r.id, name: r.name.trim(), email: r.email.trim(), order: S.signingOrder ? r.order : 1 })),
      fields: S.fields.map(({ id, recipientId, type, page, x, y, w, h, required, options }) => ({ id, recipientId, type, page, x, y, w, h, required, options })),
    } });
    for (const [i, d] of S.docs.entries()) {
      btn.textContent = `Enviando documento ${i + 1} de ${S.docs.length}...`;
      await api('PUT', `envelopes/${id}/pdf/${i}`, { raw: d.bytes });
    }
    btn.textContent = 'Enviando...';
    const env = await api('POST', `envelopes/${id}/send`);
    await loadList();
    showLinks(env, 'Envelope enviado! 🎉');
  } catch (e) { alert('Não consegui enviar: ' + e.message); }
  btn.disabled = false; btn.textContent = 'Enviar';
};

/* ---------- início ---------- */
if (S.key) loadList(); else show('login');
