// Canais exibidos na troca rápida de canais do player (lista lateral e ▲▼ / CH+ CH−).
// Ordem da lista = ordem destas regras; "section" é o título exibido no painel de canais.
// Um canal nunca aparece duas vezes: as várias versões (HD, FHD, SD, alternativas…) viram uma
// só, e é usada a versão HD que estiver funcionando.
//
// test(nome, grupo): ambos normalizados (minúsculas, sem acentos e sem marcações de qualidade).
// all: true  -> inclui todos os canais que casarem (ex.: HBO, HBO 2, HBO Family…)
// sem "all"  -> inclui só um canal; "prefer" escolhe a opção preferida (ex.: a da capital)
const GROUP = (re) => (n, g) => re.test(g);

export const ZAP_RULES = [
  // Canais abertos
  { section: 'Canais abertos', label: 'Globo NSC', prefer: /florianopolis/, test: (n) => /\bnsc\b/.test(n) && !/\brecord\b/.test(n) },
  { section: 'Canais abertos', label: 'Globo RJ', test: (n) => /\bglobo\b/.test(n) && /\b(rj|rio( de janeiro)?)\b/.test(n) && !/\bnews\b/.test(n) },
  // Record SC é a NDTV (afiliada da Record em Santa Catarina).
  { section: 'Canais abertos', label: 'Record NSC', prefer: /\bnd ?tv\b|florianopolis/, test: (n) => /\brecord\b/.test(n) && /\b(sc|nsc|nd ?tv|florianopolis|santa catarina)\b/.test(n) && !/\bnews\b/.test(n) },
  { section: 'Canais abertos', label: 'Record RJ', test: (n) => /\brecord\b/.test(n) && /\b(rj|rio( de janeiro)?)\b/.test(n) && !/\bnews\b/.test(n) },
  { section: 'Canais abertos', label: 'SBT', test: (n) => /\bsbt\b/.test(n) },
  { section: 'Canais abertos', label: 'RedeTV', test: (n) => /\brede ?tv\b/.test(n) },
  { section: 'Canais abertos', label: 'CNT', test: (n) => /\bcnt\b/.test(n) },
  { section: 'Canais abertos', label: 'TV Câmara', test: (n) => /\btv camara\b/.test(n) },
  { section: 'Canais abertos', label: 'TV Senado', test: (n) => /\btv senado\b/.test(n) },
  { section: 'Canais abertos', label: 'TVE', test: (n) => /\btve\b/.test(n) },

  // Esportes
  { section: 'Esportes', label: 'SporTV', all: true, test: (n, g) => /\bsportv\b/.test(n) || /\bsportv\b/.test(g) },
  { section: 'Esportes', label: 'ESPN', all: true, test: (n) => /\bespn\b/.test(n) },
  // "Universal Premiere" é canal de filmes, não do Premiere (futebol).
  { section: 'Esportes', label: 'Premiere', all: true, test: (n, g) => (/\bpremiere\b/.test(n) || /\bpremiere\b/.test(g)) && !/\buniversal\b/.test(n) },
  { section: 'Esportes', label: 'Combate', all: true, test: (n) => /\bcombate\b/.test(n) },
  { section: 'Esportes', label: 'UFC Fight Pass', all: true, test: (n) => /\bufc\b/.test(n) || /\bfight ?pass\b/.test(n) },
  { section: 'Esportes', label: 'GE TV', all: true, test: (n) => /\bge ?tv\b/.test(n) },
  { section: 'Esportes', label: 'CazéTV', all: true, test: (n) => /\bcaze ?tv\b/.test(n) },


  // Filmes e séries
  { section: 'Filmes e Séries', label: 'HBO', all: true, test: (n) => /\bhbo\b/.test(n) },
  { section: 'Filmes e Séries', label: 'Telecine', all: true, test: (n) => /\btelecine\b/.test(n) },
  { section: 'Filmes e Séries', label: 'Warner', prefer: /\bchannel\b/, test: (n) => /\bwarner\b/.test(n) },
  { section: 'Filmes e Séries', label: 'Megapix', test: (n) => /\bmegapix\b/.test(n) },
  { section: 'Filmes e Séries', label: 'AXN', test: (n) => /\baxn\b/.test(n) },
  { section: 'Filmes e Séries', label: 'Film&Arts', test: (n) => /\bfilm ?(&|and|e) ?arts\b/.test(n) },
  { section: 'Filmes e Séries', label: 'Sony Movies', test: (n) => /\bsony movies\b/.test(n) },
  { section: 'Filmes e Séries', label: 'Sony', prefer: /\bchannel\b/, test: (n) => /\bsony\b/.test(n) },
  { section: 'Filmes e Séries', label: 'AMC', test: (n) => /\bamc\b/.test(n) },
  { section: 'Filmes e Séries', label: 'Cinemax', test: (n) => /\bcinemax\b/.test(n) },
  // Canais Universal (NBCUniversal) — exclui a Igreja Universal / TV Universal (religiosos).
  { section: 'Filmes e Séries', label: 'Universal', all: true, test: (n) => /\buniversal\b/.test(n) && !/\bigreja\b|^tv universal\b/.test(n) },

  // Documentários
  { section: 'Documentários', label: 'Discovery', all: true, test: (n) => /\bdiscovery\b/.test(n) },
  { section: 'Documentários', label: 'History', all: true, test: (n) => /\bhistory\b|\bh2\b/.test(n) },
  { section: 'Documentários', label: 'Grupo Documentários', all: true, test: GROUP(/\bdocumentari(o|os)\b/) },

  // Música
  { section: 'Música', label: 'MTV', test: (n) => /\bmtv\b/.test(n) },
  { section: 'Música', label: 'Bis', test: (n) => /\bbis\b/.test(n) },

  // Grupos (categorias) inteiros da fonte.
  { section: 'Entretenimento', label: 'Entretenimento', all: true, test: GROUP(/\bentretenimento\b/) },
  { section: 'Variedades', label: 'Variedades', all: true, test: GROUP(/\bvariedades?\b/) },
  { section: 'Notícias', label: 'Jovem Pan News', test: (n) => /\bjovem pan\b/.test(n) && /\bnews\b/.test(n) },
  { section: 'Notícias', label: 'Record News', test: (n) => /\brecord news\b/.test(n) },
  { section: 'Notícias', label: 'Notícias', all: true, test: GROUP(/\b(noticias?|news|jornalismo)\b/) },
  { section: 'Infantil', label: 'Infantil', all: true, test: GROUP(/\b(infantil|infantis|kids|desenhos?|criancas?)\b/) },
];

// Nunca entram na troca rápida (nome ou grupo).
// "Jogos em Destaque" são transmissões avulsas de partidas (com horário no nome), não canais.
export const ZAP_EXCLUDE = /\b(ppv|radio|radios|teste|24h|24 horas|xxx|adulto|adultos|jogos em destaque)\b/;
// Canais fixos que algumas listas guardam no grupo "PPV" (ex.: "Esportes PPV"): entram mesmo assim.
export const ZAP_KEEP = /\b(combate|ufc|fight ?pass)\b/;

// Número do canal na lista que deve ser a versão principal do seu canal (as outras versões ficam
// de reserva, caso ela saia do ar). Ex.: o Combate é o 2431, não o 2433; UFC Fight Pass 3 = 2340,
// UFC Fight Pass 4 = 2342, UFC TV = 2344.
export const ZAP_PREFER_NUM = [2431, 2340, 2342, 2344];

// Quando o mesmo canal existe em 4K (ex.: grupo "4K" da fonte), a versão 4K é a usada;
// se ela estiver fora do ar ou o aparelho não conseguir reproduzi-la, entra a HD automaticamente.
export const PREFER_4K = true;
