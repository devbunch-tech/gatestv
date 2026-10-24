// Estados para a Globo e a Record regionais. O cliente escolhe o estado e as versões daquele estado
// passam a ser as primeiras da lista de canais (e a Globo dele abre ao entrar em TV ao Vivo).
// Tudo é testado no nome normalizado do canal (minúsculas, sem acentos); os itens são trechos de regex.
//   globo/record: nomes das afiliadas que não levam "Globo"/"Record" no nome (ex.: RBS, NSC, NDTV).
//                 Valem também como indicação do estado, exceto os marcados com "~" (nome usado
//                 em mais de um estado, ex.: "TV Gazeta", "Rede Amazônica").
//   places: cidades/regiões do estado (além da sigla e do nome do estado).
//   capital: preferida quando há várias versões no estado (ex.: Florianópolis em vez de Blumenau).
//   not: nomes de outro estado que confundiriam (ex.: "Vale do Paraíba" é SP, não Paraíba).
export const STATES = [
  { uf: 'AC', name: 'Acre', globo: ['~rede amazonica'], record: [], places: ['rio branco'], capital: 'rio branco' },
  { uf: 'AL', name: 'Alagoas', globo: ['tv gazeta de alagoas'], record: ['pajucara'], places: ['maceio'], capital: 'maceio' },
  { uf: 'AP', name: 'Amapá', globo: ['~rede amazonica'], record: [], places: ['macapa'], capital: 'macapa' },
  { uf: 'AM', name: 'Amazonas', globo: ['~rede amazonica'], record: [], places: ['manaus'], capital: 'manaus' },
  { uf: 'BA', name: 'Bahia', globo: ['tv bahia', 'tv santa cruz', 'tv sudoeste', 'tv subae'], record: ['itapoan', 'tv cabralia'], places: ['salvador', 'itabuna', 'feira de santana'], capital: 'salvador|tv bahia|itapoan' },
  { uf: 'CE', name: 'Ceará', globo: ['verdes mares'], record: ['~tv cidade'], places: ['ceara', 'fortaleza'], capital: 'fortaleza' },
  { uf: 'DF', name: 'Distrito Federal', globo: [], record: [], places: ['brasilia'], capital: 'brasilia' },
  { uf: 'ES', name: 'Espírito Santo', globo: ['~gazeta'], record: ['tv vitoria'], places: ['vitoria'], capital: 'vitoria' },
  { uf: 'GO', name: 'Goiás', globo: ['tv anhanguera'], record: [], places: ['goiania', 'anapolis'], capital: 'goiania' },
  { uf: 'MA', name: 'Maranhão', globo: ['mirante'], record: [], places: ['sao luis'], capital: 'sao luis' },
  { uf: 'MT', name: 'Mato Grosso', globo: ['tv centro america'], record: [], places: ['cuiaba'], capital: 'cuiaba' },
  { uf: 'MS', name: 'Mato Grosso do Sul', globo: ['tv morena'], record: [], places: ['campo grande'], capital: 'campo grande' },
  { uf: 'MG', name: 'Minas Gerais', globo: ['tv integracao', 'integra', 'eptv sul minas'], record: ['paranaiba'], places: ['minas', 'bh', 'belo horizonte', 'juiz de fora', 'uberlandia', 'araxa'], capital: 'bh|belo horizonte|minas' },
  { uf: 'PA', name: 'Pará', globo: ['tv liberal', 'liberal'], record: [], places: ['belem'], capital: 'belem' },
  { uf: 'PB', name: 'Paraíba', globo: ['cabo branco', 'tv paraiba'], record: [], places: ['joao pessoa', 'campina grande'], capital: 'joao pessoa', not: 'vale do paraiba' },
  { uf: 'PR', name: 'Paraná', globo: ['rpc'], record: ['ric'], places: ['curitiba', 'maringa', 'londrina', 'cascavel'], capital: 'curitiba' },
  { uf: 'PE', name: 'Pernambuco', globo: ['globo nordeste'], record: [], places: ['recife'], capital: 'recife|nordeste' },
  { uf: 'PI', name: 'Piauí', globo: ['tv clube'], record: [], places: ['teresina'], capital: 'teresina' },
  { uf: 'RJ', name: 'Rio de Janeiro', globo: ['inter tv'], record: [], places: ['rio'], capital: 'rj|rio de janeiro' },
  { uf: 'RN', name: 'Rio Grande do Norte', globo: ['inter tv cabugi'], record: [], places: ['natal'], capital: 'natal' },
  { uf: 'RS', name: 'Rio Grande do Sul', globo: ['rbs'], record: [], places: ['porto alegre', 'santa maria', 'passo fundo'], capital: 'porto alegre|rbs tv|^rbs$' },
  { uf: 'RO', name: 'Rondônia', globo: ['~rede amazonica'], record: ['sic'], places: ['porto velho'], capital: 'porto velho' },
  { uf: 'RR', name: 'Roraima', globo: ['~rede amazonica'], record: [], places: ['boa vista'], capital: 'boa vista' },
  { uf: 'SC', name: 'Santa Catarina', globo: ['nsc'], record: ['nd ?tv'], places: ['florianopolis', 'floripa', 'blumenau', 'joinville', 'chapeco', 'criciuma'], capital: 'florianopolis|floripa|nd ?tv' },
  { uf: 'SP', name: 'São Paulo', globo: ['eptv', 'tv tem', 'vanguarda', 'tv diario', 'tribuna santos', 'globo tribuna'], record: ['thathi'], places: ['campinas', 'santos', 'sorocaba', 'bauru', 'ribeirao preto', 'vale do paraiba'], capital: 'sao paulo' },
  { uf: 'SE', name: 'Sergipe', globo: ['tv sergipe'], record: [], places: ['aracaju'], capital: 'aracaju' },
  { uf: 'TO', name: 'Tocantins', globo: ['tv anhanguera tocantins'], record: [], places: ['palmas'], capital: 'palmas' },
];

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const any = (list) => new RegExp(`\\b(${list.join('|')})\\b`);
const clean = (list) => list.map((a) => a.replace(/^~/, ''));
const unique = (list) => list.filter((a) => a[0] !== '~');

// Regras de troca rápida da Globo e da Record do estado (entram no topo de "Canais abertos").
export function regionRules(uf) {
  const st = STATES.find((s) => s.uf === uf);
  if (!st) return [];
  const where = [st.uf.toLowerCase(), norm(st.name), ...st.places];
  const rule = (net, aff, other) => {
    const who = any([net, ...clean(aff)]);
    const place = any([...where, ...unique(aff)]);
    const not = st.not ? any([st.not]) : null;
    return (n) => who.test(n) && place.test(n) && !other.test(n) && !(not && not.test(n));
  };
  const prefer = new RegExp(`\\b(${st.capital})\\b|^(tv )?(globo|record)( tv)? ${st.uf.toLowerCase()}\\b`);
  return [
    { section: 'Canais abertos', label: `Globo ${st.uf}`, region: true, prefer, test: rule('globo', st.globo, /\b(sbt|band|record|rede ?tv|cultura|news|play|sat)\b/) },
    { section: 'Canais abertos', label: `Record ${st.uf}`, region: true, prefer, test: rule('record', st.record, /\b(globo|sbt|band|rede ?tv|news|nacional)\b/) },
  ];
}
