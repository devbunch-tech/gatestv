import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { Chips, RatingBadge } from '../components/Media';
import Icon from '../components/Icon';
import { AGES, ageText } from '../lib/parental';
import { configureMeta, testMetaKeys } from '../lib/meta';
import { NO_LOCAL_PROXY, resetProxyHosts } from '../lib/net';
import { pickWorking, zapGroups } from '../lib/zapping';
import { ZAP_RULES } from '../config/zapping';
import { STATES } from '../config/regions';

function Toggle({ checked, onChange, title, children }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch" />
      <div>
        <strong>{title}</strong>
        {children && <small>{children}</small>}
      </div>
    </label>
  );
}

export function EpgSection() {
  const { epg, epgSources, refreshEpg, settings, updateSettings } = useStore();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const add = (e) => {
    e.preventDefault();
    if (!url) return;
    updateSettings({ epgUrls: [...new Set([...settings.epgUrls, url])] });
    setUrl('');
  };
  return (
    <section className="panel" id="epg">
      <h2>
        <Icon name="guide" size={18} /> Guia de programação (EPG)
      </h2>
      <p className="muted">
        Arquivos XMLTV (.xml ou .xml.gz). As URLs declaradas no cabeçalho das listas (<code>url-tvg</code>) são usadas
        automaticamente; os canais são ligados pelo <code>tvg-id</code> ou pelo nome.
      </p>
      <div className="playlists">
        {epgSources.map((s) => {
          const e = epg[s.key] || {};
          return (
            <div key={s.key} className="playlist">
              <Icon name="guide" />
              <div className="playlist-info">
                <strong>{s.label}</strong>
                <small className="mono-sm">{s.url}</small>
                <small className={e.error ? 'err-text' : ''}>
                  {e.loading
                    ? 'Carregando…'
                    : e.error
                      ? e.error
                      : e.updatedAt
                        ? `${Object.keys(e.programmes || {}).length} canais · ${e.count ?? 0} programas · ${new Date(e.updatedAt).toLocaleString('pt-BR')}`
                        : 'Aguardando'}
                </small>
              </div>
              {s.manual && (
                <button
                  className="icon-btn danger"
                  title="Remover"
                  onClick={() => updateSettings({ epgUrls: settings.epgUrls.filter((u) => u !== s.url) })}
                >
                  <Icon name="trash" />
                </button>
              )}
            </div>
          );
        })}
        {!epgSources.length && <p className="muted">Nenhuma fonte de EPG.</p>}
      </div>
      <form className="field-row inline-form" onSubmit={add}>
        <label className="field">
          <span>Adicionar URL de EPG</span>
          <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://exemplo.com/epg.xml.gz" />
        </label>
        <button className="btn" type="submit">
          <Icon name="plus" size={18} /> Adicionar
        </button>
        <button
          className="btn ghost"
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await refreshEpg();
            setBusy(false);
          }}
        >
          {busy ? <span className="spinner sm" /> : <Icon name="refresh" size={18} />} Atualizar guia
        </button>
      </form>
    </section>
  );
}

export function MetaSection() {
  const { settings, updateSettings } = useStore();
  const [tmdb, setTmdb] = useState(settings.tmdbKey);
  const [omdb, setOmdb] = useState(settings.omdbKey);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    updateSettings({ tmdbKey: tmdb.trim(), omdbKey: omdb.trim() });
    setBusy(true);
    setResult(null);
    configureMeta({ tmdbKey: tmdb.trim(), omdbKey: omdb.trim() });
    setResult(await testMetaKeys());
    setBusy(false);
  };

  return (
    <form className="panel" id="meta" onSubmit={save}>
      <h2>
        <Icon name="star" size={18} /> Metadados (TMDB e IMDb)
      </h2>
      <p className="muted">
        Sinopses, elenco, trailers, classificação indicativa e filmografia de atores vêm do{' '}
        <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noreferrer">TMDB</a> (chave gratuita), que também
        traz o ID do IMDb de cada título. A nota do IMDb é opcional, via{' '}
        <a href="https://www.omdbapi.com/apikey.aspx" target="_blank" rel="noreferrer">OMDb</a>.
      </p>
      <label className="field">
        <span>Chave da API do TMDB (v3) ou token de leitura (v4)</span>
        <input type="password" value={tmdb} onChange={(e) => setTmdb(e.target.value)} autoComplete="off" placeholder="Cole aqui sua chave do TMDB" />
      </label>
      <label className="field">
        <span>Chave do OMDb (opcional — nota do IMDb)</span>
        <input type="password" value={omdb} onChange={(e) => setOmdb(e.target.value)} autoComplete="off" placeholder="Opcional" />
      </label>
      <button className="btn" disabled={busy}>
        {busy ? <span className="spinner sm" /> : <Icon name="refresh" size={18} />} Salvar e testar
      </button>
      {result && (
        <p className={`msg ${result.tmdb === 'ok' && (!result.omdb || result.omdb === 'ok') ? 'ok' : 'err'}`}>
          TMDB: {result.tmdb === 'ok' ? 'conectado' : result.tmdb}
          {result.omdb && ` · OMDb: ${result.omdb === 'ok' ? 'conectado' : result.omdb}`}
        </p>
      )}
    </form>
  );
}

