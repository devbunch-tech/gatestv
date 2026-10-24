# Servidor de licenças — GATES! TV

> **Padrão: checkout próprio + Asaas** (`STORE_PROVIDER=checkout`). Sem loja virtual e sem mensalidade de
> plataforma: o Asaas cobra só uma taxa por pagamento recebido (PIX, boleto ou cartão).
>
> - `/` — site (landing page) com recursos, planos, como funciona e dúvidas; `/conta` — área do assinante
>   (situação, validade, código, pagar/renovar, aparelhos e cancelamento), com e-mail + CPF.
> - `/assinar` — página de assinatura (planos em `PLANS`). Cria o cliente e a assinatura no Asaas e mostra
>   o **código de acesso** + o botão de pagamento.
> - `/admin` — painel (senha = `ADMIN_TOKEN`): assinantes, situação, liberar, bloquear, cancelar
>   cobranças, remover aparelhos, assinante manual (cortesia/venda por fora).
> - `/webhooks/asaas` — cadastre no Asaas (Integrações → Webhooks, eventos de cobrança) com o token
>   `ASAAS_WEBHOOK_TOKEN`. Cada pagamento libera o assinante na hora.
> - No app, o cliente entra com **e-mail + CPF** (ou o código de acesso). O CPF fica só como hash.
>
> Para começar: crie a conta no Asaas (primeiro em sandbox.asaas.com para testar), copie a chave de API
> para `ASAAS_API_KEY`, defina `ADMIN_TOKEN` e `PUBLIC_URL` e publique o servidor com HTTPS.
> Nuvemshop e Shopify continuam disponíveis como alternativas.


> **Loja:** a loja padrão é a **Nuvemshop** (`STORE_PROVIDER=nuvemshop`, conector em
> `lib/providers/nuvemshop.mjs`, **pré-pronto**). O Shopify continua disponível como alternativa
> (`STORE_PROVIDER=shopify`). O app não muda: ele só conversa com este servidor.

## Conectar à Nuvemshop (pré-pronto)

1. No **Portal de Parceiros** da Nuvemshop, crie um app com os escopos `read_customers`, `read_orders`
   e `write_webhooks`, e instale-o na sua loja. Da instalação saem o **id da loja** e o **token de acesso**:
   coloque em `NS_STORE_ID` / `NS_ACCESS_TOKEN`. O "client secret" do app vai em `NS_APP_SECRET`.
2. Nomeie os SKUs dos planos começando com `GATES` (ex.: `GATES-MENSAL`, `GATES-ANUAL`).
3. `node license-server/cli.mjs testar-loja` confere a conexão.
4. `node license-server/cli.mjs registrar-webhooks` cadastra `order/paid`, `order/updated` e
   `order/cancelled` → `PUBLIC_URL/webhooks/nuvemshop` (assinatura HMAC conferida; o pedido é sempre
   reconsultado na API).
5. Liberar/bloquear manualmente: escreva `gates-liberado` ou `gates-bloqueado` na **nota do cliente**.
6. Ainda a definir com você: como a cobrança recorrente é feita na Nuvemshop (app de assinaturas que gera
   um pedido por mês? pagamento recorrente do meio de pagamento?). Pontos marcados "A CONFIRMAR".

Teste sem loja: `npm run teste:servidor` (usa a Nuvemshop simulada, `test/mock-nuvemshop.mjs`).

Valida se o assinante está com a mensalidade paga no Shopify e entrega ao app uma **licença assinada
digitalmente** (ECDSA P-256). O app só confere a assinatura com a chave pública; o token do Shopify e a
chave privada ficam **apenas aqui no servidor**, nunca dentro do APK.

Sem dependências: só Node.js 18+.

## Como funciona

1. O cliente assina no Shopify (Shopify Subscriptions, Recharge, Appstle… — qualquer app de assinatura,
   porque todos geram um **pedido pago** a cada cobrança).
2. No app ele entra com o **e-mail da compra + número do pedido**. Na TV aparece um **código**; o cliente
   confirma em `PUBLIC_URL/ativar` pelo celular.
3. O servidor consulta os pedidos do cliente no Shopify e calcula a situação:

| Situação | Quando | No app |
|---|---|---|
| `active` | pago até a data do último período (+ folga de `PAYMENT_TOLERANCE_HOURS`) | assiste normalmente |
| `grace` | venceu há menos de `GRACE_DAYS` (4) dias | assiste + aviso **1 vez**: "em até 4 dias a assinatura será suspensa" |
| `suspended` | passou do prazo, sem assinatura ou cliente bloqueado | tela de renovação |

4. A cada nova cobrança, o webhook `orders/paid` renova na hora. O app renova a licença ao abrir e a cada
   6 horas; sem internet, a última licença vale por mais alguns dias (`TOKEN_DAYS` + 7).

