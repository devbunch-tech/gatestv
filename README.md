# GATES! TV — IPTV (ambiente de testes)

Player IPTV web com interface no estilo Plex: home com destaque e carrosséis, guia de TV ao vivo, bibliotecas de filmes e séries, favoritos, "continuar assistindo" e busca.

## Como rodar

```bash
npm install
npm run dev
```

Abra http://localhost:5173, entre com a sua conta e adicione uma fonte (Xtream Codes ou M3U) em Configurações.

Para uma versão otimizada: `npm run build && npm run preview` (porta 4173 — o proxy também funciona no preview).

## Funcionalidades

- **Fontes de conteúdo** (Configurações): URL M3U, upload de arquivo `.m3u` ou login **Xtream Codes** (gera a URL `get.php` automaticamente).
- **Classificação automática** em canais / filmes / séries pelo `tvg-type`, pelo padrão da URL (`/movie/`, `/series/`), pelo nome (`S01E02`) ou pela categoria (`group-title`).
- **Séries** agrupadas por temporada, com avanço automático para o próximo episódio.
- **Player** com HLS (`hls.js`), MPEG-TS/FLV (`mpegts.js`) e MP4/MKV/WebM nativos. Atalhos: espaço, ←/→ (±10s), ↑/↓ (canal/episódio anterior e próximo), F, M, Esc.
- **Progresso e histórico**: retoma de onde parou; "Continuar assistindo" na home.
- **Proxy local** (`/proxy?url=...`) no servidor Vite para contornar CORS e conteúdo misto; reescreve playlists HLS para que segmentos também passem por ele. Pode ser desligado nas configurações.
- Listas grandes (dezenas de milhares de itens) são guardadas no IndexedDB e renderizadas de forma incremental.

## Conta e login

- Login local por e-mail e senha (contas em `src/config/accounts.js`). A senha não fica no código: só um hash com sal (SHA-256 iterado). Para trocar: `node scripts/hash-password.mjs "NovaSenha"` e cole `salt`/`hash` no arquivo.
- "Manter conectado" guarda a sessão por 30 dias no aparelho. "Sair da conta" fica no menu do avatar e na tela de perfis.
- ⚠️ Por ser 100% no navegador, este login é adequado para testes; para produção a verificação deve ir para um servidor (backend).

## Xtream Codes

- Importação pela API (`player_api.php`): canais, filmes e séries com categorias, datas de inclusão e capas; os episódios de cada série são buscados ao abrir a série.
- Guia de programação automático pelo `xmltv.php` do próprio servidor (lido em segundo plano por um Web Worker e filtrado para os canais da lista).
- Ao abrir o app, as fontes Xtream são verificadas (no máximo a cada 5 min) e as novidades são anunciadas. Os IDs são estáveis (`stream_id`), então itens ocultos/excluídos continuam ocultos. Listas Xtream importadas antes como M3U são convertidas automaticamente, preservando favoritos e ocultos.

## Latência

- Proxy em modo **automático**: o vídeo vai direto do servidor (sem intermediário); só servidores que bloqueiam o acesso direto passam pelo proxy, e ficam memorizados para as próximas trocas de canal.
- **Atraso do ao vivo (padrão 20 s):** o ao vivo é exibido 20 segundos atrás, com esses segundos sempre carregados, para não travar quando a internet oscila (Configurações → Reprodução: Mínimo, 10, 20 ou 30 s). Canais Xtream usam automaticamente a versão HLS (.m3u8), que já começa com o colchão cheio; streams .ts formam o colchão aos poucos, tocando 5% mais devagar.
- **Troca rápida de canais:** no player, a lista de canais e ▲▼ / CH+ CH− mostram só os canais e grupos configurados em `src/config/zapping.js` (Globo NSC/RJ, Record NSC/RJ, SBT, RedeTV, HBO, Telecine, SporTV, ESPN, Discovery, History, Warner, Megapix, MTV, Bis, Sony, AMC, Cinemax, Universal e os grupos Premiere, SporTV, Entretenimento, Notícias, Infantil, Variedades e Documentários). Cada canal aparece uma vez: versões HD/FHD/SD e alternativas ("HD²", "Opção 2", "[ALT]"…) viram uma só.
- **Validação das fontes:** ao abrir o app, cada canal da troca rápida é testado em segundo plano (um por vez, com pausa enquanto alguém assiste, para não ocupar conexões do provedor) e é usada a melhor versão HD que estiver no ar; canais sem nenhuma versão funcionando saem da lista. Se um canal cair durante a exibição, o player troca sozinho para a próxima versão que funcione. Status em Configurações → Reprodução.
- Modo TV sem desfoques/animações caras e com o app "congelado" por trás do player.

