// GATES Narração (Windows): toca a narração de uma live numa janela própria que vira uma
// janelinha sempre por cima (até de navegador em tela cheia) e controla o volume dos outros apps.
// Sobe o mesmo servidor local do GATES! TV e abre narracao.html.
//
// A moldura (frame) de uma janela não muda depois de criada, e recriar a janela recarregaria a
// narração. Por isso a janela é sempre sem moldura e, no modo normal, ganha uma barra de título
// própria (outra WebContentsView em cima); na janelinha a página ocupa tudo.
const { app, BaseWindow, WebContentsView, Menu, ipcMain, shell, screen, globalShortcut, desktopCapturer } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createAudio } = require('./audio-volume.cjs');

const pkg = require('../package.json');
const PORT = pkg.gatesPort || 47152;
const WEB = pkg.gatesWeb || 'dist-sub';
const TITLE = pkg.gatesTitle || 'GATES Narração';
const ICON = path.join(__dirname, '..', 'build', 'icon-narracao.png');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.setPath('userData', path.join(app.getPath('appData'), pkg.gatesUserData || 'GATES Narracao'));
app.setAppUserModelId('br.com.gatestv.narracao');
// Testes automáticos: GATES_HIDDEN=1 abre sem mostrar janela.
const HIDDEN = process.env.GATES_HIDDEN === '1';

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

// Tamanhos: janelinha = player 16:9 + barra de controle da página (60px).
const BAR = 60;
const TITLE_H = 32;
const MINI_MIN_W = 280;
const MARGIN = 16;
const miniHeight = (w) => Math.round((w * 9) / 16) + BAR;

let win = null; // BaseWindow
let page = null; // WebContentsView da narração
let titleBar = null; // WebContentsView da barra de título (modo normal)
let mode = 'full';
const audio = createAudio({ tmpDir: app.getPath('temp'), log: (...a) => console.log(...a) });

// ---------- posição/tamanho lembrados ----------
const stateFile = () => path.join(app.getPath('userData'), 'narracao-janela.json');
let state = { full: { width: 1100, height: 700 }, mini: { width: 420, height: miniHeight(420) }, corner: 'br' };
try {
  Object.assign(state, JSON.parse(fs.readFileSync(stateFile(), 'utf8')));
} catch {
  /* primeira vez */
}
let saveTimer = null;
function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.writeFileSync(stateFile(), JSON.stringify(state));
    } catch {
      /* sem disco: segue sem lembrar */
    }
  }, 400);
}

// Só usa a posição salva se ela ainda aparece em alguma tela (monitor pode ter sido desligado).
function onScreen(b) {
  if (!Number.isFinite(b?.x) || !Number.isFinite(b?.y)) return false;
  return screen.getAllDisplays().some(({ workArea: w }) => {
    const ox = Math.min(b.x + b.width, w.x + w.width) - Math.max(b.x, w.x);
    const oy = Math.min(b.y + b.height, w.y + w.height) - Math.max(b.y, w.y);
    return ox >= 100 && oy >= 40;
  });
}

// Mudanças feitas pelo próprio app não contam como "o usuário arrastou".
let ownMoveUntil = 0;
function setBounds(b) {
  ownMoveUntil = Date.now() + 500;
  win.setBounds({ x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) });
}

function cornerPos(corner, width, height, ref) {
  const wa = screen.getDisplayMatching(ref || win.getBounds()).workArea;
  return {
    x: corner[1] === 'l' ? wa.x + MARGIN : wa.x + wa.width - width - MARGIN,
    y: corner[0] === 't' ? wa.y + MARGIN : wa.y + wa.height - height - MARGIN,
  };
}

// ---------- layout das duas views ----------
function layout() {
  if (!win || win.isDestroyed()) return;
  const [w, h] = win.getContentSize();
  const bar = mode === 'full' && !win.isFullScreen() ? TITLE_H : 0;
  titleBar.setVisible(bar > 0);
  titleBar.setBounds({ x: 0, y: 0, width: w, height: bar });
  page.setBounds({ x: 0, y: bar, width: w, height: Math.max(0, h - bar) });
}

const js = (view, code) => view?.webContents.executeJavaScript(code, true).catch(() => {});
const emit = (name, detail) => js(page, `window.dispatchEvent(new CustomEvent(${JSON.stringify(name)}, { detail: ${JSON.stringify(detail)} }))`);
const syncTitleBar = () => js(titleBar, `window.setMax && setMax(${win.isMaximized()})`);

// ---------- modos ----------
// Só faz efeito no macOS/Linux; no Windows o nível 'screen-saver' já basta.
function allWorkspaces(on) {
  try {
    win.setVisibleOnAllWorkspaces(on, { visibleOnFullScreen: true });
  } catch {
    /* não existe nesta plataforma */
  }
}

