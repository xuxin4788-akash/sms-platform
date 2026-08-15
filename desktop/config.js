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

document.addEventListener('DOMContentLoaded', () => {
  const serverInput = document.getElementById('server');
  const testBtn = document.getElementById('testBtn');
  const saveBtn = document.getElementById('saveBtn');
  const status = document.getElementById('status');
  const footer = document.getElementById('footer');

  if (!window.desktopAPI) {
    status.textContent = 'Error: la API de escritorio no esta disponible.';
    status.className = 'status error';
    testBtn.disabled = true;
    saveBtn.disabled = true;
    return;
  }

  window.desktopAPI.getInitial().then((data) => {
    if (data && data.url) serverInput.value = data.url;
  }).catch(() => {});

  testBtn.addEventListener('click', async () => {
    const url = normalizeUrl(serverInput.value);
    if (!url) {
      status.textContent = 'Introduce la direccion del servidor.';
      status.className = 'status error';
      return;
    }

    status.textContent = 'Probando conexion...';
    status.className = 'status testing';
    testBtn.disabled = true;

    try {
      const result = await window.desktopAPI.testServer(url);
      if (result && result.ok) {
        status.textContent = result.message || 'Conexion correcta.';
        status.className = 'status success';
      } else {
        status.textContent = (result && result.message) || 'No se pudo conectar.';
        status.className = 'status error';
      }
    } catch (error) {
      status.textContent = 'Error: ' + (error && error.message ? error.message : error);
      status.className = 'status error';
    } finally {
      testBtn.disabled = false;
    }
  });

  saveBtn.addEventListener('click', async () => {
    const rawUrl = String(serverInput.value || '').trim();
    if (!rawUrl) {
      status.textContent = 'Introduce la direccion del servidor.';
      status.className = 'status error';
      return;
    }

    const url = normalizeUrl(rawUrl);
    serverInput.value = url;

    status.textContent = 'Verificando conexion...';
    status.className = 'status testing';
    testBtn.disabled = true;
    saveBtn.disabled = true;

    try {
      const result = await window.desktopAPI.testServer(url);
      if (!result || !result.ok) {
        throw new Error((result && result.message) || 'No se pudo conectar con el servidor.');
      }

      status.textContent = 'Guardando y abriendo la plataforma...';
      const saved = await window.desktopAPI.saveServer(url);
      if (!saved || !saved.ok) {
        throw new Error((saved && saved.message) || 'No se pudo guardar la configuracion.');
      }
    } catch (error) {
      status.textContent = error && error.message ? error.message : 'Error inesperado.';
      status.className = 'status error';
      testBtn.disabled = false;
      saveBtn.disabled = false;
    }
  });

  if (footer) {
    footer.textContent = 'Los datos se almacenan en el servidor central. Esta aplicacion es un cliente de acceso.';
  }
});