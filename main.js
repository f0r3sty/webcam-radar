const { app, BrowserWindow, ipcMain, shell, screen } = require('electron');
const path = require('path');
const fs = require('fs');

// 允许视频自动播放（摄像头流本身多为无声）
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const configPath = () => path.join(app.getPath('userData'), 'config.json');
function loadConfig() {
  try { return JSON.parse(fs.readFileSync(configPath(), 'utf8')); } catch { return {}; }
}
function saveConfig(partial) {
  const cfg = Object.assign(loadConfig(), partial);
  try { fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2)); } catch {}
  return cfg;
}

let win = null;
let widgetWin = null;

// 单实例：开机自启时若已在运行则聚焦，不再开第二个
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win && !win.isDestroyed()) { win.show(); win.focus(); }
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1240,
    height: 780,
    minWidth: 940,
    minHeight: 620,
    title: '全球摄像头',
    backgroundColor: '#0a0e16',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false, // hls.js 需跨域拉取 m3u8 / ts 分片
      backgroundThrottling: false,
    },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('closed', () => { win = null; });

  if (process.env.CAM_SCREENSHOT) {
    setTimeout(async () => {
      try {
        const img = await win.webContents.capturePage();
        fs.writeFileSync('/tmp/cam_shot.png', img.toPNG());
        console.log('[screenshot] saved /tmp/cam_shot.png');
        app.exit(0);
      } catch (e) { console.error('[screenshot] fail', e); app.exit(1); }
    }, Number(process.env.CAM_SCREENSHOT) || 20000);
  }
}

// ---------- 桌面小挂件 ----------
const WIDGET_W = 420;
const WIDGET_H = 292;

function openWidgetWindow() {
  if (widgetWin && !widgetWin.isDestroyed()) { widgetWin.show(); widgetWin.focus(); return; }
  const cfg = loadConfig();
  const area = screen.getPrimaryDisplay().workAreaSize;
  widgetWin = new BrowserWindow({
    width: WIDGET_W,
    height: WIDGET_H,
    x: Number.isFinite(cfg.widgetX) ? cfg.widgetX : area.width - WIDGET_W - 24,
    y: Number.isFinite(cfg.widgetY) ? cfg.widgetY : 80,
    frame: false,
    transparent: true,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    fullscreenable: false,
    alwaysOnTop: true,
    title: '摄像头挂件',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
      backgroundThrottling: false,
    },
  });
  widgetWin.loadFile(path.join(__dirname, 'renderer', 'widget.html'));

  const pin = cfg.widgetPin || 'desktop';
  try { widgetWin.setAlwaysOnTop(true, pin === 'top' ? 'floating' : 'desktop'); } catch (e) {}
  widgetWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: pin === 'top' });

  widgetWin.on('moved', () => {
    const [x, y] = widgetWin.getPosition();
    saveConfig({ widgetX: x, widgetY: y });
  });
  widgetWin.on('closed', () => { widgetWin = null; });

  if (process.env.WIDGET_SCREENSHOT) {
    setTimeout(async () => {
      try {
        const img = await widgetWin.webContents.capturePage();
        fs.writeFileSync('/tmp/widget_shot.png', img.toPNG());
        console.log('[widget-screenshot] saved /tmp/widget_shot.png');
        app.exit(0);
      } catch (e) { console.error('[widget-screenshot] fail', e); app.exit(1); }
    }, Number(process.env.WIDGET_SCREENSHOT) || 20000);
  }
}

app.whenReady().then(() => {
  if (process.env.WIDGET_ONLY) {
    openWidgetWindow();
  } else {
    createWindow();
    openWidgetWindow(); // 开机自启即弹出挂件
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) { createWindow(); openWidgetWindow(); }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---------- IPC ----------
ipcMain.handle('catalog:get', () => {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'catalog.json'), 'utf8')); }
  catch (e) { return []; }
});

ipcMain.handle('proxy:text', async (_e, url) => {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
      },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, text: await res.text() };
  } catch (e) { return { ok: false, error: String(e) }; }
});

ipcMain.handle('open:external', (_e, url) => { shell.openExternal(url); return true; });

ipcMain.handle('widget:open', () => { openWidgetWindow(); return true; });
ipcMain.handle('widget:close', () => {
  if (widgetWin && !widgetWin.isDestroyed()) widgetWin.close();
  widgetWin = null;
  return true;
});
ipcMain.handle('widget:pin', (_e, mode) => {
  saveConfig({ widgetPin: mode });
  if (widgetWin && !widgetWin.isDestroyed()) {
    try { widgetWin.setAlwaysOnTop(true, mode === 'top' ? 'floating' : 'desktop'); } catch (e) {}
    widgetWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: mode === 'top' });
  }
  return mode;
});
ipcMain.handle('widget:openMain', () => {
  if (win && !win.isDestroyed()) { win.show(); win.focus(); }
  else createWindow();
  return true;
});

// 主窗与挂件共享的配置（间隔等）
ipcMain.handle('config:get', () => loadConfig());
ipcMain.handle('config:set', (_e, partial) => saveConfig(partial));
