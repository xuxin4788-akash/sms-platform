const $ = (id) => document.getElementById(id);
const input = $('server');
const testBtn = $('testBtn');
const saveBtn = $('saveBtn');
const status = $('status');

function setStatus(type, html) {
  status.className = 'status show ' + type;
  status.innerHTML = html;
}
function clearStatus() {
  status.className = 'status';
  status.innerHTML = '';
}

function norm(u) {
  u = (u || '').trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'http://' + u;
  return u.replace(/\/+$/, '');
}

window.desktopAPI.getInitial((data) => {
  if (data && data.url) input.value = data.url;
  setTimeout(() => input.focus(), 50);
});

testBtn.addEventListener('click', async () => {
  const url = norm(input.value);
  if (!url) {
    setStatus('err', 'Introduce una direccion valida.');
    return;
  }
  testBtn.disabled = true;
  setStatus('info', 'Probando conexion...');
  const res = await window.desktopAPI.testServer(url);
  testBtn.disabled = false;
  if (res.ok) setStatus('ok', 'Conexion correcta. ' + res.message);
  else setStatus('err', res.message);
});

saveBtn.addEventListener('click', async () => {
  const url = norm(input.value);
  if (!url) {
    setStatus('err', 'Introduce una direccion valida.');
    return;
  }
  saveBtn.disabled = true;
  saveBtn.innerHTML = '<span class="spinner"></span>Conectando...';
  const res = await window.desktopAPI.saveServer(url);
  if (!res.ok) {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Guardar y continuar';
    setStatus('err', res.message);
  }
  // si ok, la ventana se cierra desde el proceso principal
});

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') saveBtn.click();
});
