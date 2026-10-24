// App de Windows do GATES! TV: sobe o servidor local (app + proxy + verificação de canais)
// e abre o app numa janela própria.
const { app, BrowserWindow, Menu, ipcMain, shell } = require('electron');
const { execFile } = require('node:child_process');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// Porta fixa: os dados salvos (login, perfis, listas) ficam ligados ao endereço do app.
// O instalador de TESTE (assinantes) usa outra porta e outro build do app (package.json: gatesPort/gatesWeb).
const pkg = require('../package.json');
const PORT = pkg.gatesPort || 47123;
const WEB = pkg.gatesWeb || 'dist';

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// Pasta de dados própria por versão (família, teste, assinante), para nunca misturar login e listas.
if (pkg.gatesUserData) app.setPath('userData', path.join(app.getPath('appData'), pkg.gatesUserData));
// Testes automáticos: GATES_HIDDEN=1 abre sem mostrar janela.
const HIDDEN = process.env.GATES_HIDDEN === '1';

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

let win;

async function createWindow() {
  const { startServer } = await import(pathToFileURL(path.join(__dirname, '..', 'server', 'gates-server.mjs')).href);
  try {
    await startServer({ root: path.join(app.getAppPath(), WEB), port: PORT });
  } catch (err) {
    if (err.code !== 'EADDRINUSE') throw err; // já existe uma instância servindo
  }

  win = new BrowserWindow({
    width: 1440,
    height: 860,
    minWidth: 960,
    minHeight: 600,
    fullscreen: !HIDDEN, // sempre abre em tela cheia (F11 alterna)
    show: !HIDDEN,
    backgroundColor: '#121214',
    title: pkg.gatesTitle || 'GATES! TV',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload.cjs') },
  });
  Menu.setApplicationMenu(null);
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') win.setFullScreen(!win.isFullScreen());
    if (input.key === 'F12' && input.control) win.webContents.toggleDevTools();
  });
  // Links externos (IMDb, JustWatch…) abrem no navegador.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  await win.loadURL(`http://127.0.0.1:${PORT}/`);
}

// Configurações → "Desligar o computador": fecha o app e desliga o Windows em 3 segundos.
ipcMain.handle('gates:shutdown', (e) => {
  if (!win || e.sender !== win.webContents) return false;
  const shutdown = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'shutdown.exe');
  execFile(shutdown, ['/s', '/t', '3'], (err) => {
    if (!err) app.quit();
  });
  return true;
});
ipcMain.handle('gates:quit', (e) => {
  if (win && e.sender === win.webContents) app.quit();
});

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.setFullScreen(true);
  win.focus();
});
// Segunda abertura: a instância que já está aberta vem para a frente (esta não cria janela).
if (gotLock) app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