Duração: cada pedido pago soma o período do plano (`SUBSCRIPTION_PLANS`, pelo SKU), contado a partir do
pagamento ou do fim do período anterior. Pedidos cancelados ou reembolsados não contam.

## Colocar no ar

1. Copie `.env.example` para `.env` e preencha.
2. `node license-server/server.mjs` (ou `npm run license-server`). Na 1ª execução é criada a chave privada
   em `data/license-private.pem` — **faça backup e não compartilhe**. A chave pública aparece no console;
   ela já está em `src/config/license.js` (se gerar outra chave, atualize lá e gere os APKs de novo).
3. Publique com **HTTPS** num domínio seu (ex.: `https://licenca.seudominio.com.br`) — Render, Railway,
   Fly.io, uma VPS com Nginx/Caddy… O `Dockerfile` desta pasta já serve. Guarde a pasta `data/` em disco
   persistente e leve junto a **mesma** chave privada (arquivo `data/license-private.pem` ou variável
   `LICENSE_PRIVATE_KEY`): com outra chave, os APKs já distribuídos recusam as licenças.
4. Gere os APKs de assinantes apontando para esse endereço:
   `VITE_LICENSE_API=https://licenca.seudominio.com.br npm run build:assinantes`

## Conectar ao Shopify

1. No Shopify, crie um app para a loja (Configurações → Apps → Desenvolver apps, ou o Dev Dashboard) com os
   escopos **`read_customers`** e **`read_orders`**.
2. Coloque no `.env`: `SHOPIFY_SHOP=sua-loja.myshopify.com` e **ou** `SHOPIFY_ADMIN_TOKEN=shpat_...`
   **ou** `SHOPIFY_CLIENT_ID` + `SHOPIFY_CLIENT_SECRET` (o token é obtido e renovado sozinho).
   `SHOPIFY_WEBHOOK_SECRET` = o "client secret" do app (se vazio, usa o `SHOPIFY_CLIENT_SECRET`).
3. Diga quais produtos são a assinatura: `SUBSCRIPTION_SKU_PREFIXES=GATES` (SKU dos planos começando com
   GATES, ex.: `GATES-MENSAL`, `GATES-ANUAL`) e/ou `SUBSCRIPTION_PRODUCT_IDS`.
4. Teste: `node license-server/cli.mjs testar-shopify`
5. Cadastre os webhooks: `node license-server/cli.mjs registrar-webhooks`
   (orders/paid, orders/updated, orders/cancelled, refunds/create, customers/update →
   `PUBLIC_URL/webhooks/shopify`).
6. Opcional: no e-mail de confirmação do pedido, inclua o link do APK e o texto "para ativar use este e-mail
   e o número do pedido {{ order.name }}".

## Administração

Tags de cliente no Shopify: `gates-liberado` (libera sem pagamento, ex.: cortesia) e `gates-bloqueado`.

Linha de comando:

```
node license-server/cli.mjs listar
node license-server/cli.mjs ver cliente@email.com
node license-server/cli.mjs sincronizar cliente@email.com
node license-server/cli.mjs liberar cliente@email.com 2026-12-31
node license-server/cli.mjs bloquear cliente@email.com
node license-server/cli.mjs normal cliente@email.com
node license-server/cli.mjs remover-aparelho cliente@email.com <id>
```

API (cabeçalho `Authorization: Bearer ADMIN_TOKEN`):
`GET /admin/api/customers?q=`, `GET|POST|DELETE /admin/api/customers/<email>`,
`POST /admin/api/customers/<email>/sync`, `DELETE /admin/api/customers/<email>/devices/<id>`.

## API do app

| Rota | Uso |
|---|---|
| `POST /api/v1/activate` `{email, order, deviceId, deviceName, platform}` | ativa o aparelho |
| `POST /api/v1/refresh` `{token, deviceId}` | renova a licença |
| `POST /api/v1/logout` `{token}` | libera a vaga do aparelho |
| `POST /api/v1/pair/start` · `GET /api/v1/pair/poll?id=` · `POST /api/v1/pair/confirm` | ativação por código (TV) |
| `GET /ativar` | página de ativação para o celular |
| `POST /webhooks/shopify` | webhooks (HMAC conferido) |
| `GET /health` · `GET /api/v1/public-key` | verificação |

Limite de aparelhos por assinatura: `MAX_DEVICES` (aparelhos sem uso há 30 dias liberam a vaga).

## Testes

- `npm run test:license` — 7 cenários com um Shopify simulado (em dia, aviso, suspenso, webhooks com HMAC,
  limite de aparelhos, pareamento, bloqueio/liberação).
- Demonstração sem loja: `node license-server/test/mock-shopify.mjs 8799` e, em outro terminal,
  `SHOPIFY_API_BASE=http://127.0.0.1:8799 SUBSCRIPTION_SKU_PREFIXES=GATES node license-server/server.mjs`.
  Clientes: `em-dia@teste.com #1001`, `atrasado@teste.com #1002`, `suspenso@teste.com #1003`.
