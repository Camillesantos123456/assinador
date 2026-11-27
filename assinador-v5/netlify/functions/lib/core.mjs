// Lógica da API (independente do Netlify para poder ser testada localmente).
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import crypto from 'node:crypto';

const TYPES = ['signature', 'initials', 'date', 'name', 'email', 'company', 'title', 'text', 'number', 'checkbox', 'dropdown'];
const AUTO = ['date', 'name', 'email'];
const MAX_PDF = 6 * 1024 * 1024;   // por documento
const MAX_DOCS = 10;
const TZ = 'America/Sao_Paulo';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const fail = (msg, status = 400) => json({ error: msg }, status);
const pdfResp = (bytes, name) => {
  const ascii = String(name).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return new Response(bytes, { status: 200, headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`, 'cache-control': 'no-store' } });
};

const safeEq = (a, b) => {
  const A = Buffer.from(String(a || '')), B = Buffer.from(String(b || ''));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
};
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = d => new Date(d).toLocaleDateString('pt-BR', { timeZone: TZ });
const fmtDateTime = d => new Date(d).toLocaleString('pt-BR', { timeZone: TZ });
const num = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

export function canSign(env, r) {
  if (env.status !== 'sent' || r.status !== 'pending') return false;
  if (!env.signingOrder) return true;
  return env.recipients.filter(o => o.order < r.order).every(o => o.status === 'signed');
}

// Envio de e-mail. Prioridade: SMTP (ex.: Gmail, grátis, sem domínio) -> Resend (precisa de domínio verificado).
// Retorna { ok, error }.
async function sendEmail(env, to, subject, html) {
  try {
    if (env.SMTP_USER && env.SMTP_PASS) {
      const nodemailer = (await import('nodemailer')).default;
      const port = parseInt(env.SMTP_PORT) || 465;
      const tr = nodemailer.createTransport({
        host: env.SMTP_HOST || 'smtp.gmail.com', port,
        secure: env.SMTP_SECURE ? env.SMTP_SECURE !== 'false' : port === 465,
        auth: { user: env.SMTP_USER, pass: String(env.SMTP_PASS).replace(/\s+/g, '') },
        connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 20000,
      });
      await tr.sendMail({ from: env.FROM_EMAIL || `Assinador <${env.SMTP_USER}>`, to, subject, html });
      return { ok: true };
    }
    if (env.RESEND_API_KEY && env.FROM_EMAIL) {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + env.RESEND_API_KEY },
        body: JSON.stringify({ from: env.FROM_EMAIL, to: [to], subject, html }),
      });
      if (r.ok) return { ok: true };
      const d = await r.json().catch(() => ({}));
      return { ok: false, error: d.message || 'Resend recusou o envio (HTTP ' + r.status + ')' };
    }
    return { ok: false, error: 'E-mail não configurado (defina SMTP_USER e SMTP_PASS).' };
  } catch (err) {
    console.error('Falha ao enviar e-mail', err);
    return { ok: false, error: String(err?.message || err).slice(0, 200) };
  }
}

const mailBody = (title, text, link, btn) =>
  `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:20px">
   <h2 style="margin:0 0 12px">${esc(title)}</h2>
   <p style="white-space:pre-wrap;color:#333">${esc(text)}</p>
   <p><a href="${esc(link)}" style="background:#4f00ff;color:#fff;padding:12px 22px;border-radius:6px;text-decoration:none;display:inline-block">${esc(btn)}</a></p>
   <p style="color:#888;font-size:12px">Se o botão não abrir, copie este link: ${esc(link)}</p></div>`;

async function inviteRecipient(env, e, r, origin) {
  const n = e.docs.length;
  const what = n > 1 ? `${n} documentos` : `o documento "${e.docs[0].name}"`;
  const res = await sendEmail(env, r.email, `Assinatura solicitada: ${e.title}`,
    mailBody(`${r.name}, você tem ${n > 1 ? n + ' documentos' : 'um documento'} para assinar`,
      e.message || `Por favor, revise e assine ${what} do envelope "${e.title}".`, `${origin}/sign.html?t=${r.token}`, 'Revisar e assinar'));
  r.emailSent = res.ok; r.emailError = res.ok ? undefined : res.error;
  if (res.ok) r.notifiedAt = Date.now();
  return res;
}

async function notifyEligible(env, e, origin) {
  for (const r of e.recipients) {
    if (!r.notifiedAt && canSign(e, r)) await inviteRecipient(env, e, r, origin);
  }
}

function dataUrlBytes(u) {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(u || '');
  return m ? Buffer.from(m[1], 'base64') : null;
}

// Lista de documentos do envelope (envelopes antigos tinham um único PDF, sem e.docs)
export const docList = e => e.docs || [{ name: e.title, key: `${e.id}.pdf`, finalKey: `${e.id}-final.pdf`, pageStart: 0, pageCount: e.pages.length }];

/* ---------- PDF final + certificado (um por documento) ---------- */
async function buildFinal(e, original, di) {
  const dd = docList(e)[di], total = docList(e).length;
  const doc = await PDFDocument.load(original);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const clean = s => [...String(s)].map(ch => { try { font.encodeText(ch); return ch; } catch { return '?'; } }).join('');
  const pages = doc.getPages();

  for (const f of e.fields) {
    const v = e.values[f.id];
    const lp = f.page - dd.pageStart;
    if (!v || lp < 0 || lp >= dd.pageCount || !pages[lp]) continue;
    const pg = pages[lp], { width: W, height: H } = pg.getSize();
    const x = f.x * W, w = f.w * W, h = f.h * H, y = H - f.y * H - h;
    if (f.type === 'signature' || f.type === 'initials') {
      const bytes = dataUrlBytes(v);
      if (!bytes) continue;
      const img = await doc.embedPng(bytes);
      if (f.type === 'initials') {
        const sc = Math.min(w / img.width, h / img.height);
        const iw = img.width * sc, ih = img.height * sc;
        pg.drawImage(img, { x: x + (w - iw) / 2, y: y + (h - ih) / 2, width: iw, height: ih });
      } else {
        // carimbo "Assinado por:" compacto (não cobre o texto do documento)
        const purple = rgb(0.30, 0, 0.78), fs = Math.max(3.5, Math.min(5.5, h * 0.14)), pad = 1.5, tk = 3;
        const label = 'Assinado por:', idTxt = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 16).toUpperCase() + '...';
        const lw = bold.widthOfTextAtSize(label, fs), iw2 = font.widthOfTextAtSize(idTxt, fs * 0.9);
        const ln = (x1, y1, x2, y2) => pg.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 0.8, color: purple });
        ln(x, y, x, y + h);                                   // barra vertical
        ln(x, y + h, x + tk, y + h); ln(x + tk + lw + 4, y + h, x + w * 0.9, y + h);   // topo (com o texto no meio)
        ln(x, y, x + tk, y); ln(x + tk + iw2 + 4, y, x + w * 0.9, y);                  // base
        pg.drawText(label, { x: x + tk + 2, y: y + h - fs * 0.35, size: fs, font: bold, color: rgb(0, 0, 0) });
        pg.drawText(idTxt, { x: x + tk + 2, y: y - fs * 0.35, size: fs * 0.9, font, color: rgb(0.35, 0.35, 0.35) });
        const top = y + h - fs - pad, bot = y + fs * 0.6 + pad, ah = Math.max(4, top - bot), aw = w - tk - 4;
        const sc = Math.min(aw / img.width, ah / img.height, 1);
        const sw = img.width * sc, sh = img.height * sc;
        pg.drawImage(img, { x: x + tk + 2, y: bot + (ah - sh) / 2, width: sw, height: sh });
      }
    } else if (f.type === 'checkbox') {
      if (v === 'true') {
        const p = Math.min(w, h) * 0.2;
        pg.drawLine({ start: { x: x + p, y: y + p }, end: { x: x + w - p, y: y + h - p }, thickness: 1.5, color: rgb(0, 0, 0) });
        pg.drawLine({ start: { x: x + p, y: y + h - p }, end: { x: x + w - p, y: y + p }, thickness: 1.5, color: rgb(0, 0, 0) });
      }
    } else {
      const t = clean(v);
      let size = Math.max(6, Math.min(12, h * 0.65));
      while (size > 5 && font.widthOfTextAtSize(t, size) > w - 4) size -= 0.5;
      pg.drawText(t, { x: x + 2, y: y + (h - size) / 2 + size * 0.15, size, font, color: rgb(0, 0, 0) });
    }
  }

  // Página de certificado
  const hash = crypto.createHash('sha256').update(Buffer.from(original)).digest('hex');
  let page = doc.addPage([595, 842]), cy = 800;
  const line = (t, o = {}) => {
    if (cy < 50) { page = doc.addPage([595, 842]); cy = 800; }
    page.drawText(clean(t), { x: o.x ?? 40, y: cy, size: o.size ?? 10, font: o.bold ? bold : font, color: o.color ?? rgb(0.1, 0.1, 0.1) });
    cy -= o.gap ?? 15;
  };
  line('Certificado de conclusão', { size: 20, bold: true, gap: 30 });
  line(`Documento: ${dd.name}${total > 1 ? `  (${di + 1} de ${total})` : ''}`, { bold: true });
  if (total > 1) line(`Envelope: ${e.title}`);
  line(`ID do envelope: ${e.id}`);
  line(`Hash SHA-256 do documento original:`);
  line(hash, { size: 8, gap: 22 });
  line(`Criado em: ${fmtDateTime(e.createdAt)}`);
  line(`Concluído em: ${fmtDateTime(e.completedAt)}`, { gap: 26 });
  line('Signatários', { size: 13, bold: true, gap: 20 });
  for (const r of e.recipients) {
    line(`${r.name}  <${r.email}>`, { bold: true });
    line(`Assinou em ${fmtDateTime(r.signedAt)}  |  IP: ${r.ip || 'n/d'}`, { x: 52, gap: 20 });
  }
  cy -= 8;
  line('Histórico', { size: 13, bold: true, gap: 20 });
  for (const a of e.audit) line(`${fmtDateTime(a.t)}  -  ${a.event}${a.who ? ' (' + a.who + ')' : ''}`, { size: 9, gap: 13 });
  return await doc.save();
}

async function getFinal(e, docs, di) {
  const dd = docList(e)[di];
  if (!dd) return null;
  const cached = await docs.get(dd.finalKey, { type: 'arrayBuffer' });
  if (cached) return cached;
  const orig = await docs.get(dd.key, { type: 'arrayBuffer' });
  if (!orig) return null;
  const out = await buildFinal(e, orig, di);
  await docs.set(dd.finalKey, out);
  return out;
}
const docIdx = (e, v) => { const i = Number(v); return Number.isInteger(i) && i >= 0 && i < docList(e).length ? i : -1; };

/* ---------- roteador ---------- */
export async function handle(req, { getStore, env }) {
  try {
    return await route(req, { getStore, env });
  } catch (err) {
    console.error(err);
    return fail('Erro interno: ' + (err?.message || err), 500);
  }
}

async function route(req, { getStore, env }) {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
  const method = req.method;
  const origin = url.origin;
  const envs = getStore('envelopes'), docs = getStore('docs'), toks = getStore('tokens');
  const load = id => envs.get(id, { type: 'json' });
  const save = e => envs.setJSON(e.id, e);
  const ip = req.headers.get('x-nf-client-connection-ip') || (req.headers.get('x-forwarded-for') || '').split(',')[0].trim();
  const withLinks = e => ({ ...e, values: undefined, recipients: e.recipients.map(r => ({ ...r, link: `${origin}/sign.html?t=${r.token}` })) });

  /* ----- signatário (acesso por token) ----- */
  if (path[0] === 'sign') {
    const token = path[1];
    const id = token && (await toks.get(token));
    const e = id && (await load(id));
    if (!e) return fail('Link inválido ou expirado.', 404);
    const me = e.recipients.find(r => r.token === token);
    if (!me) return fail('Link inválido.', 404);

    if (method === 'GET' && path.length === 2) {
      if (!me.viewedAt) {
        me.viewedAt = Date.now();
        e.audit.push({ t: Date.now(), event: 'Documento visualizado', who: me.name, ip });
        await save(e);
      }
      const signedIds = new Set(e.recipients.filter(r => r.status === 'signed').map(r => r.id));
      return json({
        envelope: { id: e.id, title: e.title, message: e.message, status: e.status, pages: e.pages, signingOrder: e.signingOrder,
          docs: docList(e).map(d => ({ name: d.name, pageStart: d.pageStart, pageCount: d.pageCount })) },
        me: { id: me.id, name: me.name, email: me.email, status: me.status, canSign: canSign(e, me) },
        recipients: e.recipients.map(r => ({ id: r.id, name: r.name, order: r.order, status: r.status })),
        fields: e.fields.map(f => ({ ...f, mine: f.recipientId === me.id, value: (f.recipientId === me.id || signedIds.has(f.recipientId)) ? e.values[f.id] : undefined })),
      });
    }
    if (method === 'GET' && path[2] === 'pdf') {
      const di = docIdx(e, path[3] ?? 0);
      const b = di >= 0 && await docs.get(docList(e)[di].key, { type: 'arrayBuffer' });
      return b ? pdfResp(b, 'documento.pdf') : fail('PDF não encontrado.', 404);
    }
    if (method === 'GET' && path[2] === 'final') {
      if (e.status !== 'completed') return fail('Os documentos ainda não foram concluídos por todos.', 409);
      const di = docIdx(e, path[3] ?? 0);
      const b = di >= 0 && await getFinal(e, docs, di);
      return b ? pdfResp(b, `${docList(e)[di].name}-assinado.pdf`) : fail('PDF não encontrado.', 404);
    }
    if (method === 'POST' && path.length === 2) {
      if (!canSign(e, me)) {
        if (me.status === 'signed') return fail('Você já assinou este documento.', 409);
        if (e.status === 'voided') return fail('Este envelope foi cancelado.', 409);
        return fail('Ainda não é a sua vez de assinar.', 409);
      }
      const body = await req.json().catch(() => null);
      const vals = body?.values || {};
      const mine = e.fields.filter(f => f.recipientId === me.id);
      const out = {};
      for (const f of mine) {
        let v;
        if (f.type === 'date') v = fmtDate(Date.now());
        else if (f.type === 'name') v = me.name;
        else if (f.type === 'email') v = me.email;
        else {
          v = vals[f.id];
          if (f.type === 'checkbox') v = (v === true || v === 'true') ? 'true' : '';
          else if (v == null) v = '';
          else v = String(v);
        }
        if (f.required && !v) return fail('Há campos obrigatórios sem preencher.');
        if (!v) continue;
        if (f.type === 'signature' || f.type === 'initials') {
          if (!dataUrlBytes(v) || v.length > 400000) return fail('Assinatura inválida.');
        } else if (v.length > 500) return fail('Texto muito longo.');
        if (f.type === 'number' && !/^-?\d+([.,]\d+)?$/.test(v.trim())) return fail('Há um campo numérico com valor inválido.');
        if (f.type === 'dropdown' && !(f.options || []).includes(v)) return fail('Opção inválida.');
        out[f.id] = v;
      }
      Object.assign(e.values, out);
      me.status = 'signed'; me.signedAt = Date.now(); me.ip = ip;
      e.audit.push({ t: Date.now(), event: 'Documento assinado', who: me.name, ip });
      if (e.recipients.every(r => r.status === 'signed')) {
        e.status = 'completed'; e.completedAt = Date.now();
        e.audit.push({ t: Date.now(), event: 'Envelope concluído' });
        await save(e);
        const plural = docList(e).length > 1;
        for (const r of e.recipients) {
          await sendEmail(env, r.email, `Concluído: ${e.title}`,
            mailBody(plural ? 'Documentos concluídos' : 'Documento concluído', `Todos assinaram "${e.title}". Use o botão para baixar ${plural ? 'as cópias finais' : 'a cópia final'}.`, `${origin}/sign.html?t=${r.token}`, plural ? 'Baixar documentos' : 'Baixar documento'));
        }
        if (env.NOTIFY_EMAIL) await sendEmail(env, env.NOTIFY_EMAIL, `Concluído: ${e.title}`, mailBody('Documento concluído', `Todos assinaram "${e.title}".`, origin, 'Abrir painel'));
      } else {
        await notifyEligible(env, e, origin);
        await save(e);
      }
      return json({ ok: true, completed: e.status === 'completed' });
    }
    return fail('Rota não encontrada.', 404);
  }

  /* ----- remetente (senha de administrador) ----- */
  if (path[0] !== 'envelopes') return fail('Rota não encontrada.', 404);
  if (!env.ADMIN_PASSWORD) return fail('Defina a variável de ambiente ADMIN_PASSWORD no Netlify.', 500);
  if (!safeEq(req.headers.get('x-admin-key'), env.ADMIN_PASSWORD)) return fail('Senha incorreta.', 401);

  if (path.length === 1 && method === 'GET') {
    const { blobs } = await envs.list();
    const all = (await Promise.all(blobs.map(b => load(b.key)))).filter(Boolean);
    all.sort((a, b) => b.createdAt - a.createdAt);
    return json(all.slice(0, 100).map(e => ({
      id: e.id, title: e.title, status: e.status, createdAt: e.createdAt, completedAt: e.completedAt, docs: docList(e).map(d => d.name),
      recipients: e.recipients.map(r => ({ name: r.name, email: r.email, status: r.status })),
    })));
  }

  if (path.length === 1 && method === 'POST') {
    const b = await req.json().catch(() => null);
    if (!b) return fail('Corpo inválido.');
    const title = String(b.title || '').trim().slice(0, 200);
    if (!title) return fail('Informe um título.');
    if (!Array.isArray(b.recipients) || !b.recipients.length || b.recipients.length > 20) return fail('Adicione de 1 a 20 destinatários.');
    if (!Array.isArray(b.docs) || !b.docs.length || b.docs.length > MAX_DOCS) return fail(`Adicione de 1 a ${MAX_DOCS} documentos.`);
    const pages = [], dlist = [];
    for (const [i, d] of b.docs.entries()) {
      if (!Array.isArray(d.pages) || !d.pages.length) return fail('Documento sem páginas.');
      dlist.push({ name: String(d.name || `Documento ${i + 1}`).trim().slice(0, 200), key: '', finalKey: '', pageStart: pages.length, pageCount: d.pages.length, uploaded: false });
      for (const p of d.pages) pages.push({ w: Number(p.w) || 595, h: Number(p.h) || 842 });
    }
    if (pages.length > 500) return fail('Páginas demais (máximo 500 no total).');
    const seen = new Set();
    const recipients = b.recipients.map((r, i) => {
      let id = String(r.id || 'r' + i).replace(/[^\w-]/g, '').slice(0, 40) || 'r' + i;
      while (seen.has(id)) id += 'x';
      seen.add(id);
      return {
        id, name: String(r.name || '').trim().slice(0, 120), email: String(r.email || '').trim().slice(0, 200),
        order: Math.max(1, Math.min(99, parseInt(r.order) || 1)), status: 'pending', token: crypto.randomBytes(18).toString('base64url'),
      };
    });
    if (recipients.some(r => !r.name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.email))) return fail('Preencha nome e e-mail válidos de todos os destinatários.');
    const fields = (Array.isArray(b.fields) ? b.fields : []).slice(0, 500).map(f => ({
      id: String(f.id || crypto.randomUUID()).replace(/[^\w-]/g, '').slice(0, 40),
      recipientId: f.recipientId, type: f.type, page: f.page, x: f.x, y: f.y, w: f.w, h: f.h,
      required: f.required !== false, options: Array.isArray(f.options) ? f.options.map(o => String(o).slice(0, 80)).slice(0, 30) : undefined,
    }));
    for (const f of fields) {
      if (!seen.has(f.recipientId) || !TYPES.includes(f.type) || !Number.isInteger(f.page) || f.page < 0 || f.page >= pages.length ||
        !num(f.x, 0, 1) || !num(f.y, 0, 1) || !num(f.w, 0.005, 1) || !num(f.h, 0.005, 1)) return fail('Há um campo inválido.');
    }
    for (const r of recipients) if (!fields.some(f => f.recipientId === r.id && (f.type === 'signature' || f.type === 'initials')))
      return fail(`Adicione ao menos um campo de assinatura para ${r.name}.`);
    const id = crypto.randomUUID();
    dlist.forEach((d, i) => { d.key = `${id}-d${i}.pdf`; d.finalKey = `${id}-d${i}-final.pdf`; });
    const e = {
      id, title, message: String(b.message || '').slice(0, 2000), signingOrder: !!b.signingOrder,
      status: 'draft', createdAt: Date.now(), docs: dlist, pages,
      recipients, fields, values: {}, audit: [{ t: Date.now(), event: 'Envelope criado' }],
    };
    for (const r of recipients) await toks.set(r.token, e.id);
    await save(e);
    return json({ id: e.id });
  }

  const e = await load(path[1]);
  if (!e) return fail('Envelope não encontrado.', 404);

  if (path[2] === 'pdf' && method === 'PUT') {
    if (e.status !== 'draft') return fail('Envelope já enviado.', 409);
    const di = docIdx(e, path[3] ?? 0);
    if (di < 0) return fail('Documento inexistente.', 404);
    const buf = await req.arrayBuffer();
    if (buf.byteLength > MAX_PDF) return fail('PDF acima de 6 MB (limite das funções gratuitas da Netlify).', 413);
    if (Buffer.from(buf.slice(0, 5)).toString() !== '%PDF-') return fail('O arquivo não é um PDF.');
    await docs.set(docList(e)[di].key, buf);
    if (e.docs) e.docs[di].uploaded = true;
    await save(e);
    return json({ ok: true });
  }
  if (path[2] === 'pdf' && method === 'GET') {
    const di = docIdx(e, path[3] ?? 0);
    if (di < 0) return fail('Documento inexistente.', 404);
    const fin = url.searchParams.get('final') && e.status === 'completed';
    const b = fin ? await getFinal(e, docs, di) : await docs.get(docList(e)[di].key, { type: 'arrayBuffer' });
    return b ? pdfResp(b, `${docList(e)[di].name}${fin ? '-assinado' : ''}.pdf`) : fail('PDF não encontrado.', 404);
  }
  if (path[2] === 'send' && method === 'POST') {
    if (e.status !== 'draft') return fail('Envelope já enviado.', 409);
    if (e.docs && !e.docs.every(d => d.uploaded)) return fail('Envie todos os documentos antes.');
    e.status = 'sent';
    e.audit.push({ t: Date.now(), event: 'Envelope enviado' });
    await notifyEligible(env, e, origin);
    await save(e);
    return json(withLinks(e));
  }
  if (path[2] === 'resend' && method === 'POST') {
    const b = await req.json().catch(() => ({}));
    const r = e.recipients.find(x => x.id === b?.recipientId);
    if (!r) return fail('Destinatário não encontrado.', 404);
    if (!canSign(e, r)) return fail('Esse destinatário não pode assinar agora (já assinou, aguarda a vez ou o envelope foi cancelado).', 409);
    const res = await inviteRecipient(env, e, r, origin);
    await save(e);
    return json({ ok: res.ok, error: res.error });
  }
  if (path[2] === 'void' && method === 'POST') {
    if (e.status !== 'sent') return fail('Só dá para cancelar envelopes em andamento.', 409);
    e.status = 'voided';
    e.audit.push({ t: Date.now(), event: 'Envelope cancelado' });
    await save(e);
    return json({ ok: true });
  }
  if (!path[2] && method === 'GET') return json(withLinks(e));
  if (!path[2] && method === 'DELETE') {
    for (const r of e.recipients) await toks.delete(r.token);
    for (const d of docList(e)) { await docs.delete(d.key); await docs.delete(d.finalKey); }
    await envs.delete(e.id);
    return json({ ok: true });
  }
  return fail('Rota não encontrada.', 404);
}
