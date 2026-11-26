/* Código compartilhado entre a tela do remetente e a do destinatário */
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const $ = (s, r = document) => r.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v; else if (k.startsWith('on')) e[k] = v; else if (k === 'style') e.style.cssText = v; else e.setAttribute(k, v);
  }
  kids.flat().forEach(c => e.append(c?.nodeType ? c : document.createTextNode(c ?? '')));
  return e;
};

const FIELD_META = {
  signature: { label: 'Assinatura', ic: '✒️', w: 150, h: 40, group: 'Assinatura' },
  initials: { label: 'Rubrica', ic: 'AZ', w: 60, h: 30, group: 'Assinatura' },
  date: { label: 'Data da assinatura', ic: '📅', w: 100, h: 18, group: 'Assinatura' },
  name: { label: 'Nome', ic: '👤', w: 130, h: 18, group: 'Informações de contato' },
  email: { label: 'E-mail', ic: '✉️', w: 170, h: 18, group: 'Informações de contato' },
  company: { label: 'Empresa', ic: '🏢', w: 130, h: 18, group: 'Informações de contato' },
  title: { label: 'Título', ic: '🪪', w: 110, h: 18, group: 'Informações de contato' },
  text: { label: 'Texto', ic: 'T', w: 130, h: 18, group: 'Entradas' },
  number: { label: 'Número', ic: '#', w: 80, h: 18, group: 'Entradas' },
  checkbox: { label: 'Caixa de seleção', ic: '☑️', w: 16, h: 16, group: 'Entradas' },
  dropdown: { label: 'Lista suspensa', ic: '▾', w: 130, h: 18, group: 'Entradas' },
};

/* ---------- páginas do PDF com renderização preguiçosa (aguenta PDFs grandes) ---------- */
function buildPages(container, pdf, metas, scale, onOverlay) {
  container.innerHTML = '';
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  const pages = [];
  const io = new IntersectionObserver(entries => {
    for (const en of entries) {
      const p = pages[+en.target.dataset.i];
      en.isIntersecting ? renderPage(p) : clearPage(p);
    }
  }, { rootMargin: '900px 0px' });

  async function renderPage(p) {
    if (p.rendered || p.rendering) return;
    p.rendering = true;
    const tk = ++p.tk;
    try {
      const m = metas[p.i];
      const pg = await (Array.isArray(pdf) ? pdf[m.d] : pdf).getPage(m.n ?? p.i + 1);
      if (tk !== p.tk) return;
      const vp = pg.getViewport({ scale });
      p.cv.width = Math.floor(vp.width * dpr); p.cv.height = Math.floor(vp.height * dpr);
      p.task = pg.render({ canvasContext: p.cv.getContext('2d'), viewport: vp, transform: [dpr, 0, 0, dpr, 0, 0] });
      await p.task.promise;
      if (tk === p.tk) p.rendered = true;
    } catch (e) { /* render cancelado */ }
    if (tk === p.tk) p.rendering = false;
  }
  function clearPage(p) {
    p.tk++;
    try { p.task && p.task.cancel(); } catch { }
    p.cv.width = 1; p.cv.height = 1;
    p.rendered = false; p.rendering = false;
  }

  metas.forEach((m, i) => {
    const w = m.w * scale, h = m.h * scale;
    if (m.label) container.append(el('div', { class: 'doclabel' }, m.label));
    const wrap = el('div', { class: 'page', style: `width:${w}px;height:${h}px` });
    wrap.dataset.i = i;
    const cv = el('canvas', { style: `width:${w}px;height:${h}px` });
    const ov = el('div', { class: 'ov' });
    wrap.append(cv, ov);
    container.append(wrap);
    const p = { i, w, h, wrap, cv, ov, tk: 0, rendered: false, rendering: false };
    pages.push(p);
    onOverlay && onOverlay(p);
    io.observe(wrap);
  });
  return pages;
}

async function pdfMetas(pdf) {
  const out = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const v = (await pdf.getPage(i)).getViewport({ scale: 1 });
    out.push({ w: v.width, h: v.height });
  }
  return out;
}

