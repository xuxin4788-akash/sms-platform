const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');

// Ruta del fichero de configuracion (servidor)
const configPath = path.join(app.getPath('userData'), 'server-config.json');

function readConfig() {
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
  } catch (e) {
    console.error('No se pudo leer la configuracion:', e);
  }
  return {};
}

function writeConfig(cfg) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf-8');
}

function normalizeUrl(input) {
  let url = (input || '').trim();
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) {
    url = 'http://' + url;
  }
  return url.replace(/\/+$/, '');
}

// Prueba de conexion al servidor: hace GET a <server>/api/auth/me
// Resuelve { ok, status, message }
function testServer(rawUrl) {
  const url = normalizeUrl(rawUrl);
  return new Promise((resolve) => {
    if (!url) {
      resolve({ ok: false, message: 'La URL del servidor esta vacia.' });
      return;
    }
    let lib;
    try {
      lib = url.startsWith('https') ? https : http;
    } catch (e) {
      resolve({ ok: false, message: 'URL invalida.' });
      return;
    }
    const req = lib.get(
      url + '/api/auth/me',
      { timeout: 8000 },
      (res) => {
        // 200 = sesion valida; 401 = servidor responde pero no hay sesion (esperado en arranque)
        const ok = res.statusCode === 200 || res.statusCode === 401;
        res.resume();
        resolve({
          ok,
          status: res.statusCode,
          message: ok
            ? 'Servidor accesible (HTTP ' + res.statusCode + ').'
            : 'El servidor respondio con HTTP ' + res.statusCode + '.'
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, message: 'Tiempo de espera agotado. Verifica la direccion.' });
    });
    req.on('error', (err) => {
      resolve({ ok: false, message: 'No se pudo conectar: ' + err.message });
    });
  });
}

let mainWindow = null;
let configWindow = null;

function createConfigWindow(initialUrl) {
  if (configWindow) {
    configWindow.focus();
    return;
  }
  configWindow = new BrowserWindow({
    width: 520,
    height: 520,
    resizable: false,
    minimizable: true,
    maximizable: false,
    fullscreenable: false,
    title: 'Configurar servidor',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  configWindow.setMenuBarVisibility(false);
  configWindow.loadFile(path.join(__dirname, 'config.html'));

  configWindow.webContents.on('did-finish-load', () => {
    configWindow.webContents.send('config:initial', { url: initialUrl || '' });
  });

  configWindow.on('closed', () => {
    configWindow = null;
  });
}

function createMainWindow(serverUrl) {
  if (mainWindow) {
    mainWindow.focus();
    return;
  }
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'SMS Plataforma',
    autoHideMenuBar: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.loadURL(serverUrl + '/');

  // Abrir enlaces externos en el navegador del sistema
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Si el servidor se cae o no responde, Electron mostrara su pagina de error.
  // Ofrecemos recargar con Ctrl+R desde el menu.

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function buildMenu() {
  const template = [
    {
      label: 'Archivo',
      submenu: [
        {
          label: 'Recargar',
          accelerator: 'Ctrl+R',
          click: () => { if (mainWindow) mainWindow.webContents.reload(); }
        },
        {
          label: 'Reconfigurar servidor...',
          click: () => {
            const cfg = readConfig();
            createConfigWindow(cfg.serverUrl || '');
          }
        },
        { type: 'separator' },
        { role: 'quit', label: 'Salir' }
      ]
    },
    {
      label: 'Edicion',
      submenu: [
        { role: 'undo', label: 'Deshacer' },
        { role: 'redo', label: 'Rehacer' },
        { type: 'separator' },
        { role: 'cut', label: 'Cortar' },
        { role: 'copy', label: 'Copiar' },
        { role: 'paste', label: 'Pegar' },
        { role: 'selectAll', label: 'Seleccionar todo' }
      ]
    },
    {
      label: 'Ver',
      submenu: [
        { role: 'togglefullscreen', label: 'Pantalla completa' },
        { role: 'zoomIn', label: 'Acercar' },
        { role: 'zoomOut', label: 'Alejar' },
        { role: 'resetZoom', label: 'Tamano real' },
        {
          label: 'Herramientas de desarrollador',
          accelerator: 'F12',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            if (win) win.webContents.toggleDevTools();
          }
        }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// --- IPC: probar conexion ---
ipcMain.handle('server:test', async (_evt, rawUrl) => {
  return await testServer(rawUrl);
});

// --- IPC: guardar y continuar ---
ipcMain.handle('server:save', async (_evt, rawUrl) => {
  const url = normalizeUrl(rawUrl);
  const result = await testServer(url);
  if (!result.ok) {
    return { ok: false, message: result.message };
  }
  writeConfig({ serverUrl: url });
  if (configWindow) {
    configWindow.close();
  }
  if (!mainWindow) {
    createMainWindow(url);
  } else {
    mainWindow.loadURL(url + '/');
    mainWindow.focus();
  }
  return { ok: true, url, message: result.message };
});

app.whenReady().then(() => {
  buildMenu();
  const cfg = readConfig();
  if (cfg.serverUrl) {
    // Validar en segundo plano; si falla, abrir configuracion.
    testServer(cfg.serverUrl).then((res) => {
      if (res.ok) {
        createMainWindow(cfg.serverUrl);
      } else {
        dialog.showErrorBox(
          'Servidor no accesible',
          'No se pudo conectar con: ' + cfg.serverUrl + '\n' + res.message +
          '\n\nSe abrira la configuracion.'
        );
        createConfigWindow(cfg.serverUrl);
      }
    });
  } else {
    createConfigWindow('');
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const cfg = readConfig();
      if (cfg.serverUrl) createMainWindow(cfg.serverUrl);
      else createConfigWindow('');
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