## Perfis de usuário

- Tela **"Quem está assistindo?"** ao abrir o app (com apenas um perfil sem PIN, entra direto). Até 8 perfis, com nome, avatar e cor.
- Cada perfil tem os próprios **favoritos, histórico, itens ocultos e excluídos e limite de classificação**. O **perfil master** ("Sergio e Paula") se sobrepõe: o que ele oculta ou exclui some para todos os perfis. Listas, EPG, chaves do TMDB, bloqueios e o PIN de controle parental são compartilhados.
- **Perfil infantil:** limite de classificação (padrão 10 anos), conteúdo acima do limite fica oculto, sem acesso a Configurações e às opções de bloquear/classificar/excluir (só com o PIN de controle parental).
- **PIN do perfil** (opcional) para entrar nele. Criar, editar ou excluir perfis exige o PIN de controle parental, quando existir.
- Fotos dos perfis em `public/avatars/` (definidas em `src/config/accounts.js`); também é possível enviar uma foto pelo editor de perfil. Marina, Melissa e Clark são infantis por padrão.
- Troca rápida pelo avatar no topo. Na migração, os dados que já existiam vão para o perfil master.

## Tela inicial

- **Destaques do esporte hoje** (quando houver jogos no dia): 2 da Premier League + 2 do Brasileirão Série A (jogos do Vasco têm prioridade) e os jogos do New England Patriots na NFL. Mostra pôster, escudos, rodada, horário (ou placar ao vivo) e o canal da sua lista que transmite. A agenda vem do TheSportsDB; o canal é descoberto pelo EPG.
- **Filmes** e **Séries adicionados recentemente** (10 de cada, sem repetir versões do mesmo título).
- **Filmes/Séries HBO, Netflix e Apple TV, Filmes Telecine, Séries Crunchyroll, Filmes/Séries Prime Video, Séries Starzplay - Lionsgate e Séries Universal+** (8 mais recentes de cada), identificados pela categoria da fonte (ex.: "FILMES | NETFLIX", "SÉRIES | HBO MAX") — regras em `src/config/homeSections.js`. "Ver tudo" abre a biblioteca filtrada pela plataforma.
- As seções de filmes e séries ficam em **cache por 3 dias** (por perfil) e aparecem na hora ao abrir o app; "Atualizar tela inicial" em Configurações → Fontes recalcula na hora.
- **Jogos ao vivo e próximos** (do EPG): os que estão acontecendo aparecem primeiro e somem quando terminam; Vasco, Premier League e Brasileirão têm prioridade; com escudos dos times.

## Filmes e Séries

- **Destaque no topo:** os 5 adicionados mais recentemente, trocando de forma aleatória a cada 8 s (pausa com o mouse em cima). Mostra fundo, título, ano, duração, gênero, a plataforma de streaming (pela categoria da fonte e, com TMDB, onde mais está disponível), a categoria da sua lista e, se o guia mostrar o título passando num canal ao vivo, qual canal e quando. Duração, sinopse e fundo vêm do Xtream (`get_vod_info` / `get_series_info`, cache de 7 dias) ou do TMDB.
- **Uma fileira por categoria** com 10 títulos, logo da plataforma (Netflix, Prime Video, HBO Max…) e "Ver todos". Categorias "(L)" (legendadas) são unidas às dubladas. A barra de categorias fica numa linha só, com as plataformas primeiro. Categorias adultas não viram fileira (continuam acessíveis pela barra). Plataformas reconhecidas em `src/config/platforms.js`.