function setMode(next, { focus = true } = {}) {
  if (next !== 'mini' && next !== 'full') throw new Error('modo inválido');
  if (!win || next === mode) return mode;
  if (win.isMinimized()) win.restore();
  if (win.isFullScreen()) win.setFullScreen(false);
  if (next === 'mini') {
    state.full = { ...(win.isMaximized() ? win.getNormalBounds() : win.getBounds()), max: win.isMaximized() };
    if (win.isMaximized()) win.unmaximize();
    mode = 'mini';
    win.setMaximizable(false);
    win.setMinimumSize(MINI_MIN_W, miniHeight(MINI_MIN_W));
    const width = Math.max(MINI_MIN_W, state.mini?.width || 420);
    const height = miniHeight(width);
    let b = { x: state.mini?.x, y: state.mini?.y, width, height };
    if (state.corner || !onScreen(b)) b = { ...b, ...cornerPos(state.corner || 'br', width, height, onScreen(b) ? b : win.getBounds()) };
    setBounds(b);
    // Nível 'screen-saver': fica por cima até de navegador/Prime Video em tela cheia.
    win.setAlwaysOnTop(true, 'screen-saver');
    allWorkspaces(true);
  } else {
    mode = 'full';
    win.setAlwaysOnTop(false);
    allWorkspaces(false);
    win.setMaximizable(true);
    win.setMinimumSize(640, 400);
    const f = state.full || {};
    const b = { x: f.x, y: f.y, width: f.width || 1100, height: f.height || 700 };
    if (onScreen(b)) setBounds(b);
    else {
      win.setSize(b.width, b.height);
      win.center();
    }
    if (f.max) win.maximize();
  }
  layout();
  state.mode = mode;
  saveState();
  if (!win.isVisible() && !HIDDEN) focus ? win.show() : win.showInactive();
  else if (focus && !HIDDEN) win.focus();
  emit('gates-narr-mode', { mode });
  return mode;
}

function setCorner(corner) {
  if (!['tl', 'tr', 'bl', 'br'].includes(corner)) throw new Error('canto inválido');
  state.corner = corner;
  saveState();
  if (mode === 'mini') {
    const b = win.getBounds();
    setBounds({ ...b, ...cornerPos(corner, b.width, b.height) });
    state.mini = win.getBounds();
  }
  return corner;
}

// Janelinha redimensionada pela borda: mantém a proporção (o extraSize do setAspectRatio só
// existe no macOS) e, se está presa num canto, continua no canto.
function onWillResize(e, nb, details) {
  if (mode !== 'mini') return;
  const edge = details?.edge || '';
  const cur = win.getBounds();
  let width = edge === 'top' || edge === 'bottom' ? Math.round(((nb.height - BAR) * 16) / 9) : nb.width;
  const wa = screen.getDisplayMatching(cur).workArea;
  width = Math.max(MINI_MIN_W, Math.min(width, wa.width - 2 * MARGIN));
  const height = miniHeight(width);
  if (width === cur.width && height === cur.height) return e.preventDefault();
  e.preventDefault();
  let pos;
  if (state.corner) pos = cornerPos(state.corner, width, height, cur);
  else pos = { x: edge.includes('left') ? cur.x + cur.width - width : cur.x, y: edge.includes('top') ? cur.y + cur.height - height : cur.y };
  setBounds({ ...pos, width, height });
}

