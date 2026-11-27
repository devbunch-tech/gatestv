// Entrada do GATES Narração (narracao.html). Exige a assinatura do GATES! TV em dia, com a mesma
// trava da edição de assinantes (LicenseGate); os dados ficam separados porque o app roda em outra porta.
import '../lib/polyfills';
import { createRoot } from 'react-dom/client';
import { DEVICE, isTouch } from '../lib/device';
import { detectTv, setTvMode } from '../lib/keys';
import { LicenseProvider } from '../components/LicenseGate';
import App from './App';
// Estilos do app principal + os próprios, numa ordem só (importados como texto para não mexer nos
// arquivos de CSS gerados para o index.html).
import baseCss from '../styles.css?inline';
import tvCss from '../styles-tv.css?inline';
import v3Css from '../styles-v3.css?inline';
import ownCss from './narracao.css?inline';

const style = document.createElement('style');
style.textContent = [baseCss, tvCss, v3Css, ownCss].join('\n');
document.head.appendChild(style);

const viewport = document.querySelector('meta[name=viewport]');
if (DEVICE === 'tv' && window.GatesAndroid) {
  // Android TV: mesma escala do app principal (página de 1280 de largura reduzida para a tela).
  viewport?.setAttribute('content', 'width=1280, initial-scale=' + (window.screen.width / 1280).toFixed(3));
} else if (isTouch) {
  viewport?.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover');
}
document.documentElement.classList.add(`device-${DEVICE}`, 'narracao');
if (isTouch) document.documentElement.classList.add('touch');
if (window.GatesNarr) document.documentElement.classList.add('narr-desktop');

// Modo TV (navegação pelo controle): Android TV, Smart TV pelo navegador ou ?tv=1.
const tv = !isTouch && (DEVICE === 'tv' || detectTv() || typeof window.GatesAndroid?.narrOpenApp === 'function');
setTvMode(tv);
document.body.classList.toggle('tv', tv);

createRoot(document.getElementById('root')).render(
  <LicenseProvider>
    <App />
  </LicenseProvider>
);