## Dublado e legendado

Versões do mesmo título (Dublado, Legendado, 4K…) aparecem como **um item só**, mostrando a versão dublada; na página do título há a escolha da versão. Ocultar ou excluir vale para todas as versões. Quando só existe a versão legendada, o card mostra o selo "LEG".

## Onde assistir

Com a chave do TMDB, a página do título mostra em quais streamings do Brasil ele está disponível (assinatura, grátis, aluguel e compra), com dados do JustWatch.

## Controle remoto, EPG, parental e metadados

- **Controle remoto (Android TV / Google TV / Fire TV / teclado):** navegação por D-pad em todas as telas (ativa sozinha em TVs, ou com `?tv=1` / Configurações → Modo TV).
  No Ao Vivo: ▲▼ ou CH+/CH− trocam de canal, 0–9 sintoniza pelo número, OK/Info mostra o programa atual e os próximos, OK de novo abre detalhes (elenco/trailer), ◀ abre a lista de canais, Voltar fecha.
  Segurar OK (ou a tecla Menu) abre as opções do item. A tabela completa está em Configurações → Controle remoto.
- **Apple TV:** o tvOS não tem navegador nem WebView, então é preciso um app nativo (tvOS) que use as mesmas listas; a camada `src/lib/keys.js` já define os comandos que esse app repassaria.
- **Ocultar / bloquear / excluir:** pelo menu do item (canal, filme, série ou episódio). Tudo é reversível em Configurações → Conteúdo oculto, bloqueado e excluído.
- **Controle parental:** PIN de 4 dígitos, classificação máxima (L, 10, 12, 14, 16, 18), bloqueio de categorias, categorias adultas tratadas como 18, opção de ocultar em vez de pedir PIN. A classificação vem do EPG (programa atual), do TMDB (classificação do Brasil) ou é definida manualmente no menu do item. Desbloqueio vale por 10 minutos.
- **EPG (XMLTV, .xml/.xml.gz):** lido do cabeçalho `url-tvg` da lista ou adicionado manualmente; casado pelo `tvg-id` ou nome do canal. Fontes Xtream usam o `xmltv.php` do servidor automaticamente.
- **TMDB + IMDb:** com uma chave gratuita do TMDB (Configurações → Metadados) aparecem sinopse, elenco com fotos, trailers do YouTube, classificação, títulos relacionados e a página de cada ator/atriz com a filmografia — destacando o que já está nas suas listas. A nota do IMDb é opcional via chave do OMDb. Os programas do EPG também são buscados no TMDB.

## Estrutura

```
vite.config.js          servidor + proxy de streams
src/lib/m3u.js          parser M3U / M3U Plus e agrupamento de séries
src/lib/net.js          fetch, proxy, Xtream, detecção de formato
src/lib/keys.js         teclas do controle remoto e navegação espacial (D-pad)
src/lib/epg.js          parser XMLTV e utilitários de programação
src/lib/meta.js         cliente TMDB/OMDb com cache e limpeza de títulos
src/lib/parental.js     classificação indicativa
src/lib/sports.js       agenda esportiva, escudos e ligação com o EPG
src/lib/variants.js     agrupamento de versões dublado/legendado
src/lib/xtream.js       API Xtream Codes
src/store.jsx           estado global (listas, favoritos, histórico, configurações)
src/components/         Layout (topo + menu), cards/carrosséis, Player, Perfis (Profiles.jsx)
src/pages/              Início, TV ao Vivo, Filmes/Séries, Detalhes, Busca, Favoritos, Configurações
```

## Próximos passos sugeridos

- App nativo para Apple TV (tvOS) e empacotamento Android TV (WebView/APK).
- Grade de programação completa (linha do tempo) no estilo Plex.
- Backend próprio (autenticação, sincronização entre dispositivos) e proxy dedicado para produção.

