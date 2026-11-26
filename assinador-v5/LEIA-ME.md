# Assinador (estilo DocuSign) — Netlify grátis

## Como publicar
O app tem backend (Netlify Functions + Blobs), então **não use só arrastar o HTML**. Escolha um jeito:

**A) GitHub (mais fácil de manter)**
1. Crie um repositório e suba todos estes arquivos.
2. Netlify → Add new site → Import from Git → escolha o repositório. Não precisa mudar nada (o `netlify.toml` já configura).

**B) Terminal (sem GitHub)**
```
npm i -g netlify-cli
netlify login
netlify init        # ou: netlify link
netlify deploy --prod
```

## Variáveis de ambiente (obrigatório)
Netlify → Site configuration → Environment variables:
- `ADMIN_PASSWORD` = a senha que você vai usar para entrar no painel

Depois de criar a variável, faça um novo deploy.

## Envio por e-mail (grátis, sem precisar de domínio) — usando o Gmail
Com isso, cada pessoa recebe um e-mail com o botão "Revisar e assinar" assim que for a vez dela. O e-mail sai do seu Gmail.

1. Entre na sua conta Google → **myaccount.google.com/security** → ative a **Verificação em duas etapas** (se ainda não estiver ativa).
2. Procure por **"Senhas de app"** (myaccount.google.com/apppasswords), dê o nome `Assinador` e clique em **Criar**. O Google mostra uma senha de 16 letras: copie.
3. No Netlify → Site configuration → Environment variables, crie:
   - `SMTP_USER` = seu e-mail do Gmail (ex.: `camille@gmail.com`)
   - `SMTP_PASS` = a senha de app de 16 letras (não é a senha normal do Gmail)
   - `NOTIFY_EMAIL` (opcional) = e-mail onde você quer ser avisada quando todos assinarem
   - `FROM_EMAIL` (opcional) = ex.: `Assinador Aetherlands <camille@gmail.com>`
4. Faça um novo deploy (Deploys → Trigger deploy).

Limite do Gmail: cerca de 500 e-mails por dia. Se o e-mail falhar, o painel mostra o motivo (⚠️) e o botão **Enviar e-mail** em "Links" tenta de novo. Você sempre pode copiar o link ou mandar pelo WhatsApp.

(Alternativa para quem tem domínio próprio: Resend — `RESEND_API_KEY` e `FROM_EMAIL`. O SMTP tem prioridade se os dois estiverem configurados.)

## Como usar
- Abra o site, entre com a senha, **Novo envelope**: adicione **um ou vários** PDFs/Words → destinatários → campos (em todos os documentos) → **Enviar**.
- Cada destinatário abre o link, assina e finaliza. Cada destinatário vê um botão **"Assinar aqui"** em cada campo que você colocou, em cada página de cada documento, e assina um por um. Quando todos assinam, cada documento ganha o seu PDF final (com página de certificado), disponível no painel e no link de cada um.

## Limites
- Até 10 documentos por envelope, cada um com até 6 MB. Aceita PDF e Word (.docx). O Word é convertido para PDF no navegador (cada página vira imagem), então o resultado pode diferir um pouco do Word original e o texto não fica selecionável. Se a fidelidade for crítica, exporte o PDF pelo próprio Word.
- Assinatura eletrônica simples (não é certificado ICP-Brasil).
