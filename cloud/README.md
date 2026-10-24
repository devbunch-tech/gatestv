# GATES! TV na Cloudflare (grátis)

Endereço: **https://gatesapptv.pages.dev** — site (`/`), checkout (`/assinar`), área do assinante
(`/conta`), painel (`/admin`), ativação da TV (`/ativar`) e o servidor de licenças usado pelos apps.

- **Cloudflare Pages + Functions** (plano grátis, uso comercial permitido) e banco **D1** (`gatesapptv`).
- Mesmas regras do `license-server` (Node): checkout próprio + Asaas, aviso de 4 dias, suspensão,
  limite de aparelhos, pareamento da TV, área do assinante e painel.
- As páginas são as mesmas de `license-server/public` (copiadas a cada publicação).

## Publicar

```
node cloud/deploy.mjs              # publica as alterações
node cloud/deploy.mjs --segredos   # também regrava os segredos (depois de trocar a chave do Asaas, etc.)
```

Segredos guardados na Cloudflare (não ficam no site nem nos apps): `ASAAS_API_KEY` (lida de
`license-server/.env`), `ADMIN_TOKEN` (senha do painel), `ASAAS_WEBHOOK_TOKEN`, `LICENSE_PRIVATE_JWK`
(mesma chave de `license-server/data/license-private.pem`), `APP_TMDB_KEY`, `APP_OMDB_KEY`.
Cópia local dos gerados aqui: `cloud/.segredos.json` — **não compartilhe**.

Configurações públicas (planos, preços, links de download, WhatsApp): `cloud/wrangler.toml` → `[vars]`,
depois `node cloud/deploy.mjs`.

## Asaas

Webhook cadastrado: `https://gatesapptv.pages.dev/webhooks/asaas` (eventos de cobrança), com o token
`ASAAS_WEBHOOK_TOKEN`. Cada pagamento libera o assinante na hora.

## APKs

`VITE_LICENSE_API=https://gatesapptv.pages.dev node android/build-apk.mjs assinantes`

## Testar localmente

```
node cloud/deploy.mjs --local
node -e "import('./license-server/test/mock-asaas.mjs').then(m=>m.startMock(8795,{webhookUrl:'http://127.0.0.1:8788/webhooks/asaas',webhookToken:'tok-local',invoiceBase:'http://127.0.0.1:8795/fatura'}))"
cd cloud && npx wrangler@4.42.0 pages dev public --d1 DB=15edc610-e9c6-4300-aa29-91edca56ee76 --persist-to .wrangler/state --port 8788
node --test cloud/test/cloud.test.mjs
```
(`cloud/.dev.vars` aponta o Asaas para o simulado e usa a chave de teste.)