> Use apenas listas e conteúdos que você tem direito de distribuir/assistir.

## Instaladores (Windows e Android TV)

- **Windows:** `npm run build:win` gera `release/GatesTV-Setup-<versão>.exe` (Electron + servidor local embutido na porta 47123). Abre sempre em tela cheia (F11 alterna) e tem, em Configurações → Computador, os botões "Desligar o computador" (shutdown /s em 3 s, via electron/preload.cjs) e "Fechar o GATES! TV".
- **Android TV:** `npm run build:android` gera `release/GatesTV-<versão>.apk` (WebView em tela cheia + servidor local em Java, `android/src`).
- **Celular e tablet:** `npm run build:mobile` gera `release/GatesTV-Celular-<versão>.apk` e `release/GatesTV-Tablet-<versão>.apk`; `npm run build:admin` gera `release/GatesTV-Celular-Admin-<versão>.apk` (celular sem login — sem e-mail/senha — com um único perfil "Admin", sem foto, avatar "ADM"; pacote `br.com.gatestv.admin`, porta 47126); `npm run build:apks` gera todas as versões. Cada versão tem pacote e porta próprios (`br.com.gatestv.app` / `.phone` / `.tablet`, portas 47123/47124/47125), definidos em `android/build-apk.mjs`, que também gera o AndroidManifest. No toque (`html.touch`, estilos em `src/styles-touch.css`): abas inferiores, fileiras com deslizar, segurar o dedo para opções e gestos no player (toque mostra controles, toque duplo nas laterais ±10 s, deslizar ▲▼ troca de canal, deslizar → abre a lista de canais). Usa o JDK 17 e o Android SDK em `%LOCALAPPDATA%\GatesBuildTools`. A chave de assinatura fica em `android/gatestv-release.keystore`: **guarde esse arquivo**, pois atualizações do APK precisam ser assinadas com a mesma chave.
- **Fontes já configuradas na primeira abertura:** preencha `src/config/defaults.js` (servidor/usuário/senha do Xtream e, opcionalmente, a chave do TMDB) e gere os instaladores de novo.
- Ao rodar os builds de dentro do VS Code, remova a variável `ELECTRON_RUN_AS_NODE` do terminal (o VS Code a define e ela impede o Electron de abrir).
- **Logos dos canais embutidos:** `npm run logos` baixa os logos dos canais da troca rápida da fonte padrão para `public/channel-logos/` (160 px). Logo quebrado no provedor usa o de outra versão do mesmo canal, de outra emissora da mesma rede ou o ícone oficial da emissora. Rode antes de gerar os instaladores quando a lista de canais mudar.

## Assinantes (Shopify) e modo LITE

- **App de assinantes:** `VITE_LICENSE_API=https://licenca.seudominio.com.br npm run build:assinantes` gera
  `GatesTV-Assinante-{TV,Celular,Tablet}[-LITE]-<versão>.apk`. Usa um build próprio (`dist-sub`, com
  `VITE_SUBSCRIBER=1`) **sem** a lista Xtream, as chaves, o e-mail e as fotos da família — o build é
  interrompido se algum desses dados aparecer. O assinante entra com o e-mail da compra + número do pedido
  (ou código na TV), adiciona a própria lista em Configurações e recebe as chaves TMDB/OMDb do servidor.
  Código: `src/components/LicenseGate.jsx`, `src/lib/license.js`, `src/config/license.js`.
- **Servidor de licenças** (validação da mensalidade no Shopify): ver [license-server/README.md](license-server/README.md).
- **Modo LITE** (`src/config/perf.js`, `src/styles-lite.css`): menos conteúdo por tela (Início com ~1/3 dos
  cards), categorias em blocos, sem rotação do destaque, imagens menores e sem desfoques/sombras/animações.
  Padrão nas versões `-LITE` e pode ser ligado/desligado em Configurações → Desempenho em qualquer versão.
