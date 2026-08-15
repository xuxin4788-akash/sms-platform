const { app, BrowserWindow, Menu, dialog, ipcMain, shell, session } = require('electron');
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

  configWindow.on('closed', () => {
    configWindow = null;
  });
}

function createMainWindow(serverUrl) {
  if (mainWindow) {
    mainWindow.focus();
    return;
  }

  // El servidor envia X-Frame-Options: SAMEORIGIN (y posible CSP frame-ancestors)
  // en todas las respuestas. Electron carga el sitio desde un origen distinto
  // (el proceso renderer es file://), por lo que Chromium bloquea la carga.
  // Eliminamos esas cabeceras solo en el cliente de escritorio para permitir
  // que la ventana cargue el servidor central.
  const ses = session.defaultSession;
  if (!ses.__smsHeadersPatched) {
    ses.webRequest.onHeadersReceived((details, callback) => {
      const headers = details.responseHeaders || {};
      delete headers['X-Frame-Options'];
      delete headers['x-frame-options'];
      if (headers['Content-Security-Policy']) {
        headers['Content-Security-Policy'] = headers['Content-Security-Policy'].map(
          (v) => v.replace(/frame-ancestors[^;]*/gi, '').replace(/;\s*;/g, ';').trim()
        );
      }
      if (headers['content-security-policy']) {
        headers['content-security-policy'] = headers['content-security-policy'].map(
          (v) => v.replace(/frame-ancestors[^;]*/gi, '').replace(/;\s*;/g, ';').trim()
        );
      }
      callback({ responseHeaders: headers });
    });
    ses.__smsHeadersPatched = true;
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

  // Mostrar un error claro si la pagina no carga (servidor apagado, red, etc.)
  mainWindow.webContents.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL) => {
    if (errorCode === -3) return; // ERR_ABORTED: normal al cerrar/recargar
    const page = `<!DOCTYPE html><html><head><meta charset="utf-8">
      <title>Servidor no disponible</title>
      <style>
        body{font-family:system-ui,Segoe UI,Roboto,sans-serif;background:#f8fafc;color:#1e293b;
          display:flex;align-items:center;justify-content:center;height:100vh;margin:0;padding:24px}
        .box{max-width:520px;text-align:center}
        h1{font-size:22px;margin:0 0 8px}
        p{color:#64748b;line-height:1.6;margin:8px 0;word-break:break-all}
        code{background:#e2e8f0;padding:2px 6px;border-radius:4px}
        button{margin-top:18px;background:#2563eb;color:#fff;border:none;padding:10px 22px;
          border-radius:8px;font-size:14px;cursor:pointer}
        button:hover{background:#1d4ed8}
      </style></head>
      <body><div class="box">
        <h1>No se puede conectar con el servidor</h1>
        <p>Direccion configurada: <code>${serverUrl}</code></p>
        <p>Verifica que el servidor este en linea y que la direccion sea correcta.</p>
        <p style="font-size:12px">Error: ${errorDescription} (${errorCode})</p>
        <button onclick="location.reload()">Reintentar</button>
      </div></body></html>`;
    mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(page));
  });

  // Abrir enlaces externos en el navegador del sistema
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

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

// --- IPC: obtener configuracion guardada ---
ipcMain.handle('server:get', async () => {
  const cfg = readConfig();
  return { url: cfg.serverUrl || '' };
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