/* ---------- criação de assinatura (desenhar / digitar / imagem) ---------- */
function trimCanvas(c) {
  const w = c.width, h = c.height, d = c.getContext('2d').getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 10) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return null;
  const p = 6; x0 = Math.max(0, x0 - p); y0 = Math.max(0, y0 - p); x1 = Math.min(w - 1, x1 + p); y1 = Math.min(h - 1, y1 + p);
  const o = document.createElement('canvas'); o.width = x1 - x0 + 1; o.height = y1 - y0 + 1;
  o.getContext('2d').drawImage(c, x0, y0, o.width, o.height, 0, 0, o.width, o.height);
  return o;
}
async function textToCanvas(text, font, color, size) {
  await document.fonts.load(`${size}px "${font}"`, text);
  const m = document.createElement('canvas').getContext('2d'); m.font = `${size}px "${font}"`;
  const c = document.createElement('canvas'); c.width = Math.ceil(m.measureText(text).width) + 60; c.height = size * 2;
  const x = c.getContext('2d'); x.font = `${size}px "${font}"`; x.fillStyle = color; x.textBaseline = 'middle'; x.fillText(text, 30, size);
  return trimCanvas(c);
}
/* Abre o modal; resolve com um dataURL PNG (ou null se cancelar). kind = 'signature' | 'initials' */
function signatureModal(kind, defaultText) {
  return new Promise(resolve => {
    const storeKey = 'sigs_' + kind;
    let color = '#111111', font = 'Dancing Script', drawing = false, last = null;
    const getSaved = () => { try { return JSON.parse(localStorage.getItem(storeKey) || '[]'); } catch { return []; } };
    const save = u => { try { localStorage.setItem(storeKey, JSON.stringify([u, ...getSaved().filter(x => x !== u)].slice(0, 4))); } catch { } };
    const done = u => { if (u) save(u); m.remove(); resolve(u || null); };

    const dc = el('canvas', { class: 'draw', width: 900, height: 300 });
    const dx = dc.getContext('2d');
    const pos = e => { const r = dc.getBoundingClientRect(); return { x: (e.clientX - r.left) * dc.width / r.width, y: (e.clientY - r.top) * dc.height / r.height }; };
    dc.onpointerdown = e => { drawing = true; last = pos(e); dc.setPointerCapture(e.pointerId); dx.fillStyle = color; dx.beginPath(); dx.arc(last.x, last.y, 3, 0, 7); dx.fill(); };
    dc.onpointermove = e => { if (!drawing) return; const p = pos(e); dx.strokeStyle = color; dx.lineWidth = 6; dx.lineCap = dx.lineJoin = 'round'; dx.beginPath(); dx.moveTo(last.x, last.y); dx.lineTo(p.x, p.y); dx.stroke(); last = p; };
    dc.onpointerup = dc.onpointercancel = () => drawing = false;

    const dots = () => ['#111111', '#1d4ed8'].map(c => el('button', {
      class: 'dot' + (c === color ? ' act' : ''), style: `background:${c}`,
      onclick: e => { color = c; m.querySelectorAll('.dot').forEach(d => d.classList.toggle('act', d === e.currentTarget)); },
    }));
    const tIn = el('input', { type: 'text', placeholder: kind === 'initials' ? 'Suas iniciais' : 'Digite seu nome', value: defaultText || '' });
    const fonts = el('div', { class: 'row fonts' }, ['Dancing Script', 'Great Vibes', 'Caveat'].map((f, i) => el('button', {
      class: i ? '' : 'act', style: `font-family:"${f}"`, onclick: e => { font = f; fonts.querySelectorAll('button').forEach(b => b.classList.toggle('act', b === e.currentTarget)); },
    }, kind === 'initials' ? 'AB' : 'Assinatura')));
    const imgIn = el('input', { type: 'file', accept: 'image/*', onchange: e => {
      const f = e.target.files[0]; if (!f) return;
      const img = new Image();
      img.onload = () => {
        const sc = Math.min(1, 1000 / img.width), c = document.createElement('canvas'); c.width = img.width * sc; c.height = img.height * sc;
        const x = c.getContext('2d'); x.drawImage(img, 0, 0, c.width, c.height);
        const d = x.getImageData(0, 0, c.width, c.height), a = d.data;
        for (let i = 0; i < a.length; i += 4) { const l = (a[i] + a[i + 1] + a[i + 2]) / 3; if (l > 225) a[i + 3] = 0; else if (l > 170) a[i + 3] = Math.round((225 - l) / 55 * 255); }
        x.putImageData(d, 0, 0); const t = trimCanvas(c); if (!t) return alert('Não encontrei assinatura na imagem.'); done(t.toDataURL());
      }; img.src = URL.createObjectURL(f);
    } });

    const panes = {
      d: el('div', { class: 'pane on' }, dc, el('div', { class: 'row' }, dots(),
        el('button', { onclick: () => dx.clearRect(0, 0, dc.width, dc.height) }, 'Limpar'),
        el('button', { class: 'primary', style: 'margin-left:auto', onclick: () => { const c = trimCanvas(dc); if (!c) return alert('Desenhe primeiro.'); done(c.toDataURL()); } }, 'Adotar e assinar'))),
      t: el('div', { class: 'pane' }, tIn, fonts, el('div', { class: 'row' }, dots(),
        el('button', { class: 'primary', style: 'margin-left:auto', onclick: async () => { const v = tIn.value.trim(); if (!v) return alert('Digite o texto.'); done((await textToCanvas(v, font, color, 120)).toDataURL()); } }, 'Adotar e assinar'))),
      i: el('div', { class: 'pane' }, imgIn, el('div', { class: 'note' }, 'Foto da assinatura em papel branco. O fundo branco é removido automaticamente.')),
    };
    const tabs = el('div', { class: 'tabs' }, [['d', 'Desenhar'], ['t', 'Digitar'], ['i', 'Imagem']].map(([k, n], i) => el('button', {
      class: i ? '' : 'act', onclick: e => {
        tabs.querySelectorAll('button').forEach(b => b.classList.toggle('act', b === e.currentTarget));
        Object.entries(panes).forEach(([pk, p]) => p.classList.toggle('on', pk === k));
      },
    }, n)), el('button', { class: 'ghost', style: 'margin-left:auto', onclick: () => done(null) }, 'Cancelar'));
    const saved = getSaved();
    const m = el('div', { class: 'modal', onpointerdown: e => { if (e.target === m) done(null); } },
      el('div', { class: 'box' }, el('h3', {}, kind === 'initials' ? 'Criar rubrica' : 'Criar assinatura'), tabs, panes.d, panes.t, panes.i,
        saved.length ? el('div', { class: 'note' }, 'Usadas antes neste navegador:') : '',
        el('div', { class: 'saved' }, saved.map(u => el('img', { src: u, onclick: () => done(u) })))));
    document.body.append(m);
  });
}
