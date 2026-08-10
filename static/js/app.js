/* ============================================================
   SMS Marketing Platform - Frontend Application
   ============================================================ */

// ============================================================
// State Management
// ============================================================
const state = {
    user: null,
    currentPage: 'dashboard',
    contacts: { page: 1, perPage: 20, total: 0, totalPages: 0, search: '', groupId: '', remark: '' },
    records: { page: 1, perPage: 20, total: 0, totalPages: 0, status: '', dateFrom: '', dateTo: '', search: '' },
    sendPhones: [],
    sendMode: 'manual',
};

// ============================================================
// API Helper
// ============================================================
async function api(url, options = {}) {
    const defaults = { headers: { 'Content-Type': 'application/json' }, credentials: 'include' };
    const config = { ...defaults, ...options };
    if (config.body && typeof config.body === 'object' && !(config.body instanceof FormData)) {
        config.body = JSON.stringify(config.body);
    }
    if (config.body instanceof FormData) { delete config.headers['Content-Type']; }
    try {
        const res = await fetch(url, config);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Error en la solicitud');
        return data;
    } catch (err) { throw err; }
}

// ============================================================
// Utilities
// ============================================================
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    try {
        const d = new Date(dateStr.replace(' ', 'T'));
        return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch { return dateStr; }
}

function timeAgo(dateStr) {
    if (!dateStr) return '-';
    try {
        const now = new Date();
        const d = new Date(dateStr.replace(' ', 'T'));
        const diff = Math.floor((now - d) / 1000);
        if (diff < 60) return 'Hace ' + diff + 's';
        if (diff < 3600) return 'Hace ' + Math.floor(diff / 60) + 'm';
        if (diff < 86400) return 'Hace ' + Math.floor(diff / 3600) + 'h';
        if (diff < 604800) return 'Hace ' + Math.floor(diff / 86400) + 'd';
        return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch { return dateStr; }
}

function getStatusBadge(status) {
    const map = {
        sent: '<span class="badge badge-green">Enviado</span>',
        failed: '<span class="badge badge-red">Fallido</span>',
        pending: '<span class="badge badge-yellow">Pendiente</span>',
        scheduled: '<span class="badge badge-blue">Programado</span>'
    };
    return map[status] || '<span class="badge badge-gray">' + escapeHtml(status) + '</span>';
}

function renderPagination(data, type) {
    if (data.total_pages <= 1) return '';
    const info = `Mostrando ${((data.page - 1) * data.per_page) + 1}-${Math.min(data.page * data.per_page, data.total)} de ${data.total}`;
    let buttons = '';
    buttons += `<button ${data.page <= 1 ? 'disabled' : ''} onclick="changePage('${type}', ${data.page - 1})">Anterior</button>`;
    const start = Math.max(1, data.page - 2);
    const end = Math.min(data.total_pages, data.page + 2);
    for (let i = start; i <= end; i++) {
        buttons += `<button class="${i === data.page ? 'active' : ''}" onclick="changePage('${type}', ${i})">${i}</button>`;
    }
    buttons += `<button ${data.page >= data.total_pages ? 'disabled' : ''} onclick="changePage('${type}', ${data.page + 1})">Siguiente</button>`;
    return `<div class="pagination"><span class="pagination-info">${info}</span><div class="pagination-buttons">${buttons}</div></div>`;
}

function changePage(type, page) {
    if (type === 'contacts') { state.contacts.page = page; renderContacts(document.getElementById('page-content')); }
    else if (type === 'records') { state.records.page = page; renderRecords(document.getElementById('page-content')); }
    else if (type === 'contentSearch') { state.contentSearch.page = page; renderContentSearch(document.getElementById('page-content')); }
}

// ============================================================
// Toast Notifications
// ============================================================
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast ' + type;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(function() {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(20px)';
        toast.style.transition = '200ms ease';
        setTimeout(function() { toast.remove(); }, 200);
    }, 3000);
}

// ============================================================
// Modal
// ============================================================
function showModal(title, bodyHtml) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = bodyHtml;
    document.getElementById('modal-overlay').style.display = 'flex';
}

function hideModal() {
    document.getElementById('modal-overlay').style.display = 'none';
}

function closeModal(event) {
    if (event.target === document.getElementById('modal-overlay')) hideModal();
}

// ============================================================
// Auth
// ============================================================
document.getElementById('login-form').addEventListener('submit', async function(e) {
    e.preventDefault();
    var username = document.getElementById('login-username').value.trim();
    var password = document.getElementById('login-password').value;
    var errorEl = document.getElementById('login-error');
    errorEl.style.display = 'none';
    try {
        var data = await api('/api/auth/login', { method: 'POST', body: { username: username, password: password } });
        state.user = data.user;
        showMainApp();
    } catch (err) {
        errorEl.textContent = err.message;
        errorEl.style.display = 'block';
    }
});

async function checkAuth() {
    try {
        var data = await api('/api/auth/me');
        state.user = data.user;
        showMainApp();
    } catch (e) { showLogin(); }
}

function showLogin() {
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('main-layout').style.display = 'none';
}

function showMainApp() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('main-layout').style.display = 'flex';
    document.getElementById('user-name').textContent = state.user.full_name || state.user.username;
    var roleEl = document.getElementById('user-role');
    roleEl.textContent = state.user.role_label || state.user.role;
    var roleBadgeClass = {
        'admin': 'badge badge-blue',
        'team_admin': 'badge badge-green',
        'team_member': 'badge badge-gray'
    };
    roleEl.className = roleBadgeClass[state.user.role] || 'badge badge-gray';

    // Role-based navigation visibility
    var role = state.user.role;
    document.querySelectorAll('.nav-item').forEach(function(el) {
        var page = el.dataset.page;
        var show = true;
        // System admin only pages
        if (['config', 'logs', 'team-stats'].includes(page)) {
            show = role === 'admin';
        }
        // Manager pages (admin + team_admin)
        else if (['users'].includes(page)) {
            show = role === 'admin' || role === 'team_admin';
        }
        // user-usage now accessible to all roles (shows personal stats)
        // All roles can see: dashboard, contacts, groups, templates, send, records, content-search
        el.style.display = show ? 'flex' : 'none';
    });
    navigateTo(state.currentPage || 'dashboard');
}

async function logout() {
    await api('/api/auth/logout', { method: 'POST' });
    state.user = null;
    showLogin();
}

function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
}

// ============================================================
// Router
// ============================================================
function navigateTo(page) {
    state.currentPage = page;
    document.querySelectorAll('.nav-item').forEach(function(el) {
        el.classList.toggle('active', el.dataset.page === page);
    });
    document.getElementById('sidebar').classList.remove('open');
    var content = document.getElementById('page-content');
    switch (page) {
        case 'dashboard': renderDashboard(content); break;
        case 'contacts': renderContacts(content); break;
        case 'groups': renderGroups(content); break;
        case 'templates': renderTemplates(content); break;
        case 'send': renderSendSMS(content); break;
        case 'records': renderRecords(content); break;
        case 'content-search': renderContentSearch(content); break;
        case 'users': renderUsers(content); break;
        case 'user-usage': renderUnifiedStats(content); break;
        case 'team-stats': renderTeamStats(content); break;
        case 'config':
            if (state.user.role === 'team_admin') renderTeamConfig(content);
            else renderConfig(content);
            break;
        default: renderDashboard(content);
    }
}

window.addEventListener('hashchange', function() {
    var hash = window.location.hash.replace('#/', '') || 'dashboard';
    navigateTo(hash);
});

// ============================================================
// Dashboard
// ============================================================
async function renderDashboard(container) {
    container.innerHTML = '<div class="text-center text-secondary">Cargando...</div>';
    try {
        var stats = await api('/api/sms/statistics');
        container.innerHTML =
            '<h1 class="mb-4" style="font-size:22px;font-weight:700;">Panel Principal</h1>' +
            '<div class="stats-grid">' +
                '<div class="stat-card"><div class="stat-icon blue"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg></div><div class="stat-label">Enviados Hoy</div><div class="stat-value">' + stats.today_sent + '</div></div>' +
                '<div class="stat-card"><div class="stat-icon green"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg></div><div class="stat-label">Tasa de Exito</div><div class="stat-value">' + stats.success_rate + '%</div></div>' +
                '<div class="stat-card"><div class="stat-icon yellow"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg></div><div class="stat-label">Pendientes</div><div class="stat-value">' + stats.total_pending + '</div></div>' +
                '<div class="stat-card"><div class="stat-icon red"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg></div><div class="stat-label">Fallidos</div><div class="stat-value">' + stats.total_failed + '</div></div>' +
            '</div>' +
            '<div class="stats-grid" style="grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));">' +
                '<div class="stat-card"><div class="stat-label">Total Contactos</div><div class="stat-value" style="font-size:22px;">' + stats.total_contacts + '</div></div>' +
                '<div class="stat-card"><div class="stat-label">Total Plantillas</div><div class="stat-value" style="font-size:22px;">' + stats.total_templates + '</div></div>' +
                '<div class="stat-card"><div class="stat-label">Total Enviados</div><div class="stat-value" style="font-size:22px;">' + stats.total_sent + '</div></div>' +
            '</div>' +
            '<div class="card mt-4"><div class="card-header"><h2>Envios de los Ultimos 7 Dias</h2></div><div class="chart-container"><div class="bar-chart" id="weekly-chart"></div></div></div>';
        var chartEl = document.getElementById('weekly-chart');
        var maxCount = Math.max.apply(null, stats.last_7_days.map(function(d) { return d.count; }).concat([1]));
        chartEl.innerHTML = stats.last_7_days.map(function(d) {
            var height = (d.count / maxCount) * 120;
            var dateLabel = d.date.substring(5);
            return '<div class="bar-wrapper"><div class="bar-value">' + d.count + '</div><div class="bar" style="height:' + Math.max(height, 4) + 'px;"></div><div class="bar-label">' + dateLabel + '</div></div>';
        }).join('');
    } catch (err) {
        container.innerHTML = '<div class="empty-state"><h3>Error</h3><p>' + escapeHtml(err.message) + '</p></div>';
    }
}

