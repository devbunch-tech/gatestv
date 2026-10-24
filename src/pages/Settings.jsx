import { useState } from 'react';
import { useStore } from '../store';
import { PageHeader } from '../components/Media';
import Icon from '../components/Icon';
import { xtreamToM3U } from '../lib/net';
import { clearHomeCache } from './Home';
import { LITE, LITE_DEFAULT, SMART_TV, WEB, isSubscriber, setLite } from '../lib/device';
import { useLicense } from '../components/LicenseGate';
import { EpgSection, ManagedContent, MetaSection, ParentalSection, PlaybackSection, RemoteHelp } from './SettingsSections';

const TABS = [
  { id: 'url', label: 'URL M3U', icon: 'link' },
  { id: 'file', label: 'Arquivo', icon: 'upload' },
  { id: 'xtream', label: 'Xtream Codes', icon: 'server' },
].filter((t) => !(SMART_TV && t.id === 'file')); // TVs Samsung/LG não têm seletor de arquivos

function AddPlaylist() {
  const { importPlaylist } = useStore();
  const [tab, setTab] = useState('url');
  const [form, setForm] = useState({ name: '', url: '', server: '', username: '', password: '', output: SMART_TV ? 'm3u8' : 'ts' }); // TVs: HLS toca no player nativo
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const f = (k) => ({ value: form[k], onChange: (e) => setForm({ ...form, [k]: e.target.value }) });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      let meta;
      if (tab === 'url') {
        meta = await importPlaylist({ name: form.name || new URL(form.url).hostname, url: form.url, source: 'url' });
      } else if (tab === 'file') {
        if (!file) throw new Error('Selecione um arquivo .m3u ou .m3u8.');
        meta = await importPlaylist({ name: form.name || file.name, text: await file.text(), source: 'file' });
      } else {
        const server = new URL(form.server.trim()).origin;
        const xtream = { server, username: form.username.trim(), password: form.password, output: form.output };
        meta = await importPlaylist({ name: form.name || xtream.username + '@' + new URL(server).hostname, url: xtreamToM3U(xtream), source: 'xtream', xtream });
      }
      setMsg({
        ok: true,
        text: `“${meta.name}” importada: ${meta.counts.live.toLocaleString('pt-BR')} canais, ${meta.counts.movie.toLocaleString('pt-BR')} filmes e ${meta.counts.series.toLocaleString('pt-BR')} séries${meta.source === 'xtream' ? ' · guia de programação (EPG) configurado automaticamente' : ''}.`,
      });
      setForm({ ...form, name: '', url: '' });
      setFile(null);
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="panel" onSubmit={submit}>
      <h2>Adicionar lista</h2>
      {WEB && (
        <p className="muted small" style={{ margin: '0 0 12px' }}>
          Versão para navegador: funciona com listas e servidores <b>https://</b> que permitem acesso pelo navegador. Se a sua lista for http:// ou não abrir aqui, use o app do GATES! TV (Android, TV ou Windows).
        </p>
      )}
      <div className="tabs">
        {TABS.map((t) => (
          <button type="button" key={t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
            <Icon name={t.icon} size={16} /> {t.label}
          </button>
        ))}
      </div>

      <label className="field">
        <span>Nome (opcional)</span>
        <input {...f('name')} placeholder="Minha lista" />
      </label>

      {tab === 'url' && (
        <label className="field">
          <span>URL da lista M3U</span>
          <input {...f('url')} type="url" required placeholder="https://exemplo.com/lista.m3u" />
        </label>
      )}
      {tab === 'file' && (
        <label className="field">
          <span>Arquivo M3U</span>
          <input type="file" accept=".m3u,.m3u8,audio/x-mpegurl,application/vnd.apple.mpegurl,text/plain" onChange={(e) => setFile(e.target.files[0])} />
        </label>
      )}
      {tab === 'xtream' && (
        <>
          <label className="field">
            <span>Servidor</span>
            <input {...f('server')} type="url" required placeholder="http://servidor.com:8080" />
          </label>
          <div className="field-row">
            <label className="field">
              <span>Usuário</span>
              <input {...f('username')} required autoComplete="off" />
            </label>
            <label className="field">
              <span>Senha</span>
              <input {...f('password')} type="password" required autoComplete="new-password" />
            </label>
            <label className="field">
              <span>Formato</span>
              <select {...f('output')}>
                <option value="ts">MPEG-TS</option>
                <option value="m3u8">HLS</option>
              </select>
            </label>
          </div>
        </>
      )}

      <button className="btn" disabled={busy}>
        {busy ? <span className="spinner sm" /> : <Icon name="plus" size={18} />} Importar
      </button>
      {msg && <p className={`msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</p>}
    </form>
  );
}

export default function Settings() {
  const { playlists, refreshPlaylist, removePlaylist, profile, unlocked, unlock, checkForUpdates, syncing, notify } = useStore();
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);

  const refresh = async (p) => {
    setBusy(p.id);
    setErr(null);
    try {
      await refreshPlaylist(p);
    } catch (e) {
      setErr(`${p.name}: ${e.message}`);
    } finally {
      setBusy(null);
    }
  };

  if (profile?.kids && !unlocked)
    return (
      <div className="settings">
        <div className="empty">
          <Icon name="shield" size={48} />
          <h3>Configurações bloqueadas</h3>
          <p>Este é um perfil infantil. Peça para um adulto digitar o PIN de controle parental.</p>
          <button className="btn" onClick={() => unlock('Digite o PIN de controle parental')}>
            <Icon name="unlock" size={18} /> Desbloquear
          </button>
        </div>
      </div>
    );

  return (
    <div className="settings">
      <PageHeader title="Configurações" />
      <nav className="settings-nav">
        {[
          ...(isSubscriber ? [['#subscription', 'Assinatura']] : []),
          ...(window.GatesDesktop ? [['#computer', 'Desligar']] : []),
          ['#sources', 'Fontes'],
          ['#epg', 'Guia (EPG)'],
          ['#meta', 'TMDB / IMDb'],
          ['#parental', 'Controle parental'],
          ['#managed', 'Ocultos e bloqueados'],
          ['#remote', 'Controle remoto'],
        ].map(([h, l]) => (
          <button key={h} className="chip" onClick={() => document.querySelector(h)?.scrollIntoView({ behavior: 'smooth' })}>
            {l}
          </button>
        ))}
      </nav>

      {isSubscriber && <SubscriptionSection />}
      {window.GatesDesktop && <ComputerSection />}

      <section className="panel" id="sources">
        <h2>Fontes de conteúdo</h2>
        {!playlists.length && <p className="muted">Nenhuma lista adicionada.</p>}
        <div className="playlists">
          {playlists.map((p) => (
            <div key={p.id} id={p.id} className="playlist">
              <Icon name={p.source === 'xtream' ? 'server' : 'list'} />
              <div className="playlist-info">
                <strong>{p.name}</strong>
                <small>
                  {p.source === 'xtream' && 'Xtream Codes · '}
                  {p.counts?.live ?? 0} canais · {p.counts?.movie ?? 0} filmes · {p.counts?.series ?? 0} {p.source === 'xtream' ? 'séries' : 'episódios'} ·
                  atualizada em {new Date(p.updatedAt).toLocaleString('pt-BR')}
                  {p.accountInfo?.exp && ` · conta válida até ${new Date(+p.accountInfo.exp * 1000).toLocaleDateString('pt-BR')}`}
                </small>
              </div>
              {p.url && (
                <button className="icon-btn" onClick={() => refresh(p)} disabled={busy === p.id} title="Atualizar">
                  {busy === p.id ? <span className="spinner sm" /> : <Icon name="refresh" />}
                </button>
              )}
              <button
                className="icon-btn danger"
                onClick={() => confirm(`Remover a lista “${p.name}”?`) && removePlaylist(p.id)}
                title="Remover"
              >
                <Icon name="trash" />
              </button>
            </div>
          ))}
        </div>
        {err && <p className="msg err">{err}</p>}
        {playlists.some((p) => p.source === 'xtream') && (
          <button className="btn ghost" style={{ marginTop: 12 }} disabled={syncing} onClick={checkForUpdates}>
            {syncing ? <span className="spinner sm" /> : <Icon name="refresh" size={18} />} Procurar novidades agora
          </button>
        )}
        <button
          className="btn ghost"
          style={{ marginTop: 12, marginLeft: 8 }}
          onClick={() => {
            clearHomeCache();
            notify('As seções da tela inicial serão recalculadas ao abrir o Início.', 'ok');
          }}
        >
          <Icon name="home" size={18} /> Atualizar tela inicial
        </button>
        <p className="muted small" style={{ marginTop: 6 }}>
          Filmes e séries da tela inicial (recentes, HBO, Netflix, Apple TV e Telecine) ficam guardados por 3 dias para abrir
          mais rápido.
        </p>
        <p className="muted small" style={{ marginTop: 10 }}>
          Fontes Xtream são verificadas automaticamente ao abrir o app; itens ocultos ou excluídos continuam ocultos.
        </p>
      </section>

      <AddPlaylist />
      <EpgSection />
      <MetaSection />
      <ParentalSection />
      <ManagedContent />
      <PlaybackSection />
      <LiteSection />
      <RemoteHelp />
    </div>
  );
}

// App do Windows: desligar o computador direto pelo GATES! TV.
function ComputerSection() {
  const [state, setState] = useState(null); // null | 'off' | 'error'
  const shutdown = async () => {
    if (!confirm('Desligar o computador agora?\n\nO GATES! TV será fechado e o Windows desligará em seguida.')) return;
    try {
      setState((await window.GatesDesktop.shutdown()) ? 'off' : 'error');
    } catch {
      setState('error');
    }
  };
  return (
    <section className="panel" id="computer">
      <h2>
        <Icon name="tv" size={18} /> Computador
      </h2>
      <p className="muted">Terminou de assistir? Desligue o computador sem sair do GATES! TV.</p>
      <div className="computer-actions">
        <button className="btn danger-btn" onClick={shutdown} disabled={state === 'off'}>
          <Icon name="close" size={18} /> {state === 'off' ? 'Desligando…' : 'Desligar o computador'}
        </button>
        <button className="btn ghost" onClick={() => window.GatesDesktop.quit()}>
          <Icon name="back" size={18} /> Fechar o GATES! TV
        </button>
      </div>
      {state === 'error' && <p className="msg err">Não foi possível desligar o computador. Tente pelo menu Iniciar do Windows.</p>}
      <p className="muted small" style={{ marginTop: 10 }}>
        Dica: o app sempre abre em tela cheia; aperte F11 para alternar para janela.
      </p>
    </section>
  );
}

// Assinantes: situação da assinatura neste aparelho.
function SubscriptionSection() {
  const { state, payload, checking, error, refreshNow, logout, storeUrl } = useLicense();
  const fmt = (t) => (t ? new Date(t).toLocaleDateString('pt-BR') : '—');
  const label = { active: 'Em dia', grace: 'Pagamento pendente', suspended: 'Suspensa', offline: 'Sem conexão' }[state.status] || state.status;
  return (
    <section className="panel" id="subscription">
      <h2>
        <Icon name="star" size={18} /> Assinatura
      </h2>
      <div className={`sub-status sub-${state.status}`}>
        <strong>{label}</strong>
        <span>{payload?.email}</span>
      </div>
      <p className="muted">
        {state.status === 'grace'
          ? `Não identificamos o pagamento. O acesso será suspenso em ${fmt(state.suspendAt)}.`
          : state.reason === 'manual'
            ? `Acesso liberado até ${fmt(state.paidUntil)}.`
            : `Pago até ${fmt(state.paidUntil)}. A renovação é verificada automaticamente.`}
      </p>
      {error && <p className="msg err">{error}</p>}
      <div className="computer-actions">
        <button className="btn ghost" disabled={checking} onClick={() => refreshNow()}>
          {checking ? <span className="spinner sm" /> : <Icon name="refresh" size={18} />} Verificar agora
        </button>
        {storeUrl && (
          <button className="btn ghost" onClick={() => window.GatesAndroid?.openUrl ? window.GatesAndroid.openUrl(storeUrl) : window.open(storeUrl, '_blank', 'noopener')}>
            <Icon name="link" size={18} /> Gerenciar assinatura
          </button>
        )}
        <button className="btn ghost" onClick={() => confirm('Sair da assinatura neste aparelho? Será preciso ativar de novo.') && logout()}>
          <Icon name="back" size={18} /> Sair deste aparelho
        </button>
      </div>
    </section>
  );
}

// Modo LITE: para aparelhos mais simples (menos conteúdo carregado ao mesmo tempo).
function LiteSection() {
  return (
    <section className="panel" id="lite">
      <h2>
        <Icon name="tv" size={18} /> Desempenho
      </h2>
      <label className="toggle">
        <input type="checkbox" checked={LITE} onChange={(e) => setLite(e.target.checked)} />
        <span className="switch" />
        <span>
          Modo LITE {LITE_DEFAULT && <em className="muted">(padrão desta versão)</em>}
          <small>
            Mostra menos filmes, séries e canais por tela, sem efeitos visuais e com imagens menores. Deixa o app mais rápido em TV boxes e
            celulares mais simples. O app reinicia ao mudar.
          </small>
        </span>
      </label>
    </section>
  );
}
