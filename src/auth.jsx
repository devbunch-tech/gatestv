import { createContext, useContext, useState } from 'react';
import { ACCOUNTS } from './config/accounts';
import { hashPassword } from './lib/sha256';
import { DEFAULT_LOGIN_EMAIL } from './config/defaults';

// Login local (sem servidor): adequado para testes. Em produção, a verificação deve ir para um backend.
const SESSION = 'gates:session';
const SESSION_DAYS = 30;
// Também usado pela edição de assinantes (LicenseGate), que fornece a conta a partir da licença.
export const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

function readSession() {
  // Conta sem login (edição admin): sempre aberta, sem e-mail nem senha.
  const open = ACCOUNTS.find((a) => a.noLogin);
  if (open) return { accountId: open.id, at: Date.now(), exp: 0 };

  for (const store of [localStorage, sessionStorage]) {
    try {
      const s = JSON.parse(store.getItem(SESSION) || 'null');
      if (s && (!s.exp || s.exp > Date.now()) && ACCOUNTS.some((a) => a.id === s.accountId)) return s;
    } catch {
      /* sessão inválida */
    }
  }
  // App instalado: abre já logado na conta padrão (até o usuário sair da conta).
  try {
    const acc = ACCOUNTS.find((a) => (a.email || '').toLowerCase() === (DEFAULT_LOGIN_EMAIL || '').toLowerCase());
    if (acc && !localStorage.getItem('gates:loggedOut')) {
      const s = { accountId: acc.id, at: Date.now(), exp: Date.now() + SESSION_DAYS * 864e5 };
      localStorage.setItem(SESSION, JSON.stringify(s));
      return s;
    }
  } catch {
    /* armazenamento indisponível */
  }
  return null;
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(readSession);
  const account = ACCOUNTS.find((a) => a.id === session?.accountId) || null;

  const login = (email, password, remember) => {
    const acc = ACCOUNTS.find((a) => a.email && a.email.toLowerCase() === email.trim().toLowerCase());
    if (!acc || hashPassword(password, acc.salt) !== acc.hash) return false;
    const s = { accountId: acc.id, at: Date.now(), exp: remember ? Date.now() + SESSION_DAYS * 864e5 : 0 };
    try {
      localStorage.removeItem('gates:loggedOut');
      (remember ? localStorage : sessionStorage).setItem(SESSION, JSON.stringify(s));
    } catch {
      /* armazenamento indisponível */
    }
    setSession(s);
    return true;
  };

  const logout = () => {
    if (account?.noLogin) return; // não há conta para sair
    try {
      localStorage.setItem('gates:loggedOut', '1');
    } catch {
      /* ignore */
    }
    for (const store of [localStorage, sessionStorage]) {
      try {
        store.removeItem(SESSION);
        store.removeItem('gates:activeProfile');
      } catch {
        /* ignore */
      }
    }
    setSession(null);
  };

  return <AuthContext.Provider value={{ account, login, logout }}>{children}</AuthContext.Provider>;
}