// ============================================================
// Contacts
// ============================================================
async function renderContacts(container) {
    container.innerHTML = '<div class="text-center text-secondary">Cargando...</div>';
    try {
        var groups = await api('/api/groups');
        var params = new URLSearchParams({ page: state.contacts.page, per_page: state.contacts.perPage });
        if (state.contacts.search) params.set('search', state.contacts.search);
        if (state.contacts.groupId) params.set('group_id', state.contacts.groupId);
        if (state.contacts.remark) params.set('remark', state.contacts.remark);
        var data = await api('/api/contacts?' + params.toString());
        state.contacts.total = data.total;
        state.contacts.totalPages = data.total_pages;

        var remarkOptions = [
            { value: 'No contactable', label: 'No contactable' },
            { value: 'Promesa de pago', label: 'Promesa de pago' },
            { value: 'Dispuesto a pagar sin fondos', label: 'Dispuesto a pagar sin fondos' },
            { value: 'No dispuesto a pagar', label: 'No dispuesto a pagar' }
        ];
        var remarkSelect = '<select onchange="handleContactRemarkFilter(this.value)"><option value="">Todas las notas</option>' +
            remarkOptions.map(function(r) { return '<option value="' + r.value + '"' + (state.contacts.remark === r.value ? ' selected' : '') + '>' + r.label + '</option>'; }).join('') + '</select>';

        var groupOptions = groups.groups.map(function(g) { return '<option value="' + g.id + '"' + (state.contacts.groupId == g.id ? ' selected' : '') + '>' + escapeHtml(g.name) + '</option>'; }).join('');

        var remarkBadgeMap = {
            'No contactable': 'badge-red',
            'Promesa de pago': 'badge-green',
            'Dispuesto a pagar sin fondos': 'badge-yellow',
            'No dispuesto a pagar': 'badge-orange'
        };

        var rows = data.contacts.length === 0
            ? '<tr><td colspan="6" class="text-center text-secondary" style="padding:32px;">No hay contactos</td></tr>'
            : data.contacts.map(function(c) {
                var remarkBadge = c.remark ? '<span class="badge ' + (remarkBadgeMap[c.remark] || 'badge-blue') + '">' + escapeHtml(c.remark) + '</span>' : '<span class="text-secondary text-sm">-</span>';
                return '<tr><td><strong>' + escapeHtml(c.name) + '</strong></td><td>' + escapeHtml(c.phone) + '</td><td>' + (c.group_name ? '<span class="badge badge-blue">' + escapeHtml(c.group_name) + '</span>' : '<span class="text-secondary text-sm">Sin grupo</span>') + '</td><td>' + remarkBadge + '</td><td class="text-secondary text-sm">' + escapeHtml(c.notes || '-') + '</td><td><button class="btn btn-ghost btn-sm btn-icon" onclick="showEditContactModal(' + c.id + ')" title="Editar"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button><button class="btn btn-ghost btn-sm btn-icon" onclick="deleteContact(' + c.id + ')" title="Eliminar" style="color:var(--danger);"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button></td></tr>';
            }).join('');

        container.innerHTML =
            '<div class="flex-between mb-4"><h1 style="font-size:22px;font-weight:700;">Contactos</h1><div class="flex gap-2"><button class="btn btn-secondary btn-sm" onclick="showImportModal()"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg> Importar CSV</button><button class="btn btn-primary btn-sm" onclick="showAddContactModal()"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg> Nuevo Contacto</button></div></div>' +
            '<div class="card"><div class="card-body" style="padding-bottom:0;"><div class="toolbar"><input type="text" class="search-input" placeholder="Buscar por nombre, telefono..." value="' + escapeHtml(state.contacts.search) + '" onkeyup="handleContactSearch(event)"><select onchange="handleContactGroupFilter(this.value)"><option value="">Todos los grupos</option>' + groupOptions + '</select>' + remarkSelect + '</div></div><div class="table-container"><table><thead><tr><th>Nombre</th><th>Telefono</th><th>Grupo</th><th>Nota</th><th>Observaciones</th><th>Acciones</th></tr></thead><tbody>' + rows + '</tbody></table></div>' + renderPagination(data, 'contacts') + '</div>';
    } catch (err) {
        container.innerHTML = '<div class="empty-state"><h3>Error</h3><p>' + escapeHtml(err.message) + '</p></div>';
    }
}

function handleContactSearch(event) {
    if (event.key === 'Enter') { state.contacts.search = event.target.value; state.contacts.page = 1; renderContacts(document.getElementById('page-content')); }
}

function handleContactGroupFilter(groupId) {
    state.contacts.groupId = groupId; state.contacts.page = 1; renderContacts(document.getElementById('page-content'));
}

function handleContactRemarkFilter(remark) {
    state.contacts.remark = remark; state.contacts.page = 1; renderContacts(document.getElementById('page-content'));
}

function showAddContactModal() {
    api('/api/groups').then(function(data) {
        var opts = data.groups.map(function(g) { return '<option value="' + g.id + '">' + escapeHtml(g.name) + '</option>'; }).join('');
        var remarkOpts = '<option value="">Sin nota</option><option value="No contactable">No contactable</option><option value="Promesa de pago">Promesa de pago</option><option value="Dispuesto a pagar sin fondos">Dispuesto a pagar sin fondos</option><option value="No dispuesto a pagar">No dispuesto a pagar</option>';
        showModal('Nuevo Contacto', '<form id="add-contact-form" onsubmit="handleAddContact(event)"><div class="form-group"><label>Nombre *</label><input type="text" name="name" required></div><div class="form-group"><label>Telefono *</label><input type="text" name="phone" required placeholder="+34 600 000 000"></div><div class="form-group"><label>Grupo</label><select name="group_id"><option value="">Sin grupo</option>' + opts + '</select></div><div class="form-group"><label>Nota</label><select name="remark">' + remarkOpts + '</select></div><div class="form-group"><label>Observaciones</label><textarea name="notes" rows="3"></textarea></div><div class="modal-footer" style="padding:16px 0 0;"><button type="button" class="btn btn-secondary" onclick="hideModal()">Cancelar</button><button type="submit" class="btn btn-primary">Guardar</button></div></form>');
    });
}

async function handleAddContact(event) {
    event.preventDefault();
    var form = event.target;
    try {
        await api('/api/contacts', { method: 'POST', body: { name: form.name.value.trim(), phone: form.phone.value.trim(), group_id: form.group_id.value || null, remark: form.remark.value, notes: form.notes.value.trim() } });
        hideModal(); showToast('Contacto creado exitosamente', 'success'); renderContacts(document.getElementById('page-content'));
    } catch (err) { showToast(err.message, 'error'); }
}

async function showEditContactModal(id) {
    try {
        var contactData = await api('/api/contacts?per_page=1000');
        var groupsData = await api('/api/groups');
        var contact = contactData.contacts.find(function(c) { return c.id === id; });
        if (!contact) return showToast('Contacto no encontrado', 'error');
        var groupOpts = groupsData.groups.map(function(g) { return '<option value="' + g.id + '"' + (contact.group_id == g.id ? ' selected' : '') + '>' + escapeHtml(g.name) + '</option>'; }).join('');
        var remarkOpts = ['No contactable', 'Promesa de pago', 'Dispuesto a pagar sin fondos', 'No dispuesto a pagar'].map(function(r) { return '<option value="' + r + '"' + (contact.remark === r ? ' selected' : '') + '>' + r + '</option>'; }).join('');
        showModal('Editar Contacto', '<form onsubmit="handleEditContact(event, ' + id + ')"><div class="form-group"><label>Nombre *</label><input type="text" name="name" value="' + escapeHtml(contact.name) + '" required></div><div class="form-group"><label>Telefono *</label><input type="text" name="phone" value="' + escapeHtml(contact.phone) + '" required></div><div class="form-group"><label>Grupo</label><select name="group_id"><option value="">Sin grupo</option>' + groupOpts + '</select></div><div class="form-group"><label>Nota</label><select name="remark"><option value="">Sin nota</option>' + remarkOpts + '</select></div><div class="form-group"><label>Observaciones</label><textarea name="notes" rows="3">' + escapeHtml(contact.notes || '') + '</textarea></div><div class="modal-footer" style="padding:16px 0 0;"><button type="button" class="btn btn-secondary" onclick="hideModal()">Cancelar</button><button type="submit" class="btn btn-primary">Actualizar</button></div></form>');
    } catch (err) { showToast(err.message, 'error'); }
}

async function handleEditContact(event, id) {
    event.preventDefault();
    var form = event.target;
    try {
        await api('/api/contacts/' + id, { method: 'PUT', body: { name: form.name.value.trim(), phone: form.phone.value.trim(), group_id: form.group_id.value || null, remark: form.remark.value, notes: form.notes.value.trim() } });
        hideModal(); showToast('Contacto actualizado', 'success'); renderContacts(document.getElementById('page-content'));
    } catch (err) { showToast(err.message, 'error'); }
}

async function deleteContact(id) {
    if (!confirm('Esta seguro de eliminar este contacto?')) return;
    try { await api('/api/contacts/' + id, { method: 'DELETE' }); showToast('Contacto eliminado', 'success'); renderContacts(document.getElementById('page-content')); }
    catch (err) { showToast(err.message, 'error'); }
}

function showImportModal() {
    api('/api/groups').then(function(data) {
        var opts = data.groups.map(function(g) { return '<option value="' + g.id + '">' + escapeHtml(g.name) + '</option>'; }).join('');
        showModal('Importar Contactos (CSV)', '<p class="text-secondary mb-4" style="font-size:13px;">El archivo CSV debe tener las columnas: <strong>name, phone, notes, remark</strong> (o <strong>nombre, telefono, notas, nota</strong>).</p><p class="text-secondary mb-4" style="font-size:12px;">Valores de <strong>remark</strong>: No contactable | Promesa de pago | Dispuesto a pagar sin fondos | No dispuesto a pagar</p><form id="import-form" onsubmit="handleImport(event)"><div class="form-group"><label>Grupo destino (opcional)</label><select name="group_id"><option value="">Sin grupo</option>' + opts + '</select></div><div class="form-group"><label>Archivo CSV</label><input type="file" name="file" accept=".csv" required style="padding:8px;"></div><div class="modal-footer" style="padding:16px 0 0;"><button type="button" class="btn btn-secondary" onclick="hideModal()">Cancelar</button><button type="submit" class="btn btn-primary">Importar</button></div></form>');
    });
}

async function handleImport(event) {
    event.preventDefault();
    var form = event.target;
    var formData = new FormData();
    formData.append('file', form.file.files[0]);
    formData.append('group_id', form.group_id.value || '');
    try {
        var data = await api('/api/contacts/import', { method: 'POST', body: formData });
        hideModal();
        var msg = data.imported + ' contacto(s) importado(s)';
        if (data.errors && data.errors.length) msg += '. ' + data.errors.length + ' error(es)';
        showToast(msg, 'success'); renderContacts(document.getElementById('page-content'));
    } catch (err) { showToast(err.message, 'error'); }
}