export function ParentalSection() {
  const { parental, updateParental, unlocked, unlock, ensurePin, lockNow, catalog, requestPinChange } = useStore();
  const groups = useMemo(() => [...new Set(catalog.raw.map((i) => i.group))].sort((a, b) => a.localeCompare(b, 'pt-BR')), [catalog.raw]);
  const editable = !parental.pin || unlocked;

  return (
    <section className="panel" id="parental">
      <h2>
        <Icon name="shield" size={18} /> Controle parental
      </h2>
      {!editable ? (
        <div className="locked-panel">
          <p className="muted">As configurações estão protegidas por PIN.</p>
          <button className="btn" onClick={() => unlock('Digite o PIN para alterar o controle parental')}>
            <Icon name="unlock" size={18} /> Desbloquear para editar
          </button>
        </div>
      ) : (
        <>
          <Toggle
            checked={parental.enabled}
            onChange={async (v) => (await ensurePin()) && updateParental({ enabled: v })}
            title="Ativar controle parental"
          >
            Exige o PIN para canais, filmes e séries acima da classificação escolhida. Itens bloqueados individualmente sempre pedem
            o PIN.
          </Toggle>

          <div className="field">
            <span>Classificação máxima (padrão para perfis sem limite próprio)</span>
            <div className="chips">
              {AGES.map((a) => (
                <button key={a} className={`chip rating-chip ${parental.maxAge === a ? 'active' : ''}`} onClick={() => updateParental({ maxAge: a })} title={ageText(a)}>
                  <RatingBadge age={a} /> {a === 18 ? 'Tudo' : `até ${ageText(a)}`}
                </button>
              ))}
            </div>
            <small className="muted">
              A classificação vem do EPG (programa atual), do TMDB (classificação brasileira) ou é definida por você no menu do item.
            </small>
          </div>

          <Toggle checked={parental.hideRestricted} onChange={(v) => updateParental({ hideRestricted: v })} title="Ocultar conteúdo restrito">
            Em vez de pedir o PIN, esconde das listas o que estiver acima da classificação ou bloqueado.
          </Toggle>
          <Toggle checked={parental.blockAdultGroups} onChange={(v) => updateParental({ blockAdultGroups: v })} title="Tratar categorias adultas como 18 anos">
            Categorias com “Adulto”, “XXX”, “+18” etc. recebem classificação 18 automaticamente.
          </Toggle>

          {/* "Bloquear categorias inteiras" fica escondido (a classificação e o bloqueio por item continuam). */}
          {false && <div className="field">
            <span>Bloquear categorias inteiras</span>
            <div className="chips">
              {groups.map((g) => {
                const on = parental.lockedGroups.includes(g);
                return (
                  <button
                    key={g}
                    className={`chip ${on ? 'active' : ''}`}
                    onClick={async () =>
                      (await ensurePin()) &&
                      updateParental({ lockedGroups: on ? parental.lockedGroups.filter((x) => x !== g) : [...parental.lockedGroups, g] })
                    }
                  >
                    {on && <Icon name="lock" size={12} />} {g}
                  </button>
                );
              })}
            </div>
          </div>}

          <div className="field-row">
            <button className="btn ghost" onClick={requestPinChange}>
              <Icon name="shield" size={18} /> {parental.pin ? 'Alterar PIN' : 'Criar PIN'}
            </button>
            {parental.pin && (
              <button className="btn ghost" onClick={lockNow}>
                <Icon name="lock" size={18} /> Bloquear agora
              </button>
            )}
          </div>
          {unlocked && <p className="muted small">Desbloqueado por 10 minutos.</p>}
        </>
      )}
    </section>
  );
}

