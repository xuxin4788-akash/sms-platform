function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeUrl(input) {
  let url = String(input || '').trim();
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) url = 'http://' + url;
  return url.replace(/\/+$/, '');
}

function setStatus(text, type) {
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent = text;
  el.className = 'status ' + (type || '');
  el.style.display = text ? 'block' : 'none';
}

window.addEventListener('error', (event) => {
  setStatus('Error: ' + (event.message || 'error desconocido'), 'error');
});

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason && (event.reason.message || event.reason);
  setStatus('Error: ' + (reason || 'promesa rechazada'), 'error');
});

document.addEventListener('DOMContentLoaded', () => {
  const serverInput = document.getElementById('server');
  const testBtn = document.getElementById('testBtn');
  const saveBtn = document.getElementById('saveBtn');

  const api = window.api;
  if (!api || !api.server || typeof api.server.save !== 'function') {
    setStatus(
      'Error interno: no se pudo cargar el puente de escritorio. ' +
      'window.api=' + (typeof window.api) +
      '; preload=' + (window.api ? Object.keys(window.api).join(',') : 'undefined'),
      'error'
    );
    if (testBtn) testBtn.disabled = true;
    if (saveBtn) saveBtn.disabled = true;
    return;
  }

  api.server.get().then((data) => {
    if (data && data.url) serverInput.value = data.url;
  }).catch(() => {});

  testBtn.addEventListener('click', async () => {
    const url = normalizeUrl(serverInput.value);
    if (!url) {
      setStatus('Introduce la direccion del servidor.', 'error');
      return;
    }

    setStatus('Probando conexion...', 'testing');
    testBtn.disabled = true;

    try {
      const result = await api.server.test(url);
      if (result && result.ok) {
        setStatus(result.message || 'Conexion correcta.', 'success');
      } else {
        setStatus((result && result.message) || 'No se pudo conectar.', 'error');
      }
    } catch (error) {
      setStatus('Error: ' + (error && error.message ? error.message : error), 'error');
    } finally {
      testBtn.disabled = false;
    }
  });

  saveBtn.addEventListener('click', async () => {
    const rawUrl = String(serverInput.value || '').trim();
    if (!rawUrl) {
      setStatus('Introduce la direccion del servidor.', 'error');
      return;
    }

    const url = normalizeUrl(rawUrl);
    serverInput.value = url;

    setStatus('Verificando conexion...', 'testing');
    testBtn.disabled = true;
    saveBtn.disabled = true;

    try {
      const result = await api.server.test(url);
      if (!result || !result.ok) {
        throw new Error((result && result.message) || 'No se pudo conectar con el servidor.');
      }

      setStatus('Guardando y abriendo la plataforma...', 'testing');
      const saved = await api.server.save(url);
      if (!saved || !saved.ok) {
        throw new Error((saved && saved.message) || 'No se pudo guardar la configuracion.');
      }
    } catch (error) {
      setStatus(error && error.message ? error.message : 'Error inesperado.', 'error');
      testBtn.disabled = false;
      saveBtn.disabled = false;
    }
  });

  const footer = document.getElementById('footer');
  if (footer) {
    footer.textContent = 'Los datos se almacenan en el servidor central. Esta aplicacion es un cliente de acceso.';
  }
});