// ============================================================
// Groups
// ============================================================
async function renderGroups(container) {
    container.innerHTML = '<div class="text-center text-secondary">Cargando...</div>';
    try {
        var data = await api('/api/groups');
        var rows = data.groups.length === 0
            ? '<tr><td colspan="4" class="text-center text-secondary" style="padding:32px;">No hay grupos</td></tr>'
            : data.groups.map(function(g) {
                return '<tr><td><strong>' + escapeHtml(g.name) + '</strong></td><td class="text-secondary">' + escapeHtml(g.description || '-') + '</td><td><span class="badge badge-blue">' + g.contact_count + '</span></td><td><button class="btn btn-ghost btn-sm btn-icon" onclick="showEditGroupModal(' + g.id + ', \'' + escapeHtml(g.name).replace(/'/g, "\\'") + '\', \'' + escapeHtml(g.description || '').replace(/'/g, "\\'") + '\')" title="Editar"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button><button class="btn btn-ghost btn-sm btn-icon" onclick="deleteGroup(' + g.id + ')" title="Eliminar" style="color:var(--danger);"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button></td></tr>';
            }).join('');
        container.innerHTML = '<div class="flex-between mb-4"><h1 style="font-size:22px;font-weight:700;">Grupos de Contactos</h1><button class="btn btn-primary btn-sm" onclick="showAddGroupModal()"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg> Nuevo Grupo</button></div><div class="card"><div class="table-container"><table><thead><tr><th>Nombre</th><th>Descripcion</th><th>Contactos</th><th>Acciones</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
    } catch (err) { container.innerHTML = '<div class="empty-state"><h3>Error</h3><p>' + escapeHtml(err.message) + '</p></div>'; }
}

function showAddGroupModal() {
    showModal('Nuevo Grupo', '<form onsubmit="handleAddGroup(event)"><div class="form-group"><label>Nombre *</label><input type="text" name="name" required></div><div class="form-group"><label>Descripcion</label><textarea name="description" rows="3"></textarea></div><div class="modal-footer" style="padding:16px 0 0;"><button type="button" class="btn btn-secondary" onclick="hideModal()">Cancelar</button><button type="submit" class="btn btn-primary">Crear</button></div></form>');
}

async function handleAddGroup(event) {
    event.preventDefault(); var form = event.target;
    try { await api('/api/groups', { method: 'POST', body: { name: form.name.value.trim(), description: form.description.value.trim() } }); hideModal(); showToast('Grupo creado', 'success'); renderGroups(document.getElementById('page-content')); }
    catch (err) { showToast(err.message, 'error'); }
}

function showEditGroupModal(id, name, description) {
    showModal('Editar Grupo', '<form onsubmit="handleEditGroup(event, ' + id + ')"><div class="form-group"><label>Nombre *</label><input type="text" name="name" value="' + escapeHtml(name) + '" required></div><div class="form-group"><label>Descripcion</label><textarea name="description" rows="3">' + escapeHtml(description) + '</textarea></div><div class="modal-footer" style="padding:16px 0 0;"><button type="button" class="btn btn-secondary" onclick="hideModal()">Cancelar</button><button type="submit" class="btn btn-primary">Actualizar</button></div></form>');
}

async function handleEditGroup(event, id) {
    event.preventDefault(); var form = event.target;
    try { await api('/api/groups/' + id, { method: 'PUT', body: { name: form.name.value.trim(), description: form.description.value.trim() } }); hideModal(); showToast('Grupo actualizado', 'success'); renderGroups(document.getElementById('page-content')); }
    catch (err) { showToast(err.message, 'error'); }
}

async function deleteGroup(id) {
    if (!confirm('Esta seguro de eliminar este grupo? Los contactos no se eliminaran.')) return;
    try { await api('/api/groups/' + id, { method: 'DELETE' }); showToast('Grupo eliminado', 'success'); renderGroups(document.getElementById('page-content')); }
    catch (err) { showToast(err.message, 'error'); }
}

// ============================================================
// Templates
// ============================================================
async function renderTemplates(container) {
    container.innerHTML = '<div class="text-center text-secondary">Cargando...</div>';
    try {
        var data = await api('/api/templates');
        var rows = data.templates.length === 0
            ? '<tr><td colspan="5" class="text-center text-secondary" style="padding:32px;">No hay plantillas</td></tr>'
            : data.templates.map(function(t) {
                var safeContent = escapeHtml(t.content).replace(/'/g, '&#39;').replace(/"/g, '&quot;');
                return '<tr><td><strong>' + escapeHtml(t.name) + '</strong></td><td><span class="badge badge-gray">' + escapeHtml(t.category) + '</span></td><td class="text-secondary text-sm" style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(t.content) + '</td><td class="text-secondary text-sm">' + formatDate(t.updated_at) + '</td><td><button class="btn btn-ghost btn-sm btn-icon" onclick="showEditTemplateModal(' + t.id + ')" title="Editar"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button><button class="btn btn-ghost btn-sm btn-icon" onclick="deleteTemplate(' + t.id + ')" title="Eliminar" style="color:var(--danger);"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button></td></tr>';
            }).join('');
        container.innerHTML = '<div class="flex-between mb-4"><h1 style="font-size:22px;font-weight:700;">Plantillas de SMS</h1><button class="btn btn-primary btn-sm" onclick="showAddTemplateModal()"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg> Nueva Plantilla</button></div><div class="card"><div class="card-body" style="padding-bottom:0;"><div class="toolbar"><input type="text" class="search-input" placeholder="Buscar plantillas..." id="template-search" onkeyup="handleTemplateSearch(event)"></div></div><div class="table-container"><table><thead><tr><th>Nombre</th><th>Categoria</th><th>Contenido</th><th>Actualizado</th><th>Acciones</th></tr></thead><tbody>' + rows + '</tbody></table></div></div><div class="mt-4 text-secondary text-sm"><strong>Variables disponibles:</strong> <code>{nombre}</code> - Nombre del contacto, <code>{telefono}</code> - Numero de telefono</div>';
        // Store templates for edit
        window._templates = data.templates;
    } catch (err) { container.innerHTML = '<div class="empty-state"><h3>Error</h3><p>' + escapeHtml(err.message) + '</p></div>'; }
}

function handleTemplateSearch(event) {
    if (event.key === 'Enter') {
        var search = event.target.value;
        api('/api/templates?search=' + encodeURIComponent(search)).then(function(data) {
            window._templates = data.templates;
            // Re-render templates page
            renderTemplates(document.getElementById('page-content'));
        });
    }
}

function showAddTemplateModal() {
    showModal('Nueva Plantilla', '<form onsubmit="handleAddTemplate(event)"><div class="form-group"><label>Nombre *</label><input type="text" name="name" required placeholder="Ej: Promocion de verano"></div><div class="form-group"><label>Categoria</label><select name="category"><option value="general">General</option><option value="promocion">Promocion</option><option value="recordatorio">Recordatorio</option><option value="bienvenida">Bienvenida</option><option value="otro">Otro</option></select></div><div class="form-group"><label>Contenido *</label><textarea name="content" rows="4" required placeholder="Hola {nombre}, te informamos que..."></textarea><small class="text-secondary">Use {nombre} y {telefono} como variables</small></div><div class="modal-footer" style="padding:16px 0 0;"><button type="button" class="btn btn-secondary" onclick="hideModal()">Cancelar</button><button type="submit" class="btn btn-primary">Crear</button></div></form>');
}

async function handleAddTemplate(event) {
    event.preventDefault(); var form = event.target;
    try { await api('/api/templates', { method: 'POST', body: { name: form.name.value.trim(), content: form.content.value.trim(), category: form.category.value } }); hideModal(); showToast('Plantilla creada', 'success'); renderTemplates(document.getElementById('page-content')); }
    catch (err) { showToast(err.message, 'error'); }
}

function showEditTemplateModal(id) {
    var t = (window._templates || []).find(function(tpl) { return tpl.id === id; });
    if (!t) return;
    showModal('Editar Plantilla', '<form onsubmit="handleEditTemplate(event, ' + id + ')"><div class="form-group"><label>Nombre *</label><input type="text" name="name" value="' + escapeHtml(t.name) + '" required></div><div class="form-group"><label>Categoria</label><select name="category"><option value="general"' + (t.category==='general'?' selected':'') + '>General</option><option value="promocion"' + (t.category==='promocion'?' selected':'') + '>Promocion</option><option value="recordatorio"' + (t.category==='recordatorio'?' selected':'') + '>Recordatorio</option><option value="bienvenida"' + (t.category==='bienvenida'?' selected':'') + '>Bienvenida</option><option value="otro"' + (t.category==='otro'?' selected':'') + '>Otro</option></select></div><div class="form-group"><label>Contenido *</label><textarea name="content" rows="4" required>' + escapeHtml(t.content) + '</textarea><small class="text-secondary">Use {nombre} y {telefono} como variables</small></div><div class="modal-footer" style="padding:16px 0 0;"><button type="button" class="btn btn-secondary" onclick="hideModal()">Cancelar</button><button type="submit" class="btn btn-primary">Actualizar</button></div></form>');
}

async function handleEditTemplate(event, id) {
    event.preventDefault(); var form = event.target;
    try { await api('/api/templates/' + id, { method: 'PUT', body: { name: form.name.value.trim(), content: form.content.value.trim(), category: form.category.value } }); hideModal(); showToast('Plantilla actualizada', 'success'); renderTemplates(document.getElementById('page-content')); }
    catch (err) { showToast(err.message, 'error'); }
}

async function deleteTemplate(id) {
    if (!confirm('Esta seguro de eliminar esta plantilla?')) return;
    try { await api('/api/templates/' + id, { method: 'DELETE' }); showToast('Plantilla eliminada', 'success'); renderTemplates(document.getElementById('page-content')); }
    catch (err) { showToast(err.message, 'error'); }
}

// ============================================================
// Send SMS
// ============================================================
async function renderSendSMS(container) {
    state.sendPhones = [];
    state.sendMode = 'manual';
    try {
        var results = await Promise.all([api('/api/groups'), api('/api/templates')]);
        var groupsData = results[0];
        var templatesData = results[1];
        var groupOpts = groupsData.groups.map(function(g) { return '<option value="' + g.id + '">' + escapeHtml(g.name) + ' (' + g.contact_count + ' contactos)</option>'; }).join('');
        var templateOpts = templatesData.templates.map(function(t) { return '<option value="' + t.id + '">' + escapeHtml(t.name) + '</option>'; }).join('');
        window._sendTemplates = templatesData.templates;

        container.innerHTML =
            '<h1 class="mb-4" style="font-size:22px;font-weight:700;">Enviar SMS</h1>' +
            '<div class="card"><div class="card-body">' +
                '<div class="send-options"><button class="tab active" onclick="switchSendMode(\'manual\', this)">Manual</button><button class="tab" onclick="switchSendMode(\'contacts\', this)">Seleccionar Contactos</button><button class="tab" onclick="switchSendMode(\'group\', this)">Por Grupo</button></div>' +
                '<div id="send-manual" class="form-group"><label>Numeros de telefono</label><div class="phone-tags" id="phone-tags" onclick="document.getElementById(\'phone-input\').focus()"><input type="text" id="phone-input" placeholder="Escriba un numero y presione Enter" style="border:none;outline:none;flex:1;min-width:200px;padding:4px;" onkeydown="handlePhoneInput(event)"></div><small class="text-secondary">Presione Enter o coma para agregar numeros</small></div>' +
                '<div id="send-contacts" class="form-group" style="display:none;"><label>Seleccionar contactos</label><div id="contacts-select-list" class="contact-select-list"></div></div>' +
                '<div id="send-group" class="form-group" style="display:none;"><label>Seleccionar grupo</label><select id="send-group-select" onchange="loadGroupContacts(this.value)"><option value="">-- Seleccione un grupo --</option>' + groupOpts + '</select><div id="group-contacts-preview" class="mt-2"></div></div>' +
                '<div class="form-group mt-4"><label>Plantilla (opcional)</label><select id="send-template" onchange="loadTemplateContent(this.value)"><option value="">-- Escribir mensaje personalizado --</option>' + templateOpts + '</select></div>' +
                '<div class="form-group"><label>Mensaje *</label><textarea id="send-content" rows="4" placeholder="Escriba su mensaje aqui..." oninput="updatePreview()"></textarea><small class="text-secondary">Variables: {nombre}, {telefono}</small></div>' +
                '<div class="preview-box" id="send-preview" style="display:none;"><div class="preview-label">Vista previa</div><div class="preview-content" id="preview-text"></div></div>' +
                '<div class="form-group"><label><input type="checkbox" id="send-schedule-check" onchange="toggleSchedule()"> Programar envio</label><div id="schedule-datetime" style="display:none;margin-top:8px;"><input type="datetime-local" id="send-scheduled-at"></div></div>' +
                '<div class="flex gap-2 mt-4"><button class="btn btn-primary" onclick="handleSendSMS()"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg> Enviar SMS</button><button class="btn btn-secondary" onclick="showSendPreviewModal()">Vista Previa</button></div>' +
            '</div></div>';
        loadContactsForSelection();
    } catch (err) { container.innerHTML = '<div class="empty-state"><h3>Error</h3><p>' + escapeHtml(err.message) + '</p></div>'; }
}

function switchSendMode(mode, btn) {
    state.sendMode = mode;
    document.querySelectorAll('.send-options .tab').forEach(function(t) { t.classList.remove('active'); });
    btn.classList.add('active');
    document.getElementById('send-manual').style.display = mode === 'manual' ? 'block' : 'none';
    document.getElementById('send-contacts').style.display = mode === 'contacts' ? 'block' : 'none';
    document.getElementById('send-group').style.display = mode === 'group' ? 'block' : 'none';
}

function handlePhoneInput(event) {
    if (event.key === 'Enter' || event.key === ',') {
        event.preventDefault();
        var input = document.getElementById('phone-input');
        var phone = input.value.replace(',', '').trim();
        if (phone && state.sendPhones.indexOf(phone) === -1) { state.sendPhones.push(phone); renderPhoneTags(); }
        input.value = '';
    }
}

function renderPhoneTags() {
    var container = document.getElementById('phone-tags');
    var input = document.getElementById('phone-input');
    container.querySelectorAll('.phone-tag').forEach(function(t) { t.remove(); });
    state.sendPhones.forEach(function(phone, i) {
        var tag = document.createElement('span');
        tag.className = 'phone-tag';
        tag.innerHTML = escapeHtml(phone) + ' <button onclick="removePhone(' + i + ')">&times;</button>';
        container.insertBefore(tag, input);
    });
}

function removePhone(index) { state.sendPhones.splice(index, 1); renderPhoneTags(); }

async function loadContactsForSelection() {
    try {
        var data = await api('/api/contacts?per_page=1000');
        var list = document.getElementById('contacts-select-list');
        if (list) {
            list.innerHTML = data.contacts.length === 0
                ? '<div class="text-center text-secondary" style="padding:20px;">No hay contactos</div>'
                : data.contacts.map(function(c) { return '<label class="contact-select-item"><input type="checkbox" value="' + escapeHtml(c.phone) + '" data-name="' + escapeHtml(c.name) + '" onchange="updateSelectedContacts()"><span><strong>' + escapeHtml(c.name) + '</strong> - ' + escapeHtml(c.phone) + '</span></label>'; }).join('');
        }
    } catch (e) {}
}

function updateSelectedContacts() {
    var checkboxes = document.querySelectorAll('#contacts-select-list input[type="checkbox"]:checked');
    state.sendPhones = Array.from(checkboxes).map(function(cb) { return cb.value; });
}

async function loadGroupContacts(groupId) {
    var preview = document.getElementById('group-contacts-preview');
    if (!groupId) { preview.innerHTML = ''; state.sendPhones = []; return; }
    try {
        var data = await api('/api/contacts?group_id=' + groupId + '&per_page=1000');
        state.sendPhones = data.contacts.map(function(c) { return c.phone; });
        preview.innerHTML = '<span class="badge badge-blue">' + data.contacts.length + ' contactos seleccionados</span>';
    } catch (err) { preview.innerHTML = '<span class="text-secondary">' + err.message + '</span>'; }
}

function loadTemplateContent(templateId) {
    var select = document.getElementById('send-template');
    var t = (window._sendTemplates || []).find(function(tpl) { return tpl.id == templateId; });
    if (t) { document.getElementById('send-content').value = t.content; updatePreview(); }
}

function updatePreview() {
    var content = document.getElementById('send-content').value;
    var preview = document.getElementById('send-preview');
    var previewText = document.getElementById('preview-text');
    if (content) {
        preview.style.display = 'block';
        previewText.textContent = content.replace(/{nombre}/g, 'Juan').replace(/{telefono}/g, '+34 600 000 000');
        // Check charset and billing info
        checkCharsetInfo(content);
    } else { preview.style.display = 'none'; }
}

async function checkCharsetInfo(content) {
    try {
        var data = await api('/api/sms/check-charset', { method: 'POST', body: { content: content } });
        var infoEl = document.getElementById('charset-info');
        if (!infoEl) {
            infoEl = document.createElement('div');
            infoEl.id = 'charset-info';
            infoEl.style.cssText = 'font-size:12px;color:#64748B;margin-top:4px;padding:6px 10px;background:#F8FAFC;border-radius:6px;';
            var textarea = document.getElementById('send-content');
            if (textarea && textarea.parentNode) {
                textarea.parentNode.insertBefore(infoEl, textarea.nextSibling);
            }
        }
        var charCount = data.char_count || content.length;
        var parts = data.parts || 1;
        var single = data.single || 70;
        var charset = data.charset || 'UCS2';
        infoEl.innerHTML = 'Codificacion: <strong>' + charset + '</strong> | Caracteres: ' + charCount + '/' + single + ' | Partes: <strong>' + parts + '</strong> SMS' + (data.api_configured ? '' : ' (estimacion local)');
    } catch (e) {}
}

function toggleSchedule() {
    document.getElementById('schedule-datetime').style.display = document.getElementById('send-schedule-check').checked ? 'block' : 'none';
}

function showSendPreviewModal() {
    var content = document.getElementById('send-content').value;
    var phones = getSendPhones();
    if (!content) return showToast('Escriba un mensaje', 'error');
    if (phones.length === 0) return showToast('Seleccione al menos un destinatario', 'error');
    var scheduled = document.getElementById('send-schedule-check').checked;
    var scheduledAt = document.getElementById('send-scheduled-at').value;
    var sample = content.replace(/{nombre}/g, 'Juan').replace(/{telefono}/g, phones[0] || '');
    showModal('Vista Previa del Envio', '<div class="preview-box"><div class="preview-label">Mensaje (' + phones.length + ' destinatario(s))</div><div class="preview-content">' + escapeHtml(sample) + '</div></div>' + (scheduled ? '<p class="mt-2 text-secondary"><strong>Programado para:</strong> ' + new Date(scheduledAt).toLocaleString('es-ES') + '</p>' : '<p class="mt-2 text-secondary"><strong>Envio:</strong> Inmediato</p>') + '<div class="modal-footer" style="padding:16px 0 0;"><button class="btn btn-secondary" onclick="hideModal()">Cerrar</button></div>');
}

function getSendPhones() {
    if (state.sendMode === 'manual') return state.sendPhones;
    if (state.sendMode === 'contacts') {
        return Array.from(document.querySelectorAll('#contacts-select-list input[type="checkbox"]:checked')).map(function(cb) { return cb.value; });
    }
    return state.sendPhones;
}

async function handleSendSMS() {
    var content = document.getElementById('send-content').value.trim();
    var phones = getSendPhones();
    if (!content) return showToast('Escriba un mensaje', 'error');
    if (phones.length === 0) return showToast('Seleccione al menos un destinatario', 'error');
    var contactNames = {};
    document.querySelectorAll('#contacts-select-list input[type="checkbox"]:checked').forEach(function(cb) { contactNames[cb.value] = cb.dataset.name || ''; });
    var scheduled = document.getElementById('send-schedule-check').checked;
    var scheduledAt = document.getElementById('send-scheduled-at').value;
    if (scheduled && !scheduledAt) return showToast('Seleccione fecha y hora de envio', 'error');
    try {
        if (scheduled) {
            var data = await api('/api/sms/schedule', { method: 'POST', body: { phones: phones, content: content, scheduled_at: scheduledAt, contact_names: contactNames } });
            showToast(data.message, 'success');
        } else {
            var data = await api('/api/sms/send', { method: 'POST', body: { phones: phones, content: content, contact_names: contactNames } });
            var sentCount = (data.records || []).filter(function(r) { return r.status === 'sent'; }).length;
            var failCount = (data.records || []).filter(function(r) { return r.status === 'failed'; }).length;
            if (failCount > 0 && sentCount > 0) {
                showToast(data.message + (data.errors && data.errors.length > 0 ? ' | ' + data.errors.slice(0, 3).join('; ') : ''), 'warning');
            } else if (failCount > 0 && sentCount === 0) {
                showToast(data.message + (data.errors && data.errors.length > 0 ? ' | ' + data.errors.slice(0, 3).join('; ') : ''), 'error');
            } else {
                showToast(data.message, 'success');
            }
        }
        state.sendPhones = [];
        document.getElementById('send-content').value = '';
        document.getElementById('send-template').value = '';
        document.getElementById('send-preview').style.display = 'none';
        var charsetInfo = document.getElementById('charset-info');
        if (charsetInfo) charsetInfo.remove();
        renderPhoneTags();
    } catch (err) { showToast(err.message, 'error'); }
}

// ============================================================
// Records
// ============================================================
async function renderRecords(container) {
    container.innerHTML = '<div class="text-center text-secondary">Cargando...</div>';
    try {
        var params = new URLSearchParams({ page: state.records.page, per_page: state.records.perPage });
        if (state.records.status) params.set('status', state.records.status);
        if (state.records.dateFrom) params.set('date_from', state.records.dateFrom);
        if (state.records.dateTo) params.set('date_to', state.records.dateTo);
        if (state.records.search) params.set('search', state.records.search);
        var data = await api('/api/sms/records?' + params.toString());
        state.records.total = data.total;
        state.records.totalPages = data.total_pages;

        var rows = data.records.length === 0
            ? '<tr><td colspan="6" class="text-center text-secondary" style="padding:32px;">No hay registros</td></tr>'
            : data.records.map(function(r) {
                var apiInfo = '';
                if (r.msgid) apiInfo += '<span class="text-secondary" style="font-size:11px;">ID: ' + escapeHtml(r.msgid) + '</span>';
                if (r.api_msg) apiInfo += '<br><span class="text-secondary" style="font-size:11px;">' + escapeHtml(r.api_msg) + '</span>';
                return '<tr><td class="text-sm text-secondary">' + formatDate(r.created_at) + '</td><td>' + escapeHtml(r.phone) + '</td><td>' + escapeHtml(r.contact_name || '-') + '</td><td class="text-sm" style="max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + escapeHtml(r.content) + '">' + escapeHtml(r.content) + '</td><td>' + getStatusBadge(r.status) + '</td><td class="text-sm">' + (apiInfo || '<span class="text-secondary">-</span>') + '</td></tr>';
            }).join('');

        container.innerHTML =
            '<h1 class="mb-4" style="font-size:22px;font-weight:700;">Registros de Envio</h1>' +
            '<div class="card"><div class="card-body" style="padding-bottom:0;"><div class="toolbar"><div style="display:flex;gap:8px;flex:1;"><input type="text" class="search-input" placeholder="Buscar por numero, nombre o contenido..." value="' + escapeHtml(state.records.search) + '" onkeyup="handleRecordSearch(event)" style="flex:1;"><button onclick="triggerRecordSearch()" style="padding:8px 16px;background:#2563EB;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:14px;">Buscar</button></div><select onchange="handleRecordStatusFilter(this.value)"><option value="">Todos los estados</option><option value="sent"' + (state.records.status==='sent'?' selected':'') + '>Enviado</option><option value="failed"' + (state.records.status==='failed'?' selected':'') + '>Fallido</option><option value="pending"' + (state.records.status==='pending'?' selected':'') + '>Pendiente</option><option value="scheduled"' + (state.records.status==='scheduled'?' selected':'') + '>Programado</option></select><input type="date" lang="es" value="' + state.records.dateFrom + '" onchange="handleRecordDateFrom(this.value)" title="Fecha desde"><input type="date" lang="es" value="' + state.records.dateTo + '" onchange="handleRecordDateTo(this.value)" title="Fecha hasta"></div></div><div class="table-container"><table><thead><tr><th>Fecha</th><th>Telefono</th><th>Nombre</th><th>Contenido</th><th>Estado</th><th>Detalles API</th></tr></thead><tbody>' + rows + '</tbody></table></div>' + renderPagination(data, 'records') + '</div>';
    } catch (err) { container.innerHTML = '<div class="empty-state"><h3>Error</h3><p>' + escapeHtml(err.message) + '</p></div>'; }
}

function handleRecordSearch(event) {
    if (event.key === 'Enter' || event.type === 'blur') {
        state.records.search = event.target.value;
        state.records.page = 1;
        renderRecords(document.getElementById('page-content'));
    }
}

function triggerRecordSearch() {
    var input = document.querySelector('.search-input');
    if (input) {
        state.records.search = input.value;
        state.records.page = 1;
        renderRecords(document.getElementById('page-content'));
    }
}
function handleRecordStatusFilter(status) { state.records.status = status; state.records.page = 1; renderRecords(document.getElementById('page-content')); }
function handleRecordDateFrom(date) { state.records.dateFrom = date; state.records.page = 1; renderRecords(document.getElementById('page-content')); }
function handleRecordDateTo(date) { state.records.dateTo = date; state.records.page = 1; renderRecords(document.getElementById('page-content')); }

// ============================================================
// Content Search
// ============================================================
if (!state.contentSearch) state.contentSearch = { keyword: '', dateFrom: '', dateTo: '', page: 1, perPage: 20, total: 0, totalPages: 0 };

async function renderContentSearch(container) {
    container.innerHTML = '<div class="text-center text-secondary">Cargando...</div>';
    try {
        var params = new URLSearchParams({ page: state.contentSearch.page, per_page: state.contentSearch.perPage });
        if (state.contentSearch.keyword) params.set('search', state.contentSearch.keyword);
        if (state.contentSearch.dateFrom) params.set('date_from', state.contentSearch.dateFrom);
        if (state.contentSearch.dateTo) params.set('date_to', state.contentSearch.dateTo);
        var data = await api('/api/sms/records?' + params.toString());
        state.contentSearch.total = data.total;
        state.contentSearch.totalPages = data.total_pages;

        var rows = data.records.length === 0
            ? '<tr><td colspan="6" class="text-center text-secondary" style="padding:32px;">No se encontraron mensajes con ese contenido</td></tr>'
            : data.records.map(function(r) {
                var highlightContent = state.contentSearch.keyword ? highlightText(r.content, state.contentSearch.keyword) : escapeHtml(r.content);
                return '<tr><td class="text-sm text-secondary">' + formatDate(r.created_at) + '</td><td>' + escapeHtml(r.phone) + '</td><td>' + escapeHtml(r.contact_name || '-') + '</td><td class="text-sm" style="max-width:300px;">' + highlightContent + '</td><td>' + getStatusBadge(r.status) + '</td><td class="text-sm">' + (r.api_msg ? '<span class="text-secondary" style="font-size:11px;">' + escapeHtml(r.api_msg) + '</span>' : '<span class="text-secondary">-</span>') + '</td></tr>';
            }).join('');

        container.innerHTML =
            '<h1 class="mb-4" style="font-size:22px;font-weight:700;">Buscar por Contenido</h1>' +
            '<div class="card"><div class="card-body" style="padding-bottom:0;"><div class="toolbar"><input type="text" class="search-input" placeholder="Ingrese palabra clave del mensaje..." value="' + escapeHtml(state.contentSearch.keyword) + '" onkeyup="handleContentSearch(event)" style="flex:2;"><input type="date" lang="es" value="' + state.contentSearch.dateFrom + '" onchange="handleContentDateFrom(this.value)" title="Fecha desde"><input type="date" lang="es" value="' + state.contentSearch.dateTo + '" onchange="handleContentDateTo(this.value)" title="Fecha hasta"><button class="btn btn-secondary btn-sm" onclick="clearContentSearch()">Limpiar</button></div></div><div class="table-container"><table><thead><tr><th>Fecha</th><th>Telefono</th><th>Nombre</th><th>Contenido</th><th>Estado</th><th>Detalles</th></tr></thead><tbody>' + rows + '</tbody></table></div>' + renderPagination(data, 'contentSearch') + '</div>';
    } catch (err) { container.innerHTML = '<div class="empty-state"><h3>Error</h3><p>' + escapeHtml(err.message) + '</p></div>'; }
}

function handleContentSearch(event) { if (event.key === 'Enter') { state.contentSearch.keyword = event.target.value; state.contentSearch.page = 1; renderContentSearch(document.getElementById('page-content')); } }
function handleContentDateFrom(date) { state.contentSearch.dateFrom = date; state.contentSearch.page = 1; renderContentSearch(document.getElementById('page-content')); }
function handleContentDateTo(date) { state.contentSearch.dateTo = date; state.contentSearch.page = 1; renderContentSearch(document.getElementById('page-content')); }
function clearContentSearch() { state.contentSearch = { keyword: '', dateFrom: '', dateTo: '', page: 1, perPage: 20, total: 0, totalPages: 0 }; renderContentSearch(document.getElementById('page-content')); }

function highlightText(text, keyword) {
    if (!keyword) return escapeHtml(text);
    var escaped = escapeHtml(text);
    var regex = new RegExp('(' + keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
    return escaped.replace(regex, '<mark style="background:#FEF08A;padding:1px 2px;border-radius:2px;">$1</mark>');
}

// ============================================================
// Users (Admin + Team Admin)
// ============================================================
var ROLE_LABELS = { admin: 'Administrador del Sistema', team_admin: 'Administrador de Equipo', team_member: 'Miembro de Equipo' };
var ROLE_BADGE = { admin: 'badge-blue', team_admin: 'badge-green', team_member: 'badge-gray' };

async function renderUsers(container) {
    if (!['admin', 'team_admin'].includes(state.user.role)) { container.innerHTML = '<div class="empty-state"><h3>Acceso denegado</h3><p>Solo administradores pueden ver esta seccion.</p></div>'; return; }
    container.innerHTML = '<div class="text-center text-secondary">Cargando...</div>';
    try {
        var myRole = state.user.role;
        var title = myRole === 'admin' ? 'Gestion de Usuarios' : 'Mi Equipo';
        var desc = myRole === 'admin' ? 'Administradores de equipo y miembros' : 'Crear y gestionar miembros de tu equipo';

        // Build filter params
        var params = new URLSearchParams();
        var searchVal = document.getElementById('user-search') ? document.getElementById('user-search').value.trim() : '';
        var roleFilterVal = document.getElementById('user-role-filter') ? document.getElementById('user-role-filter').value : '';
        if (searchVal) params.set('search', searchVal);
        if (roleFilterVal) params.set('role', roleFilterVal);
        var qs = params.toString();

        var data = await api('/api/users' + (qs ? '?' + qs : ''));
        var rows = data.users.map(function(u) {
            var canEdit = false;
            if (myRole === 'admin') canEdit = u.id !== state.user.id;
            else if (myRole === 'team_admin') canEdit = u.role === 'team_member' && u.team_creator_id === state.user.id;
            var editBtn = canEdit ? '<button class="btn btn-ghost btn-sm btn-icon" onclick="showEditUserModal(' + u.id + ')" title="Editar"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button>' : '';
            var deleteBtn = canEdit ? '<button class="btn btn-ghost btn-sm btn-icon" onclick="deleteUser(' + u.id + ')" title="Eliminar" style="color:var(--danger);"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>' : '';
            var teamCell = u.team_affiliation ? '<span class="text-sm">' + escapeHtml(u.team_affiliation) + '</span>' : '<span class="text-sm text-secondary">-</span>';
            return '<tr><td><strong>' + escapeHtml(u.username) + '</strong></td><td>' + escapeHtml(u.full_name || '-') + '</td><td><span class="badge ' + (ROLE_BADGE[u.role]||'badge-gray') + '">' + escapeHtml(ROLE_LABELS[u.role]||u.role) + '</span></td><td>' + teamCell + '</td><td><span class="badge ' + (u.is_active ? 'badge-green' : 'badge-red') + '">' + (u.is_active ? 'Activo' : 'Desactivado') + '</span></td><td class="text-sm text-secondary">' + formatDate(u.created_at) + '</td><td style="white-space:nowrap;">' + editBtn + deleteBtn + '</td></tr>';
        }).join('');

        // Role filter options based on current user role
        var roleOptions = '<option value="">Todos los roles</option>';
        if (myRole === 'admin') {
            roleOptions += '<option value="admin">Administrador del Sistema</option><option value="team_admin">Administrador de Equipo</option><option value="team_member">Miembro de Equipo</option>';
        } else {
            roleOptions += '<option value="team_member">Miembro de Equipo</option>';
        }

        container.innerHTML = '<div class="flex-between mb-4"><div><h1 style="font-size:22px;font-weight:700;">' + title + '</h1><p class="text-secondary" style="margin-top:4px;">' + desc + '</p></div><button class="btn btn-primary btn-sm" onclick="showAddUserModal()"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg> Nuevo</button></div><div class="card mb-3"><div style="display:flex;gap:12px;align-items:center;padding:12px 16px;flex-wrap:wrap;"><div style="flex:1;min-width:200px;position:relative;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--text-secondary);"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg><input type="text" id="user-search" class="form-control" placeholder="Buscar por usuario o nombre..." value="' + escapeHtml(searchVal) + '" style="padding-left:36px;" oninput="debounceRenderUsers()"></div><select id="user-role-filter" class="form-control" style="width:auto;min-width:180px;" onchange="renderUsers(document.getElementById(\'page-content\'))">' + roleOptions + '</select></div></div><div class="card"><div class="table-container"><table><thead><tr><th>Usuario</th><th>Nombre Completo</th><th>Rol</th><th>Equipo</th><th>Estado</th><th>Creado</th><th>Acciones</th></tr></thead><tbody>' + (rows || '<tr><td colspan="7" class="empty-state">Sin usuarios</td></tr>') + '</tbody></table></div></div>';
        window._users = data.users;
        // Restore role filter selection
        if (roleFilterVal) { var sel = document.getElementById('user-role-filter'); if (sel) sel.value = roleFilterVal; }
    } catch (err) { container.innerHTML = '<div class="empty-state"><h3>Error</h3><p>' + escapeHtml(err.message) + '</p></div>'; }
}

var _userSearchTimer = null;
function debounceRenderUsers() {
    clearTimeout(_userSearchTimer);
    _userSearchTimer = setTimeout(function() { renderUsers(document.getElementById('page-content')); }, 300);
}

function showAddUserModal() {
    var myRole = state.user.role;
    var roleOptions = '';
    if (myRole === 'admin') {
        roleOptions = '<option value="team_admin">Administrador de Equipo</option>';
    } else if (myRole === 'team_admin') {
        roleOptions = '<option value="team_member">Miembro de Equipo</option>';
    }
    var infoText = myRole === 'admin'
        ? 'Se creara un Administrador de Equipo que podra gestionar sus propios miembros.'
        : 'Se creara un Miembro de Equipo bajo tu gestion.';
    showModal('Nuevo Usuario', '<form onsubmit="handleAddUser(event)"><div class="form-group"><label>Nombre de usuario *</label><input type="text" name="username" required></div><div class="form-group"><label>Nombre completo</label><input type="text" name="full_name"></div><div class="form-group"><label>Contrasena *</label><input type="password" name="password" required minlength="6"><small class="text-secondary">Minimo 6 caracteres</small></div><div class="form-group"><label>Rol</label><select name="role">' + roleOptions + '</select><small class="text-secondary">' + infoText + '</small></div><div class="modal-footer" style="padding:16px 0 0;"><button type="button" class="btn btn-secondary" onclick="hideModal()">Cancelar</button><button type="submit" class="btn btn-primary">Crear</button></div></form>');
}

async function handleAddUser(event) {
    event.preventDefault(); var form = event.target;
    try { await api('/api/users', { method: 'POST', body: { username: form.username.value.trim(), full_name: form.full_name.value.trim(), password: form.password.value, role: form.role.value } }); hideModal(); showToast('Usuario creado', 'success'); renderUsers(document.getElementById('page-content')); }
    catch (err) { showToast(err.message, 'error'); }
}

function showEditUserModal(id) {
    var u = (window._users || []).find(function(usr) { return usr.id === id; });
    if (!u) return;
    showModal('Editar Usuario', '<form onsubmit="handleEditUser(event, ' + id + ')"><div class="form-group"><label>Nombre de usuario</label><input type="text" value="' + escapeHtml(u.username) + '" disabled style="background:var(--bg);"></div><div class="form-group"><label>Rol</label><input type="text" value="' + escapeHtml(ROLE_LABELS[u.role]||u.role) + '" disabled style="background:var(--bg);"><small class="text-secondary">El rol no se puede cambiar despues de la creacion</small></div><div class="form-group"><label>Nombre completo</label><input type="text" name="full_name" value="' + escapeHtml(u.full_name || '') + '"></div><div class="form-group"><label>Nueva contrasena (dejar vacio para no cambiar)</label><input type="password" name="password" minlength="6"></div><div class="form-group"><label>Estado</label><select name="is_active"><option value="1"' + (u.is_active?' selected':'') + '>Activo</option><option value="0"' + (!u.is_active?' selected':'') + '>Desactivado</option></select></div><div class="modal-footer" style="padding:16px 0 0;"><button type="button" class="btn btn-secondary" onclick="hideModal()">Cancelar</button><button type="submit" class="btn btn-primary">Actualizar</button></div></form>');
}

async function handleEditUser(event, id) {
    event.preventDefault(); var form = event.target;
    try {
        var body = { full_name: form.full_name.value.trim(), is_active: parseInt(form.is_active.value) };
        if (form.password.value) body.password = form.password.value;
        await api('/api/users/' + id, { method: 'PUT', body: body });
        hideModal(); showToast('Usuario actualizado', 'success'); renderUsers(document.getElementById('page-content'));
    } catch (err) { showToast(err.message, 'error'); }
}

async function deleteUser(id) {
    if (!confirm('Esta seguro de eliminar este usuario?')) return;
    try { await api('/api/users/' + id, { method: 'DELETE' }); showToast('Usuario eliminado', 'success'); renderUsers(document.getElementById('page-content')); }
    catch (err) { showToast(err.message, 'error'); }
}

// ============================================================
// User Usage Statistics (Admin)
// ============================================================
async function renderUserUsage(container) {
    if (!['admin', 'team_admin'].includes(state.user.role)) { container.innerHTML = '<div class="empty-state"><h3>Acceso denegado</h3></div>'; return; }
    container.innerHTML = '<div class="loading"><div class="spinner"></div><p>Cargando estadisticas...</p></div>';
    try {
        var params = new URLSearchParams();
        var dateFrom = document.getElementById('usage-date-from') ? document.getElementById('usage-date-from').value : '';
        var dateTo = document.getElementById('usage-date-to') ? document.getElementById('usage-date-to').value : '';
        if (dateFrom) params.set('date_from', dateFrom);
        if (dateTo) params.set('date_to', dateTo);
        var results = await Promise.all([
            api('/api/admin/user-usage?' + params.toString()),
            api('/api/admin/team-daily-stats?' + params.toString())
        ]);
        var data = results[0];
        var dailyData = results[1];
        var s = data.summary;
        var overallRate = s.total_all > 0 ? (s.total_sent / s.total_all * 100).toFixed(1) : 0;

        // Team stats cards
        var teamTotal = dailyData.total || 0;
        var teamToday = dailyData.today || 0;
        var teamSent = dailyData.sent || 0;
        var teamRate = teamTotal > 0 ? (teamSent / teamTotal * 100).toFixed(1) : 0;

        // Team summary panel
        var teamSummaryHtml = '';
        if (dailyData.team_summary && dailyData.team_summary.length > 0) {
            var teamRows = dailyData.team_summary.map(function(t) {
                var rateClass = t.success_rate >= 90 ? 'badge-success' : t.success_rate >= 70 ? 'badge-warning' : 'badge-danger';
                return '<tr><td><strong>' + escapeHtml(t.team_name) + '</strong><br><small class="text-secondary">' + escapeHtml(t.admin_name || '-') + '</small></td><td style="text-align:center;">' + t.member_count + '</td><td style="text-align:right;font-weight:600;">' + t.total_sms + '</td><td style="text-align:right;color:var(--success);">' + t.today_sms + '</td><td style="text-align:right;color:var(--danger);">' + t.failed_sms + '</td><td style="text-align:right;"><span class="badge ' + rateClass + '">' + t.success_rate + '%</span></td></tr>';
            }).join('');
            teamSummaryHtml = '<div class="card mb-4"><div class="card-header"><h3>Resumen por Equipo</h3></div><div class="table-container"><table><thead><tr><th>Equipo</th><th style="text-align:center;">Miembros</th><th style="text-align:right;">Total SMS</th><th style="text-align:right;">Hoy</th><th style="text-align:right;">Fallidos</th><th style="text-align:right;">Exito</th></tr></thead><tbody>' + teamRows + '</tbody></table></div></div>';
        }

        var rows = data.users.map(function(u) {
            var rateClass = u.success_rate >= 90 ? 'badge-success' : u.success_rate >= 70 ? 'badge-warning' : u.total > 0 ? 'badge-danger' : 'badge-secondary';
            var lastAct = u.last_activity ? timeAgo(u.last_activity) : 'Sin actividad';
            var teamCell = u.team_affiliation ? '<small class="text-secondary">' + escapeHtml(u.team_affiliation) + '</small>' : '<span class="text-secondary">-</span>';
            return '<tr><td><strong>' + escapeHtml(u.username) + '</strong><br><small class="text-secondary">' + escapeHtml(u.full_name || '-') + '</small></td><td>' + teamCell + '</td><td><span class="badge ' + (ROLE_BADGE[u.role]||'badge-gray') + '">' + escapeHtml(ROLE_LABELS[u.role]||u.role) + '</span></td><td style="text-align:right;font-weight:600;">' + u.total + '</td><td style="text-align:right;color:var(--success);">' + u.sent + '</td><td style="text-align:right;color:var(--danger);">' + u.failed + '</td><td style="text-align:right;color:var(--warning);">' + u.pending + '</td><td style="text-align:right;"><span class="badge ' + rateClass + '">' + u.success_rate + '%</span></td><td><small class="text-secondary">' + lastAct + '</small></td></tr>';
        }).join('');

        // Build chart
        var chartLabels = dailyData.labels || [];
        var chartValues = dailyData.values || [];

        container.innerHTML = '<div class="flex-between mb-4"><h1 style="font-size:22px;font-weight:700;">Uso por Usuario</h1><div style="display:flex;gap:8px;align-items:center;"><input type="date" id="usage-date-from" class="form-control" style="width:auto;padding:6px 10px;" value="' + dateFrom + '"><span class="text-secondary">a</span><input type="date" id="usage-date-to" class="form-control" style="width:auto;padding:6px 10px;" value="' + dateTo + '"><button class="btn btn-primary btn-sm" onclick="renderUserUsage(document.getElementById(\'page-content\'))">Filtrar</button></div></div><div class="stats-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:20px;"><div class="stat-card"><div class="stat-value">' + s.total_users + '</div><div class="stat-label">Usuarios activos</div></div><div class="stat-card"><div class="stat-value">' + teamTotal + '</div><div class="stat-label">Total SMS</div></div><div class="stat-card"><div class="stat-value" style="color:var(--success);">' + teamToday + '</div><div class="stat-label">Hoy</div></div><div class="stat-card"><div class="stat-value">' + teamRate + '%</div><div class="stat-label">Tasa de exito</div></div></div>' + teamSummaryHtml + '<div class="card mb-4"><div class="card-header"><h3>Envios diarios</h3></div><div class="card-body" style="padding:16px;"><canvas id="dailyChart" height="100"></canvas></div></div><div class="card"><div class="table-container"><table><thead><tr><th>Usuario</th><th>Equipo</th><th>Rol</th><th style="text-align:right;">Total</th><th style="text-align:right;">Enviados</th><th style="text-align:right;">Fallidos</th><th style="text-align:right;">Pendientes</th><th style="text-align:right;">Exito</th><th>Ultima actividad</th></tr></thead><tbody>' + (rows || '<tr><td colspan="9" class="empty-state">Sin datos</td></tr>') + '</tbody></table></div></div>';

        // Draw chart
        if (chartLabels.length > 0) drawDailyChart(chartLabels, chartValues);
    } catch (err) { container.innerHTML = '<div class="empty-state"><h3>Error</h3><p>' + escapeHtml(err.message) + '</p></div>'; }
}

async function renderUnifiedStats(container) {
    container.innerHTML = '<div class="loading"><div class="spinner"></div><p>Cargando estadisticas...</p></div>';
    try {
        var params = new URLSearchParams();
        var dateFrom = document.getElementById('stats-date-from') ? document.getElementById('stats-date-from').value : '';
        var dateTo = document.getElementById('stats-date-to') ? document.getElementById('stats-date-to').value : '';
        var filterUserId = document.getElementById('stats-user-filter') ? document.getElementById('stats-user-filter').value : '';
        if (dateFrom) params.set('date_from', dateFrom);
        if (dateTo) params.set('date_to', dateTo);
        if (filterUserId) params.set('user_id', filterUserId);

        var data = await api('/api/admin/unified-stats?' + params.toString());
        var myAcct = data.my_account || {};
        var myTeam = data.my_team || {};
        var allTeams = data.all_teams || {};
        var role = state.user.role;

        // Helper: stat card
        function statCard(label, value, color) {
            return '<div class="stat-card"><div class="stat-value" style="' + (color ? 'color:' + color : '') + '">' + value + '</div><div class="stat-label">' + label + '</div></div>';
        }

        // Helper: mini table row
        function statRow(label, value) {
            return '<tr><td style="color:var(--text-secondary);">' + label + '</td><td style="text-align:right;font-weight:600;">' + value + '</td></tr>';
        }

        var userOptions = (data.users || []).map(function(u) {
            return '<option value="' + u.id + '"' + (filterUserId == u.id ? ' selected' : '') + '>' + escapeHtml(u.username) + (u.full_name ? ' - ' + escapeHtml(u.full_name) : '') + '</option>';
        }).join('');
        var filterHtml = '<div class="flex-between mb-4"><h1 style="font-size:22px;font-weight:700;">Panel de Estadisticas</h1><div style="display:flex;gap:8px;align-items:center;"><input type="date" id="stats-date-from" class="form-control" style="width:auto;padding:6px 10px;" value="' + dateFrom + '"><span class="text-secondary">a</span><input type="date" id="stats-date-to" class="form-control" style="width:auto;padding:6px 10px;" value="' + dateTo + '"><select id="stats-user-filter" class="form-control" style="width:auto;padding:6px 10px;"><option value="">Todos los usuarios</option>' + userOptions + '</select><button class="btn btn-primary btn-sm" onclick="renderUnifiedStats(document.getElementById(\'page-content\'))">Filtrar</button></div></div>';

        // Panel 1: My Account (all roles)
        var myRate = myAcct.total > 0 ? (myAcct.sent / myAcct.total * 100).toFixed(1) : '0.0';
        html = filterHtml + '<div class="card mb-4"><div class="card-header" style="display:flex;align-items:center;gap:10px;"><span style="font-size:20px;"></span><h3 style="margin:0;">Mi Cuenta</h3><span class="badge badge-primary" style="margin-left:auto;">' + escapeHtml(state.user.username) + '</span></div><div class="card-body"><div class="stats-grid" style="grid-template-columns:repeat(4,1fr);">' + statCard('Total SMS', myAcct.total || 0) + statCard('Enviados', myAcct.sent || 0, 'var(--success)') + statCard('Fallidos', myAcct.failed || 0, 'var(--danger)') + statCard('Tasa de Exito', myRate + '%') + '</div></div></div>';

        // Panel 2: My Team (team_admin, team_member, and admin)
        if (role === 'team_admin' || role === 'team_member' || role === 'admin') {
            var teamRate = myTeam.total > 0 ? (myTeam.sent / myTeam.total * 100).toFixed(1) : '0.0';
            html += '<div class="card mb-4"><div class="card-header" style="display:flex;align-items:center;gap:10px;"><span style="font-size:20px;">👥</span><h3 style="margin:0;">Mi Equipo</h3><span class="badge badge-success" style="margin-left:auto;">' + (myTeam.team_name || '-') + '</span></div><div class="card-body"><div class="stats-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:16px;">' + statCard('Miembros', myTeam.member_count || 0) + statCard('Total SMS', myTeam.total || 0) + statCard('Enviados Hoy', myTeam.today || 0, 'var(--success)') + statCard('Tasa de Exito', teamRate + '%') + '</div><table style="width:100%;font-size:13px;"><tbody>' + statRow('SMS Pendientes', myTeam.pending || 0) + statRow('Limite Diario', myTeam.daily_limit > 0 ? myTeam.daily_limit + ' SMS/usuario' : 'Sin limite') + statRow('Ultima Actividad', myTeam.last_activity ? timeAgo(myTeam.last_activity) : 'Sin actividad') + '</tbody></table></div></div>';
        }

        // Panel 3: All Teams (admin only)
        if (role === 'admin') {
            var allRate = allTeams.total > 0 ? (allTeams.sent / allTeams.total * 100).toFixed(1) : '0.0';
            var teamCount = allTeamsList ? allTeamsList.length : 0;
            html += '<div class="card mb-4"><div class="card-header" style="display:flex;align-items:center;gap:10px;"><span style="font-size:20px;"></span><h3 style="margin:0;">Todos los Equipos</h3><span class="badge" style="margin-left:auto;background:var(--primary);color:#fff;">' + teamCount + ' equipos</span></div><div class="card-body"><div class="stats-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:16px;">' + statCard('Total Equipos', teamCount) + statCard('Total Miembros', allTeams.member_count || 0) + statCard('Total SMS', allTeams.total || 0) + statCard('Tasa de Exito', allRate + '%') + '</div>';

            // Team breakdown table
            if (allTeamsList && allTeamsList.length > 0) {
                var teamRows = allTeamsList.map(function(t) {
                    var r = t.total > 0 ? (t.sent / t.total * 100).toFixed(1) : '0.0';
                    var rateClass = r >= 90 ? 'badge-success' : r >= 70 ? 'badge-warning' : 'badge-danger';
                    return '<tr><td><strong>' + escapeHtml(t.team_name) + '</strong><br><small class="text-secondary">' + escapeHtml(t.admin_name || '-') + '</small></td><td style="text-align:center;">' + t.member_count + '</td><td style="text-align:right;font-weight:600;">' + t.total + '</td><td style="text-align:right;color:var(--success);">' + t.sent + '</td><td style="text-align:right;color:var(--danger);">' + t.failed + '</td><td style="text-align:right;"><span class="badge ' + rateClass + '">' + r + '%</span></td></tr>';
                }).join('');
                html += '<div class="table-container" style="margin-top:16px;"><table><thead><tr><th>Equipo</th><th style="text-align:center;">Miembros</th><th style="text-align:right;">Total SMS</th><th style="text-align:right;">Enviados</th><th style="text-align:right;">Fallidos</th><th style="text-align:right;">Exito</th></tr></thead><tbody>' + teamRows + '</tbody></table></div>';
            }
            html += '</div></div>';
        }

        container.innerHTML = html;
    } catch (err) { container.innerHTML = '<div class="empty-state"><h3>Error</h3><p>' + escapeHtml(err.message) + '</p></div>'; }
}

function drawDailyChart(labels, values) {
    var canvas = document.getElementById('dailyChart');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    var dpr = window.devicePixelRatio || 1;
    var rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = 280 * dpr;
    canvas.style.width = rect.width + 'px';
    canvas.style.height = '280px';
    ctx.scale(dpr, dpr);

    var w = rect.width;
    var h = 280;
    var pad = { top: 20, right: 20, bottom: 40, left: 50 };
    var chartW = w - pad.left - pad.right;
    var chartH = h - pad.top - pad.bottom;

    var maxVal = Math.max.apply(null, values) || 1;
    maxVal = Math.ceil(maxVal * 1.2);

    ctx.clearRect(0, 0, w, h);

    // Grid lines
    ctx.strokeStyle = '#E2E8F0';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#64748B';
    ctx.font = '11px Inter, system-ui, sans-serif';
    ctx.textAlign = 'right';
    for (var i = 0; i <= 4; i++) {
        var y = pad.top + chartH - (chartH * i / 4);
        var val = Math.round(maxVal * i / 4);
        ctx.beginPath();
        ctx.moveTo(pad.left, y);
        ctx.lineTo(w - pad.right, y);
        ctx.stroke();
        ctx.fillText(val, pad.left - 8, y + 4);
    }

    // X labels
    ctx.textAlign = 'center';
    var step = Math.max(1, Math.floor(labels.length / 7));
    for (var i = 0; i < labels.length; i += step) {
        var x = pad.left + (chartW * i / (labels.length - 1 || 1));
        ctx.fillText(labels[i], x, h - 10);
    }

    // Line
    ctx.strokeStyle = '#2563EB';
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (var i = 0; i < values.length; i++) {
        var x = pad.left + (chartW * i / (values.length - 1 || 1));
        var y = pad.top + chartH - (chartH * values[i] / maxVal);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Area fill
    ctx.lineTo(pad.left + chartW, pad.top + chartH);
    ctx.lineTo(pad.left, pad.top + chartH);
    ctx.closePath();
    ctx.fillStyle = 'rgba(37, 99, 235, 0.08)';
    ctx.fill();

    // Dots
    for (var i = 0; i < values.length; i++) {
        var x = pad.left + (chartW * i / (values.length - 1 || 1));
        var y = pad.top + chartH - (chartH * values[i] / maxVal);
        ctx.beginPath();
        ctx.arc(x, y, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = '#2563EB';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
    }
}

// ============================================================
// Team Statistics (Admin only)
// ============================================================
async function renderTeamStats(container) {
    if (state.user.role !== 'admin') { container.innerHTML = '<div class="empty-state"><h3>Acceso denegado</h3></div>'; return; }
    container.innerHTML = '<div class="text-center text-secondary">Cargando...</div>';
    try {
        var data = await api('/api/admin/team-stats');
        var s = data.summary;
        var teams = data.teams;

        // Summary cards
        var cardsHtml = '<div class="stats-grid" style="grid-template-columns:repeat(5,1fr);margin-bottom:20px;">' +
            '<div class="stat-card"><div class="stat-value">' + s.total_teams + '</div><div class="stat-label">Equipos</div></div>' +
            '<div class="stat-card"><div class="stat-value">' + s.total_members + '</div><div class="stat-label">Miembros totales</div></div>' +
            '<div class="stat-card"><div class="stat-value">' + s.total_sms + '</div><div class="stat-label">Total SMS</div></div>' +
            '<div class="stat-card"><div class="stat-value" style="color:var(--success);">' + s.today_sms + '</div><div class="stat-label">Hoy</div></div>' +
            '<div class="stat-card"><div class="stat-value">' + s.success_rate + '%</div><div class="stat-label">Tasa de exito</div></div>' +
            '</div>';

        // Chart
        var chartHtml = '<div class="card mb-4"><div class="card-header"><h3>Envios diarios por equipo (ultimos 30 dias)</h3></div><div class="card-body" style="padding:16px;"><canvas id="teamStatsChart" height="120"></canvas></div></div>';

        // Team table
        var rows = '';
        if (teams.length === 0) {
            rows = '<tr><td colspan="8" class="empty-state">No hay equipos registrados</td></tr>';
        } else {
            teams.forEach(function(t) {
                var statusBadge = t.is_active ? '<span class="badge badge-green">Activo</span>' : '<span class="badge badge-red">Inactivo</span>';
                var limitText = t.daily_limit > 0 ? t.daily_limit : '<span class="text-secondary">Sin limite</span>';
                var rateClass = t.success_rate >= 90 ? 'badge-green' : (t.success_rate >= 70 ? 'badge-orange' : 'badge-red');
                rows += '<tr>' +
                    '<td><strong>' + escapeHtml(t.team_name) + '</strong><br><small class="text-secondary">' + escapeHtml(t.username) + '</small></td>' +
                    '<td>' + statusBadge + '</td>' +
                    '<td style="text-align:center;">' + t.member_count + '</td>' +
                    '<td style="text-align:center;">' + limitText + '</td>' +
                    '<td style="text-align:right;font-weight:600;">' + t.total_sms + '</td>' +
                    '<td style="text-align:right;color:var(--success);">' + t.today_sms + '</td>' +
                    '<td style="text-align:right;color:var(--danger);">' + t.failed_sms + '</td>' +
                    '<td style="text-align:right;"><span class="badge ' + rateClass + '">' + t.success_rate + '%</span></td>' +
                    '</tr>';
            });
        }

        var tableHtml = '<div class="card"><div class="table-container"><table>' +
            '<thead><tr>' +
            '<th>Equipo</th><th>Estado</th><th style="text-align:center;">Miembros</th><th style="text-align:center;">Limite diario</th>' +
            '<th style="text-align:right;">Total SMS</th><th style="text-align:right;">Hoy</th><th style="text-align:right;">Fallidos</th><th style="text-align:right;">Exito</th>' +
            '</tr></thead><tbody>' + rows + '</tbody></table></div></div>';

        container.innerHTML = '<div class="flex-between mb-4"><h1 style="font-size:22px;font-weight:700;">Estadisticas por Equipo</h1></div>' + cardsHtml + chartHtml + tableHtml;

        // Draw chart - stacked area for all teams
        drawTeamStatsChart(teams);
    } catch (err) {
        container.innerHTML = '<div class="empty-state"><h3>Error al cargar</h3><p>' + escapeHtml(err.message) + '</p></div>';
    }
}

function drawTeamStatsChart(teams) {
    var canvas = document.getElementById('teamStatsChart');
    if (!canvas || teams.length === 0) return;
    var ctx = canvas.getContext('2d');
    var dpr = window.devicePixelRatio || 1;
    var rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    var W = rect.width, H = rect.height;
    var pad = { top: 20, right: 20, bottom: 40, left: 50 };
    var chartW = W - pad.left - pad.right;
    var chartH = H - pad.top - pad.bottom;

    // Get days from first team's daily_chart
    var days = teams[0].daily_chart.map(function(d) { return d.day; });
    var n = days.length;

    // Find max value
    var maxVal = 1;
    teams.forEach(function(t) {
        t.daily_chart.forEach(function(d) { if (d.total > maxVal) maxVal = d.total; });
    });
    maxVal = Math.ceil(maxVal * 1.1);

    // Colors for each team
    var colors = ['#2563EB', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16'];

    // Clear
    ctx.clearRect(0, 0, W, H);

    // Grid lines
    ctx.strokeStyle = '#E2E8F0';
    ctx.lineWidth = 0.5;
    for (var i = 0; i <= 4; i++) {
        var y = pad.top + chartH - (chartH * i / 4);
        ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + chartW, y); ctx.stroke();
        ctx.fillStyle = '#64748B'; ctx.font = '11px Inter, sans-serif'; ctx.textAlign = 'right';
        ctx.fillText(Math.round(maxVal * i / 4), pad.left - 8, y + 4);
    }

    // X-axis labels (every 5 days)
    ctx.textAlign = 'center'; ctx.fillStyle = '#64748B'; ctx.font = '10px Inter, sans-serif';
    for (var i = 0; i < n; i += 5) {
        var x = pad.left + (chartW * i / (n - 1));
        ctx.fillText(days[i].substring(5), x, H - pad.bottom + 18);
    }
    // Last day
    var lastX = pad.left + chartW;
    ctx.fillText(days[n-1].substring(5), lastX, H - pad.bottom + 18);

    // Draw lines for each team
    teams.forEach(function(team, ti) {
        var color = colors[ti % colors.length];
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        team.daily_chart.forEach(function(d, di) {
            var x = pad.left + (chartW * di / (n - 1));
            var y = pad.top + chartH - (chartH * d.total / maxVal);
            if (di === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke();

        // Draw dots
        ctx.fillStyle = color;
        team.daily_chart.forEach(function(d, di) {
            if (d.total > 0) {
                var x = pad.left + (chartW * di / (n - 1));
                var y = pad.top + chartH - (chartH * d.total / maxVal);
                ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
            }
        });
    });

    // Legend
    var legendX = pad.left + 10;
    var legendY = pad.top + 5;
    teams.forEach(function(team, ti) {
        var color = colors[ti % colors.length];
        ctx.fillStyle = color;
        ctx.fillRect(legendX, legendY + ti * 18, 12, 12);
        ctx.fillStyle = '#1E293B'; ctx.font = '11px Inter, sans-serif'; ctx.textAlign = 'left';
        ctx.fillText(team.team_name, legendX + 16, legendY + ti * 18 + 10);
    });
}

// ============================================================
// Config (Admin)
// ============================================================
async function renderConfig(container) {
    if (state.user.role !== 'admin' && state.user.role !== 'team_admin') { container.innerHTML = '<div class="empty-state"><h3>Acceso denegado</h3></div>'; return; }
    container.innerHTML = '<div class="text-center text-secondary">Cargando...</div>';
    try {
        var results = await Promise.all([api('/api/config/sms'), api('/api/config/logs')]);
        var configData = results[0].config || {};
        var logsData = results[1];
        var isConfigured = configData.domain && configData.spid && configData.api_pwd;
        var logRows = logsData.logs.length === 0
            ? '<tr><td colspan="4" class="text-center text-secondary" style="padding:24px;">No hay registros</td></tr>'
            : logsData.logs.map(function(l) { return '<tr><td class="text-sm text-secondary">' + formatDate(l.created_at) + '</td><td>' + escapeHtml(l.action) + '</td><td class="text-sm">' + escapeHtml(l.details || '-') + '</td><td><span class="badge ' + (l.status === 'success' ? 'badge-green' : l.status === 'error' ? 'badge-red' : 'badge-gray') + '">' + escapeHtml(l.status) + '</span></td></tr>'; }).join('');

        container.innerHTML =
            '<h1 class="mb-4" style="font-size:22px;font-weight:700;">Configuracion API SMS</h1>' +
            '<div class="card mb-4"><div class="card-header"><h2>Proveedor SMS (infin8linx)</h2><span class="badge ' + (isConfigured ? 'badge-green' : 'badge-yellow') + '">' + (isConfigured ? 'Configurado' : 'Sin configurar') + '</span></div><div class="card-body">' +
                '<form onsubmit="handleSaveConfig(event)">' +
                    '<div class="form-group"><label>Dominio del Servidor</label><input type="text" name="domain" value="' + escapeHtml(configData.domain || '') + '" placeholder="api.infin8linx.com"><small class="text-secondary">Dominio del servidor SMS (sin https://)</small></div>' +
                    '<div class="form-group"><label>Cuenta de Interfaz (SPID)</label><input type="text" name="spid" value="' + escapeHtml(configData.spid || '') + '" placeholder="Su cuenta de interfaz"><small class="text-secondary">Cuenta proporcionada por la empresa</small></div>' +
                    '<div class="form-group"><label>Contrasena API</label><input type="password" name="api_pwd" value="' + escapeHtml(configData.api_pwd || '') + '" placeholder="Contrasena de la API"><small class="text-secondary">Contrasena proporcionada por la empresa (se encripta con MD5)</small></div>' +
                    '<div class="form-group"><label>Nombre del Remitente (senderid)</label><input type="text" name="sender_name" value="' + escapeHtml(configData.sender_name || '') + '" placeholder="MiEmpresa"><small class="text-secondary">Campo opcional, se habilita tras cooperacion con el socio</small></div>' +
                    '<div class="flex gap-2"><button type="submit" class="btn btn-primary">Guardar Configuracion</button><button type="button" class="btn btn-secondary" onclick="testApiConnection()">Probar Conexion</button></div>' +
                '</form>' +
                '<div class="mt-4" style="padding:12px;background:#EFF6FF;border-radius:8px;font-size:13px;color:#1E293B;">' +
                    '<strong>Nota sobre codificacion:</strong> El espanol usa codificacion UCS2. Cada SMS individual admite hasta 70 caracteres. SMS largos se dividen en partes de 67 caracteres cada una.' +
                '</div>' +
            '</div></div>' +
            '<div class="card"><div class="card-header"><h2>Registros de Actividad</h2></div><div class="table-container"><table><thead><tr><th>Fecha</th><th>Accion</th><th>Detalles</th><th>Estado</th></tr></thead><tbody>' + logRows + '</tbody></table></div></div>';
    } catch (err) { container.innerHTML = '<div class="empty-state"><h3>Error</h3><p>' + escapeHtml(err.message) + '</p></div>'; }
}

async function handleSaveConfig(event) {
    event.preventDefault(); var form = event.target;
    try { await api('/api/config/sms', { method: 'PUT', body: { domain: form.domain.value.trim(), spid: form.spid.value.trim(), api_pwd: form.api_pwd.value.trim(), sender_name: form.sender_name.value.trim() } }); showToast('Configuracion guardada', 'success'); renderConfig(document.getElementById('page-content')); }
    catch (err) { showToast(err.message, 'error'); }
}

async function testApiConnection() {
    try { var data = await api('/api/config/sms/test', { method: 'POST' }); showToast(data.message, 'success'); }
    catch (err) { showToast(err.message, 'error'); }
}

async function renderTeamConfig(container) {
    if (state.user.role !== 'team_admin') { container.innerHTML = '<div class="empty-state"><h3>Acceso denegado</h3></div>'; return; }
    container.innerHTML = '<div class="text-center text-secondary">Cargando...</div>';
    try {
        var data = await api('/api/config/daily-limit');
        container.innerHTML = `
            <div class="page-header"><h2>Configuracion de Equipo</h2></div>
            <div class="card">
                <div class="card-header"><h3>Limite diario de envio por miembro</h3></div>
                <div class="card-body">
                    <p class="text-secondary" style="margin-bottom:16px">Establece el numero maximo de SMS que cada miembro de tu equipo puede enviar por dia. Los miembros del equipo no podran enviar mas SMS una vez alcanzado el limite.</p>
                    <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
                        <div style="flex:1;min-width:200px">
                            <label class="form-label">Limite diario (SMS por miembro)</label>
                            <input type="number" id="daily-limit-input" class="form-input" value="${data.daily_limit}" min="0" max="10000" placeholder="0 = sin limite">
                            <small class="text-secondary">0 = sin limite</small>
                        </div>
                        <div style="padding-top:24px">
                            <button class="btn btn-primary" onclick="saveDailyLimit()">Guardar</button>
                        </div>
                    </div>
                </div>
            </div>
            <div class="card" style="margin-top:16px">
                <div class="card-header"><h3>Uso de hoy</h3></div>
                <div class="card-body">
                    <div id="team-today-usage" class="text-secondary">Cargando...</div>
                </div>
            </div>`;
        // Load today's usage per member
        try {
            var usage = await api('/api/admin/user-usage');
            var today = new Date().toISOString().split('T')[0];
            var rows = usage.users.map(function(u) {
                var todayCount = (u.last_activity && u.last_activity.startsWith(today)) ? u.sent : 0;
                return `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)">
                    <span>${u.full_name} <small class="text-secondary">(${u.username})</small></span>
                    <span><strong>${todayCount}</strong> / ${data.daily_limit || '∞'} SMS</span>
                </div>`;
            }).join('');
            document.getElementById('team-today-usage').innerHTML = rows || '<span class="text-secondary">Sin miembros</span>';
        } catch(e) {}
    } catch (err) { container.innerHTML = '<div class="empty-state"><h3>Error al cargar</h3></div>'; }
}

async function saveDailyLimit() {
    var val = parseInt(document.getElementById('daily-limit-input').value);
    if (isNaN(val) || val < 0) { showToast('Valor invalido', 'error'); return; }
    try { await api('/api/config/daily-limit', { method: 'POST', body: { limit: val } }); showToast('Limite guardado', 'success'); renderTeamConfig(document.getElementById('page-content')); }
    catch (err) { showToast(err.message, 'error'); }
}

// ============================================================
// Initialize
// ============================================================
checkAuth();
