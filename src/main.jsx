import './lib/polyfills';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { StoreProvider } from './store';
import { AuthProvider, useAuth } from './auth';
import Login from './components/Login';
import './styles.css';
import './styles-tv.css';
import './styles-profiles.css';
import './styles-v3.css';
import './styles-touch.css';
import './styles-lite.css';
import { DEVICE, EDITION, LITE, SMART_TV, isSubscriber, isTouch } from './lib/device';
import { initSmartTv } from './lib/smarttv';
import { LicenseProvider } from './components/LicenseGate';

const viewport = document.querySelector('meta[name=viewport]');
if (SMART_TV) {
  // TVs Samsung/LG: mesma escala do Android TV (página de 1280 de largura ampliada para a tela).
  viewport?.setAttribute('content', 'width=1280, initial-scale=' + (window.screen.width / 1280).toFixed(3));
  // (Se a TV ignorar o viewport, o app fica no tamanho nativo de 1920, que também funciona.)
  initSmartTv();
} else if (DEVICE === 'tv' && window.GatesAndroid) {
  // App de Android TV: a página é desenhada numa largura maior (1280) e reduzida para caber na tela,
  // deixando textos e cards ~25% menores (mais conteúdo visível por tela).
  viewport?.setAttribute('content', 'width=1280, initial-scale=' + (window.screen.width / 1280).toFixed(3));
} else if (isTouch) {
  // Celular/tablet: sem zoom de pinça (os gestos são do app) e usando a tela toda.
  viewport?.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover');
}
document.documentElement.classList.add(`device-${DEVICE}`);
if (isTouch) document.documentElement.classList.add('touch');
document.documentElement.classList.add(`edition-${EDITION}`);
if (LITE) document.documentElement.classList.add('lite');

function Root() {
  const { account } = useAuth();
  if (!account) return <Login />;
  return (
    <StoreProvider key={account.id} account={account}>
      <App />
    </StoreProvider>
  );
}

// Assinantes: a conta vem da licença validada no servidor (sem senha guardada no app).
createRoot(document.getElementById('root')).render(
  <HashRouter>
    {isSubscriber ? (
      <LicenseProvider>
        <Root />
      </LicenseProvider>
    ) : (
      <AuthProvider>
        <Root />
      </AuthProvider>
    )}
  </HashRouter>
);
