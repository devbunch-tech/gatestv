import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth';
import Icon from './Icon';

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const submit = (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    // Pequeno atraso para o spinner aparecer antes do cálculo do hash.
    setTimeout(() => {
      if (!login(email, password, remember)) {
        setError('E-mail ou senha incorretos.');
        setPassword('');
      }
      setBusy(false);
    }, 30);
  };

  return (
    <div className="login" data-nav-root>
      <form className="login-card" onSubmit={submit}>
        <img src="./logo.png" alt="GATES! TV" className="login-logo" />
        <h1>Entrar</h1>
        <label className="field">
          <span>E-mail</span>
          <input ref={ref} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="field">
          <span>Senha</span>
          <div className="pw">
            <input
              type={show ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button type="button" className="icon-btn" onClick={() => setShow((s) => !s)} aria-label={show ? 'Ocultar senha' : 'Mostrar senha'}>
              <Icon name={show ? 'eye-off' : 'eye'} size={18} />
            </button>
          </div>
        </label>
        <label className="remember">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Manter conectado neste aparelho
        </label>
        {error && <p className="msg err">{error}</p>}
        <button className="btn login-btn" disabled={busy}>
          {busy ? <span className="spinner sm" /> : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
