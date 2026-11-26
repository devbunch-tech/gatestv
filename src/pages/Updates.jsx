// "Procurar atualizações na plataforma": versão instalada, novidades, verificar agora e atualizar.
import { useCallback, useEffect, useRef, useState } from 'react';
import { PageHeader } from '../components/Media';
import Icon from '../components/Icon';
import { APP_VERSION, applyNow, checkNow, getInfo, openAccount, platform } from '../lib/updates';
import NOVIDADES from '../config/novidades.json';

const fmtDate = (d) => (d ? new Date(d + 'T12:00:00').toLocaleDateString('pt-BR') : '');
const fmtTime = (t) => (t ? new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '');
const BUSY = ['checking', 'downloading'];

export default function Updates() {
  const [info, setInfo] = useState(null);
  const [asked, setAsked] = useState(false); // a pessoa tocou em "Procurar agora" nesta visita
  const timer = useRef(0);

  const refresh = useCallback(async () => {
    const i = await getInfo();
    setInfo(i);
    clearTimeout(timer.current);
    // Enquanto procura ou baixa, acompanha o andamento.
    if (BUSY.includes(i?.state)) timer.current = setTimeout(refresh, 1500);
  }, []);

  const search = useCallback(async () => {
    setAsked(true);
    setInfo((i) => ({ ...i, state: 'checking' }));
    await checkNow();
    setTimeout(refresh, 400);
  }, [refresh]);

  useEffect(() => {
    refresh();
    return () => clearTimeout(timer.current);
  }, [refresh]);
  // Ao abrir a tela já procura (o app também procura sozinho ao abrir).
  useEffect(() => {
    if (info?.enabled && !asked && !BUSY.includes(info.state) && Date.now() - (info.checkedAt || 0) > 60e3) search();
  }, [info, asked, search]);

  const version = info?.current?.version || APP_VERSION;
  const st = info?.state || 'idle';
  const av = info?.available || info?.pending;
  const notes = (st === 'ready' && (info?.pending?.notes || info?.available?.notes)) || (st === 'native' && info?.available?.notes) || [];
  const p = platform();

  let status;
  if (!info) status = <p className="muted">Carregando…</p>;
  else if (!info.enabled)
    status = (
      <p className="muted">
        {p === 'smarttv'
          ? 'Nesta TV, as atualizações chegam pela loja de aplicativos da TV.'
          : 'Este aparelho ainda não tem a atualização pela plataforma. Instale a versão mais nova do app pela sua conta para receber as próximas atualizações aqui.'}
      </p>
    );
  else if (st === 'checking') status = <p className="upd-state">Procurando atualizações…</p>;
  else if (st === 'downloading') status = <p className="upd-state">Baixando a versão {av?.version}… você pode continuar usando o app.</p>;
  else if (st === 'ready')
    status = (
      <p className="upd-state ok">
        <Icon name="star" size={18} /> Versão {av?.version} pronta para usar.
      </p>
    );
  else if (st === 'native') status = <p className="upd-state warn">A versão {av?.version} precisa do app novo. Baixe pela sua conta e instale por cima (seus dados continuam).</p>;
  else if (st === 'uptodate') status = <p className="upd-state ok">Você já está na versão mais recente.</p>;
  else if (st === 'error') status = <p className="msg err">Não foi possível procurar agora. Confira a internet e tente de novo.</p>;
  else status = <p className="muted">Toque em “Procurar agora” para ver se há uma versão nova.</p>;

  return (
    <div className="settings updates-page">
      <PageHeader title="Procurar atualizações" />
      <section className="panel">
        <h2>
          <Icon name="refresh" size={18} /> Versão instalada: {version || '—'}
        </h2>
        {status}
        {notes.length > 0 && (
          <>
            <h3 className="upd-sub">O que há de novo</h3>
            <ul className="upd-notes">
              {notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </>
        )}
        <div className="computer-actions">
          {st === 'ready' && (
            <button className="btn" onClick={applyNow} autoFocus>
              {p === 'desktop' ? 'Atualizar e reabrir' : 'Atualizar agora'}
            </button>
          )}
          {st === 'native' && (
            <button className="btn" onClick={openAccount} autoFocus>
              Baixar o app novo
            </button>
          )}
          {info?.enabled && (
            <button className="btn ghost" disabled={BUSY.includes(st)} onClick={search}>
              Procurar agora
            </button>
          )}
          {!info?.enabled && p !== 'smarttv' && (
            <button className="btn ghost" onClick={openAccount}>
              Abrir minha conta
            </button>
          )}
        </div>
        {info?.checkedAt > 0 && <small className="muted">Última verificação às {fmtTime(info.checkedAt)}.</small>}
      </section>

      <section className="panel">
        <h2>
          <Icon name="list" size={18} /> Novidades das versões
        </h2>
        {NOVIDADES.map((n) => (
          <div key={n.versao} className="upd-version">
            <h3 className="upd-sub">
              Versão {n.versao} <small className="muted">· {fmtDate(n.data)}</small>
              {n.versao === version && <span className="chip-tag">instalada</span>}
            </h3>
            <ul className="upd-notes">
              {n.itens.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          </div>
        ))}
      </section>
    </div>
  );
}