export function ManagedContent() {
  const { overrides, catalog, setOverride, unlock, hiddenList, deletedList, masterHidden, masterDeleted, isMaster, masterProfile, toggleHidden, restoreItem, profile } =
    useStore();
  const mH = isMaster ? [] : masterHidden;
  const mD = isMaster ? [] : masterDeleted;
  const ids = new Set([...Object.keys(overrides), ...hiddenList, ...deletedList, ...mH, ...mD]);
  const rows = [...ids]
    .map((id) => ({
      id,
      o: {
        ...overrides[id],
        hidden: hiddenList.includes(id),
        deleted: deletedList.includes(id),
        masterHidden: mH.includes(id),
        masterDeleted: mD.includes(id),
      },
      item: catalog.byId.get(id),
    }))
    .filter((r) => r.item && (r.o.hidden || r.o.deleted || r.o.masterHidden || r.o.masterDeleted || r.o.locked || r.o.rating != null));

  return (
    <section className="panel" id="managed">
      <h2>
        <Icon name="eye-off" size={18} /> Conteúdo oculto, bloqueado e excluído
      </h2>
      {!rows.length && (
        <p className="muted">
          Nada aqui ainda. Segure OK (ou clique com o botão direito / ⋮) em um canal, filme ou série para ocultar, bloquear ou
          excluir.
        </p>
      )}
      <div className="playlists">
        {rows.map(({ id, o, item }) => (
          <div key={id} className="playlist">
            <Icon name={item.type === 'live' ? 'tv' : item.type === 'movie' ? 'film' : 'series'} />
            <div className="playlist-info">
              <strong>{item.name}</strong>
              <small>
                {[o.deleted && (isMaster ? 'Excluído (todos os perfis)' : `Excluído no perfil ${profile?.name}`), o.hidden && (isMaster ? 'Oculto (todos os perfis)' : `Oculto no perfil ${profile?.name}`), (o.masterHidden || o.masterDeleted) && `${o.masterDeleted ? 'Excluído' : 'Oculto'} pelo perfil master (${masterProfile?.name})`, o.locked && 'Bloqueado com PIN', o.rating != null && `Classificação manual: ${ageText(o.rating)}`]
                  .filter(Boolean)
                  .join(' · ')}{' '}
                · {item.group}
              </small>
            </div>
            {o.deleted && (
              <button className="btn ghost small" onClick={() => restoreItem(id)}>
                Restaurar
              </button>
            )}
            {o.hidden && (
              <button className="btn ghost small" onClick={() => toggleHidden(id)}>
                Mostrar
              </button>
            )}
            {(o.locked || o.rating != null) && (
              <button className="btn ghost small" onClick={async () => (await unlock()) && setOverride(id, { locked: null, rating: null })}>
                Desbloquear
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

// Diagnóstico: quantos canais entraram em cada seção e quais categorias da fonte foram usadas.
function ZapSummary() {
  const { catalog, liveHealth, settings } = useStore();
  const [open, setOpen] = useState(false);
  const data = useMemo(() => {
    const groups = zapGroups(catalog.live, settings.uf);
    const bySection = new Map();
    const usedIds = new Set();
    for (const g of groups) {
      const ch = pickWorking(g.candidates, liveHealth);
      if (!ch) continue;
      bySection.set(g.section, (bySection.get(g.section) || 0) + 1);
      for (const c of g.candidates) usedIds.add(c.id);
    }
    const cats = new Map();
    for (const c of catalog.live) {
      const e = cats.get(c.group) || { total: 0, used: 0 };
      e.total++;
      if (usedIds.has(c.id)) e.used++;
      cats.set(c.group, e);
    }
    return {
      sections: [...new Set(ZAP_RULES.map((r) => r.section))].map((s) => [s, bySection.get(s) || 0]),
      cats: [...cats.entries()].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR')),
    };
  }, [catalog.live, liveHealth, settings.uf]);
  return (
    <div className="zap-summary">
      <div className="chips">
        {data.sections.map(([s, n]) => (
          <span key={s} className={`chip static ${n ? '' : 'empty'}`}>
            {s}: {n}
          </span>
        ))}
      </div>
      <button className="link-btn" onClick={() => setOpen((o) => !o)}>
        {open ? 'Ocultar' : 'Ver'} categorias ao vivo da fonte ({data.cats.length})
      </button>
      {open && (
        <ul className="zap-cats">
          {data.cats.map(([g, e]) => (
            <li key={g} className={e.used ? '' : 'muted'}>
              <span>{g}</span>
              <em>
                {e.used ? `${e.used} de ${e.total} na troca rápida (versões incluídas)` : `${e.total} canais · fora da troca rápida`}
              </em>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LiveHealthStatus() {
  const { healthRun, validateLive } = useStore();
  const { running, done, total, replaced, offline, at } = healthRun;
  return (
    <>
    <ZapSummary />
    <div className="health-status">
      <Icon name="shield" size={18} />
      <div>
        <strong>Validação dos canais ao vivo</strong>
        <small className="muted">
          {running
            ? `Verificando… ${done} de ${total} canais (pausa enquanto você assiste).`
            : at
              ? `${total} canais verificados ao abrir o app · ${replaced} trocado(s) por outra versão · ${offline} fora do ar (ocultos da troca rápida).`
              : 'Os canais são verificados automaticamente ao abrir o app.'}
        </small>
      </div>
      <button className="btn ghost small" disabled={running} onClick={validateLive}>
        {running ? <span className="spinner sm" /> : <Icon name="refresh" size={16} />} Verificar agora
      </button>
    </div>
    </>
  );
}

export function PlaybackSection() {
  const { settings, updateSettings, clearHistory } = useStore();
  return (
    <section className="panel">
      <h2>Reprodução e dispositivo</h2>
      {/* TVs Samsung/LG não têm proxy local */}
      {!NO_LOCAL_PROXY && <div className="field">
        <span>Proxy local</span>
        <Chips
          options={['Automático', 'Sempre', 'Nunca']}
          value={{ auto: 'Automático', always: 'Sempre', never: 'Nunca' }[settings.proxyMode]}
          onChange={(v) => updateSettings({ proxyMode: { Automático: 'auto', Sempre: 'always', Nunca: 'never' }[v] })}
        />
        <small className="muted">
          Automático (recomendado): o vídeo vai direto do servidor para a TV, com menos atraso; o proxy só entra para servidores que
          bloqueiam o acesso direto, e eles ficam memorizados.{' '}
          <button className="link-btn" onClick={() => (resetProxyHosts(), alert('Lista de servidores via proxy limpa.'))}>
            Limpar servidores memorizados
          </button>
        </small>
      </div>}
      <div className="field">
        <span>Atraso do ao vivo (proteção contra travamentos)</span>
        <Chips
          options={['Mínimo', '10 s', '20 s', '35 s']}
          value={{ 0: 'Mínimo', 10: '10 s', 20: '20 s', 35: '35 s' }[settings.liveDelay] || '35 s'}
          onChange={(v) => updateSettings({ liveDelay: { Mínimo: 0, '10 s': 10, '20 s': 20, '35 s': 35 }[v], delay35: true })}
        />
        <small className="muted">
          O ao vivo é exibido com esse atraso, mantendo os segundos seguintes já carregados: se a internet oscilar, o vídeo
          continua sem travar. “Mínimo” fica o mais perto possível do ao vivo, mas pode travar mais.
        </small>
      </div>
      <div className="field">
        <span>Seu estado</span>
        <select value={STATES.some((s) => s.uf === settings.uf) ? settings.uf : ''} onChange={(e) => updateSettings({ uf: e.target.value || '-' })} aria-label="Seu estado">
          <option value="">Não informado</option>
          {STATES.map((s) => (
            <option key={s.uf} value={s.uf}>
              {s.name}
            </option>
          ))}
        </select>
        <small className="muted">A Globo e a Record do seu estado ficam em primeiro na lista de canais e abrem ao entrar em TV ao Vivo.</small>
      </div>
      <Toggle checked={settings.curatedZap} onChange={(v) => updateSettings({ curatedZap: v })} title="Troca rápida só com os canais selecionados">
        No player, a lista de canais e as teclas ▲▼ / CH+ CH− mostram só a Globo e a Record do seu estado, Globo NSC/RJ, Record
        NSC/RJ, SBT, RedeTV, CNT, TV Câmara, TV Senado, TVE, HBO, Telecine, SporTV, ESPN, Combate, Discovery, History, Warner,
        Megapix, AXN, Film&Arts, Sony, Sony Movies, MTV, Bis, AMC, Cinemax, Universal e os grupos Premiere, SporTV,
        Entretenimento, Notícias, Infantil, Variedades e Documentários — sem repetidos e na versão HD que estiver no ar.
      </Toggle>
      <Toggle checked={settings.subtitles !== false} onChange={(v) => updateSettings({ subtitles: v })} title="Legendas em filmes e séries">
        Quando o filme ou episódio traz legenda junto com o vídeo, ela aparece em amarelo, centralizada e em letra arredondada.
      </Toggle>
      {settings.curatedZap && <LiveHealthStatus />}
      <div className="field">
        <span>Modo TV (navegação por controle remoto)</span>
        <Chips
          options={['Automático', 'Ligado', 'Desligado']}
          value={{ auto: 'Automático', on: 'Ligado', off: 'Desligado' }[settings.tvMode]}
          onChange={(v) => updateSettings({ tvMode: { Automático: 'auto', Ligado: 'on', Desligado: 'off' }[v] })}
        />
        <small className="muted">No automático, é ativado em Android TV / Google TV / Fire TV. Também dá para forçar com ?tv=1 na URL.</small>
      </div>
      <button className="btn ghost" onClick={() => confirm('Limpar histórico e progresso?') && clearHistory()}>
        <Icon name="trash" size={18} /> Limpar histórico de reprodução
      </button>
    </section>
  );
}

const REMOTE = [
  ['D-pad ▲▼◀▶', 'Navegar pelos menus e cards', 'Touch/clique da Siri Remote'],
  ['OK / Select', 'Abrir · no Ao Vivo: mostra o programa atual; 2º OK abre detalhes', 'Clique central'],
  ['Segurar OK · Menu', 'Opções do item: ocultar, bloquear, classificação, excluir', 'Segurar o clique'],
  ['▲ ▼ · CH+ CH−', 'Trocar de canal no Ao Vivo', 'Deslizar para cima/baixo'],
  ['◀ (no Ao Vivo)', 'Lista de canais com o que está passando', 'Deslizar para a esquerda'],
  ['0–9', 'Ir direto para o número do canal', '—'],
  ['Info / ▶ (no Ao Vivo)', 'Descrição completa do programa e próximos', 'Deslizar para a direita'],
  ['Play/Pause · ⏩ ⏪', 'Reproduzir / pausar · avançar / voltar 30s', 'Play/Pause'],
  ['Voltar', 'Fechar painel, sair do player ou voltar a tela', 'Botão Menu / Voltar'],
];

export function RemoteHelp() {
  return (
    <section className="panel" id="remote">
      <h2>
        <Icon name="remote" size={18} /> Controle remoto
      </h2>
      <table className="remote-table">
        <thead>
          <tr>
            <th>Android TV / teclado</th>
            <th>Ação</th>
            <th>Apple TV (Siri Remote)*</th>
          </tr>
        </thead>
        <tbody>
          {REMOTE.map(([k, a, atv]) => (
            <tr key={k}>
              <td><kbd>{k}</kbd></td>
              <td>{a}</td>
              <td className="muted">{atv}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <small className="muted">
        * O tvOS não possui navegador nem WebView: na Apple TV o GATES! precisa de um app nativo, que repassa os gestos da Siri
        Remote para estes mesmos comandos.
      </small>
    </section>
  );
}