function rememberBounds(userMove) {
  if (!win || win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
  if (mode === 'mini') {
    state.mini = win.getBounds();
    if (userMove && Date.now() > ownMoveUntil) state.corner = null; // arrastou para outro lugar
  } else if (win.isMaximized()) {
    state.full = { ...win.getNormalBounds(), max: true };
  } else state.full = { ...win.getBounds(), max: false };
  saveState();
}

// ---------- barra de título do modo normal ----------
const TITLE_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0}
html,body{height:100%;overflow:hidden;background:#0b0b0d;color:#d8d8dc;font:12px "Segoe UI",system-ui,sans-serif;user-select:none}
.bar{display:flex;align-items:center;height:100%;-webkit-app-region:drag}
.t{flex:1;padding-left:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
button{-webkit-app-region:no-drag;width:46px;height:100%;border:0;background:transparent;color:inherit;font:10px "Segoe Fluent Icons","Segoe MDL2 Assets";cursor:default}
button:hover{background:rgba(255,255,255,.1)}button.x:hover{background:#c42b1c;color:#fff}
</style></head><body><div class="bar"><div class="t" id="t">${TITLE}</div>
<button title="Janelinha sempre por cima (Ctrl+Alt+M)" onclick="GatesNarr.setMode('mini')">&#xE8A7;</button>
<button title="Minimizar" onclick="GatesNarr.win('min')">&#xE921;</button>
<button title="Maximizar" id="m" onclick="GatesNarr.win('max')">&#xE922;</button>
<button title="Fechar" class="x" onclick="GatesNarr.win('close')">&#xE8BB;</button></div>
<script>function setMax(v){var m=document.getElementById('m');m.innerHTML=v?'&#xE923;':'&#xE922;';m.title=v?'Restaurar':'Maximizar'}
function setTitle(s){document.getElementById('t').textContent=s}</script></body></html>`;

// ---------- janela ----------
let otaApi = null;

async function createWindow() {
  const { startServer } = await import(pathToFileURL(path.join(__dirname, '..', 'server', 'gates-server.mjs')).href);
  // Atualização automática da interface, igual ao main.cjs.
  let embeddedDir = path.join(app.getAppPath(), WEB);
  // Rodando direto (npx electron electron/narracao.cjs): a pasta do app é electron/.
  if (!fs.existsSync(embeddedDir)) embeddedDir = path.join(__dirname, '..', WEB);
  let webRoot = embeddedDir;
  if (pkg.gatesOta) {
    try {
      const ota = require('./ota.cjs');
      const cfg = require('../ota.config.json');
      const userData = app.getPath('userData');
      webRoot = ota.activeRoot(userData, embeddedDir);
      const opts = { userData, embeddedDir, activeDir: webRoot, manifestUrl: cfg.manifestUrl, publicKey: cfg.publicKey };
      setTimeout(() => ota.check(opts), 15000);
      otaApi = { status: () => ota.status({ userData, activeDir: webRoot, enabled: true }), check: () => ota.check(opts) };
    } catch {
      webRoot = embeddedDir;
    }
  }
  try {
    await startServer({ root: webRoot, port: PORT });
  } catch (err) {
    if (err.code !== 'EADDRINUSE') throw err; // já existe uma instância servindo
  }

  const f = state.full || {};
  win = new BaseWindow({
    width: f.width || 1100,
    height: f.height || 700,
    ...(onScreen(f) ? { x: f.x, y: f.y } : {}),
    minWidth: 640,
    minHeight: 400,
    frame: false,
    show: false,
    backgroundColor: '#121214',
    title: TITLE,
    icon: ICON,
  });
  Menu.setApplicationMenu(null);
  const prefs = { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload-narracao.cjs') };
  page = new WebContentsView({ webPreferences: { ...prefs, backgroundThrottling: false } });
  titleBar = new WebContentsView({ webPreferences: prefs });
  page.setBackgroundColor('#121214');
  titleBar.setBackgroundColor('#0b0b0d');
  win.contentView.addChildView(page);
  win.contentView.addChildView(titleBar);
  layout();

  win.on('resize', layout);
  win.on('maximize', () => (layout(), syncTitleBar(), rememberBounds()));
  win.on('unmaximize', () => (layout(), syncTitleBar(), rememberBounds()));
  win.on('enter-full-screen', layout);
  win.on('leave-full-screen', layout);
  win.on('will-resize', onWillResize);
  win.on('resized', () => rememberBounds(false));
  win.on('moved', () => rememberBounds(true));
  win.on('closed', () => app.quit());

  for (const v of [page, titleBar]) {
    // Links externos abrem no navegador.
    v.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
  }
  page.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F12' && input.control) page.webContents.toggleDevTools();
    if (input.key === 'F11' && mode === 'full') win.setFullScreen(!win.isFullScreen());
  });
  page.webContents.on('page-title-updated', (e, t) => {
    const title = t && !/^GATES!? ?TV$/i.test(t) ? t : TITLE;
    win.setTitle(title);
    js(titleBar, `setTitle(${JSON.stringify(title)})`);
  });

  if (f.max) win.maximize();
  if (!HIDDEN) win.show();
  // Página recarregada (ou atualizada): avisa de novo em que modo está.
  page.webContents.on('did-finish-load', () => emit('gates-narr-mode', { mode }));
  await titleBar.webContents.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(TITLE_HTML));
  // Sempre abre no modo normal (a janelinha só faz sentido com uma narração escolhida);
  // tamanho/posição/canto da janelinha ficam lembrados para quando ela for aberta.
  await page.webContents.loadURL(`http://127.0.0.1:${PORT}/narracao.html${pkg.gatesQuery || ''}`);
  page.webContents.focus();
}

// ---------- atalhos globais ----------
const SHORTCUTS = {
  'Control+Alt+Right': 'delay+1',
  'Control+Alt+Left': 'delay-1',
  'Control+Alt+Up': 'delay+5',
  'Control+Alt+Down': 'delay-5',
  'Control+Alt+Space': 'pause',
  'Control+Alt+M': 'mini',
  'Control+Alt+V': 'seen',
  'Control+Alt+O': 'heard',
  'Control+Alt+I': 'ai',
};
function registerShortcuts() {
  for (const [acc, id] of Object.entries(SHORTCUTS)) {
    let ok = false;
    try {
      ok = globalShortcut.register(acc, () => {
        if (!win) return;
        if (id === 'mini') return setMode(mode === 'mini' ? 'full' : 'mini', { focus: mode === 'mini' });
        emit('gates-narr-action', { id });
      });
    } catch {
      /* atalho inválido neste teclado */
    }
    if (!ok) console.log('atalho ocupado por outro app:', acc); // segue sem ele
  }
}

// ---------- ponte com a página ----------
const fromPage = (e) => !!page && e.sender === page.webContents;
const fromUi = (e) => fromPage(e) || (!!titleBar && e.sender === titleBar.webContents);
const myPids = () => app.getAppMetrics().map((m) => m.pid);

ipcMain.handle('gates-narr:mode', (e, m) => (fromUi(e) ? setMode(m) : null));
ipcMain.handle('gates-narr:get-mode', (e) => (fromUi(e) ? mode : null));
ipcMain.handle('gates-narr:corner', (e, c) => (fromPage(e) ? setCorner(c) : null));
ipcMain.handle('gates-narr:audio-apps', async (e) => {
  if (!fromPage(e)) return [];
  try {
    return await audio.list(myPids());
  } catch {
    return []; // PowerShell não abriu: lista vazia (audioStatus() traz o erro amigável)
  }
});
ipcMain.handle('gates-narr:audio-status', (e) => (fromPage(e) ? audio.status() : null));
ipcMain.handle('gates-narr:app-volume', (e, id, v) => (fromPage(e) ? audio.setVolume(id, v) : false));
ipcMain.handle('gates-narr:app-mute', (e, id, m) => (fromPage(e) ? audio.setMute(id, m) : false));
ipcMain.handle('gates-narr:win', (e, action) => {
  if (!fromUi(e) || !win) return;
  if (action === 'min') win.minimize();
  else if (action === 'max') win.isMaximized() ? win.unmaximize() : win.maximize();
  else if (action === 'close') app.quit();
});
ipcMain.handle('gates:quit', (e) => {
  if (fromUi(e)) app.quit();
});

// "Sincronizar pela IA": foto da tela onde está a janela (o jogo passa em outro app por baixo dela),
// reduzida a no máx. 'maxW' px, com o retângulo da janela ('win', pintado de preto na foto do jogo)
// e o da página ('page', abaixo da barra de título: converte as posições da página), em px do quadro.
ipcMain.handle('gates-narr:capture', async (e, opts) => {
  if (!fromPage(e) || !win || win.isMinimized()) return null;
  const b = win.getBounds();
  const d = screen.getDisplayMatching(b);
  const maxW = Math.max(640, Math.min(2560, Number(opts?.maxW) || 1600));
  const k = Math.min(d.scaleFactor, maxW / d.bounds.width);
  const size = { width: Math.round(d.bounds.width * k), height: Math.round(d.bounds.height * k) };
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
  const src = sources.find((x) => String(x.display_id) === String(d.id)) || (sources.length === 1 ? sources[0] : null);
  if (!src || src.thumbnail.isEmpty()) return null;
  const { width: w, height: h } = src.thumbnail.getSize();
  const kx = w / d.bounds.width;
  const ky = h / d.bounds.height;
  const rect = (r) => ({ x: (r.x - d.bounds.x) * kx, y: (r.y - d.bounds.y) * ky, w: r.width * kx, h: r.height * ky });
  const c = win.getContentBounds();
  const p = page.getBounds();
  return { image: src.thumbnail.toJPEG(80).toString('base64'), w, h, win: rect(b), page: rect({ x: c.x + p.x, y: c.y + p.y, width: p.width, height: p.height }) };
});

// Tela "Procurar atualizações" (mesmos canais do main.cjs).
ipcMain.handle('gates:ota-info', (e) => (fromPage(e) ? otaApi?.status() || { enabled: false } : null));
ipcMain.handle('gates:ota-check', (e) => {
  if (!fromPage(e) || !otaApi) return false;
  otaApi.check();
  return true;
});
ipcMain.handle('gates:ota-apply', (e) => {
  if (!fromPage(e) || !otaApi) return;
  app.relaunch();
  app.exit(0);
});

// Segunda abertura: a janela que já está aberta vem para a frente.
app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
});
if (gotLock)
  app.whenReady().then(async () => {
    registerShortcuts();
    await createWindow();
  });
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  audio.close();
  if (win && !win.isDestroyed()) rememberBounds(false);
  clearTimeout(saveTimer);
  try {
    fs.writeFileSync(stateFile(), JSON.stringify(state));
  } catch {
    /* sem disco */
  }
});
app.on('window-all-closed', () => app.quit());
