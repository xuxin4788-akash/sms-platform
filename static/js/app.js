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
let isHandlingSessionExpiry = false;

async function handleSessionExpiry(message) {
    if (isHandlingSessionExpiry) return;
    isHandlingSessionExpiry = true;
    state.user = null;
    showLogin();
    const errorEl = document.getElementById('login-error');
    if (errorEl) {
        errorEl.textContent = message || 'Tu sesion ha expirado. Inicia sesion nuevamente.';
        errorEl.style.display = 'block';
    }
    try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }); } catch (e) {}
    isHandlingSessionExpiry = false;
}

async function api(url, options = {}) {
    const defaults = { headers: { 'Content-Type': 'application/json' }, credentials: 'include' };
    const config = { ...defaults, ...options };
    if (config.body && typeof config.body === 'object' && !(config.body instanceof FormData)) {
        config.body = JSON.stringify(config.body);
    }
    if (config.body instanceof FormData) { delete config.headers['Content-Type']; }
    const res = await fetch(url, config);
    let data = {};
    try { data = await res.json(); } catch (e) { data = {}; }
    if (res.status === 401) {
        handleSessionExpiry(data.error);
        throw new Error(data.error || 'Sesion expirada');
    }
    if (!res.ok) throw new Error(data.error || 'Error en la solicitud');
    return data;
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

// Available message/template variables. Click on a chip to insert it at the
// textarea's caret position (or at the end if the field is not focused).
const TEMPLATE_VARS = [
    { token: '{nombre}', label: 'Nombre' },
    { token: '{telefono}', label: 'Telefono' },
    { token: '{app_name}', label: 'APP' },
    { token: '{amount}', label: 'Monto' },
    { token: '{discount}', label: 'Descuento' },
    { token: '{payment_link}', label: 'Link de pago' }
];

function variableChips(targetId) {
    return '<span class="var-chips-label">Variables:</span> ' +
        TEMPLATE_VARS.map(function (v) {
            return '<button type="button" class="var-chip" onclick="insertTemplateVariable(\'' + targetId + '\', \'' + v.token + '\')" title="' + v.label + '">' + v.token + '</button>';
        }).join('');
}

function insertTemplateVariable(targetId, token) {
    var el = document.getElementById(targetId);
    if (!el) return;
    el.focus();
    var start = el.selectionStart != null ? el.selectionStart : el.value.length;
    var end = el.selectionEnd != null ? el.selectionEnd : el.value.length;
    el.value = el.value.slice(0, start) + token + el.value.slice(end);
    var pos = start + token.length;
    el.setSelectionRange(pos, pos);
    el.dispatchEvent(new Event('input', { bubbles: true }));
}

// Payment links accept free text (no URL format enforced on input). For the
// open-link action, prepend https:// when the stored value has no scheme so a
// bare value like "liga.com/pago" opens correctly instead of as a relative path.
function normalizePaymentLink(link) {
    var v = String(link || '').trim();
    if (!v) return '';
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(v)) return v;
    return 'https://' + v;
}

function parseAppDate(dateStr) {
    if (!dateStr) return null;
    if (dateStr instanceof Date) return dateStr;
    var raw = String(dateStr).trim();
    if (!raw) return null;
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(raw)) {
        raw = raw.replace(' ', 'T');
        if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw)) raw += 'Z';
    }
    var d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
}

function formatDate(dateStr) {
    var d = parseAppDate(dateStr);
    if (!d) return '-';
    try {
        return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch { return dateStr; }
}

function formatCost(value) {
    const n = Number(value);
    const safe = isFinite(n) ? n : 0;
    return safe.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPrice(value) {
    const n = Number(value);
    return isFinite(n) ? n.toFixed(4) : '0.0000';
}

function formatMoney(value, unitPrice) {
    const p = Number(unitPrice);
    return formatCost((Number(value) || 0) * (isFinite(p) ? p : 0));
}

async function exportAllTeamsStats() {
    try {
        var params = new URLSearchParams();
        var fromEl = document.getElementById('stats-date-from');
        var toEl = document.getElementById('stats-date-to');
        if (fromEl && fromEl.value) params.set('date_from', fromEl.value);
        if (toEl && toEl.value) params.set('date_to', toEl.value);
        var qs = params.toString();
        var response = await fetch('/api/admin/export-teams' + (qs ? '?' + qs : ''), { credentials: 'include' });
        if (!response.ok) {
            var data = await response.json().catch(function() { return {}; });
            throw new Error(data.error || 'Error al exportar');
        }
        var blob = await response.blob();
        var url = window.URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'equipos_' + new Date().toISOString().slice(0,10) + '.xlsx';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        showToast('Exportacion completada', 'success');
    } catch (err) {
        showToast(err.message, 'error');
    }
}

function timeAgo(dateStr) {
    var d = parseAppDate(dateStr);
    if (!d) return '-';
    try {
        const now = new Date();
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
    else if (type === 'calls') { state.calls.page = page; loadVoiceRecords(); }
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
// Mobile helpers
// ============================================================
function applyMobileTableLabels(root) {
    if (window.innerWidth > 640) return;
    const scope = root || document;
    scope.querySelectorAll('table.data-table').forEach(table => {
        const headers = Array.from(table.querySelectorAll('thead th')).map(th => th.textContent.trim());
        if (!headers.length) return;
        table.querySelectorAll('tbody tr').forEach(row => {
            Array.from(row.children).forEach((cell, idx) => {
                if (!cell.getAttribute('data-label') && headers[idx]) {
                    cell.setAttribute('data-label', headers[idx]);
                }
            });
        });
    });
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
    // Embedded bubble panel: skip sidebar/dashboard, render the compact
    // quick-send view directly inside the native WebView panel.
    var isEmbed = (window.location.hash || '').indexOf('#/quick-send-embed') === 0;
    if (isEmbed) {
        try {
            var d = await api('/api/auth/me');
            state.user = d.user;
            renderQuickSendEmbed();
        } catch (e) {
            renderEmbedLogin();
        }
        return;
    }
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

    // Permission-based navigation visibility
    var perms = state.user.permissions || [];
    var role = state.user.role;
    // Fallback defaults: when the backend reports no permissions AND the
    // session does not carry an explicit permsConfigured flag, show core
    // menu items so the sidebar is never blank on fresh databases. The
    // server applies the same fallback; an explicit [] set by an admin is
    // respected because /api/auth/me includes permsConfigured=true.
    if (role !== 'admin' && (!perms || perms.length === 0) &&
        state.user.permsConfigured !== true) {
        if (role === 'team_admin') {
            perms = ['dashboard', 'contacts', 'groups', 'templates', 'send',
                     'records', 'calls', 'content-search', 'users', 'my-account',
                     'my-team', 'all-teams', 'retention'];
        } else {
            perms = ['dashboard', 'contacts', 'groups', 'templates', 'send',
                     'records', 'calls', 'my-account'];
        }
    }
    document.querySelectorAll('.nav-item').forEach(function(el) {
        var page = el.dataset.page;
        // Admin always sees everything
        if (role === 'admin') {
            el.style.display = 'flex';
            return;
        }
        // Check permissions list
        var show = perms.indexOf(page) !== -1;
        el.style.display = show ? 'flex' : 'none';
    });
    navigateTo(state.currentPage || 'dashboard');
    syncSystemBubble();
}

async function logout() {
    await api('/api/auth/logout', { method: 'POST' });
    state.user = null;
    showLogin();
}

function setSidebarOpen(open) {
    var sidebar = document.getElementById('sidebar');
    var backdrop = document.getElementById('sidebar-backdrop');
    if (!sidebar) return;
    sidebar.classList.toggle('open', !!open);
    if (backdrop) {
        backdrop.classList.toggle('show', !!open);
        backdrop.style.display = open ? 'block' : '';
    }
    document.body.classList.toggle('sidebar-open', !!open);
}

function toggleSidebar(forceClose) {
    var sidebar = document.getElementById('sidebar');
    if (!sidebar) return;
    var isOpen = sidebar.classList.contains('open');
    var willOpen = typeof forceClose === 'boolean' ? !forceClose : !isOpen;
    setSidebarOpen(willOpen);
}

function closeSidebar() { setSidebarOpen(false); }
function openSidebar() { setSidebarOpen(true); }

document.addEventListener('click', function(e) {
    var target = e.target;
    if (target && target.closest && target.closest('#sidebar-backdrop')) {
        e.preventDefault();
        closeSidebar();
    }
});

document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeSidebar();
});

document.addEventListener('click', function(e) {
    var target = e.target;
    if (!target || !target.closest) return;
    if (target.closest('.sidebar .nav-item')) closeSidebar();
});

window.addEventListener('resize', function() {
    if (window.innerWidth > 768) closeSidebar();
});

// ============================================================
// Router
// ============================================================
function navigateTo(page) {
    state.currentPage = page;
    document.querySelectorAll('.nav-item').forEach(function(el) {
        el.classList.toggle('active', el.dataset.page === page);
    });
    closeSidebar();
    var content = document.getElementById('page-content');
    switch (page) {
        case 'dashboard': renderDashboard(content); break;
        case 'contacts': renderContacts(content); break;
        case 'groups': renderGroups(content); break;
        case 'templates': renderTemplates(content); break;
        case 'send': renderSendSMS(content); break;
        case 'records': renderRecords(content); break;
        case 'calls': renderCalls(content); break;
        case 'voice-config':
            if (state.user.role !== 'admin') { renderDashboard(content); break; }
            renderVoiceConfig(content); break;
        case 'extensions':
            if (state.user.role !== 'admin') { renderDashboard(content); break; }
            renderExtensions(content); break;
        case 'retention':
            if (state.user.role !== 'admin' && state.user.role !== 'team_admin') { renderDashboard(content); break; }
            renderRetention(content); break;
        case 'content-search': renderContentSearch(content); break;
        case 'users': renderUsers(content); break;
        case 'my-account': renderMyAccount(content); break;
        case 'my-team': renderMyTeam(content); break;
        case 'all-teams': renderAllTeams(content); break;
        case 'team-stats': renderTeamStats(content); break;
        case 'role-permissions': renderRolePermissions(content); break;
        case 'config':
            if (state.user.role === 'team_admin') renderTeamConfig(content);
            else renderConfig(content);
            break;
        default: renderDashboard(content);
    }
    closeSidebar();
    setTimeout(function() { applyMobileTableLabels(content); }, 0);
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
            ? '<tr><td colspan="8" class="text-center text-secondary" style="padding:32px;">No hay contactos</td></tr>'
            : data.contacts.map(function(c) {
                var remarkBadge = c.remark ? '<span class="badge ' + (remarkBadgeMap[c.remark] || 'badge-blue') + '">' + escapeHtml(c.remark) + '</span>' : '<span class="text-secondary text-sm">-</span>';
                var nameCell = '<strong>' + escapeHtml(c.name) + '</strong>' +
                    (c.app_name ? '<div style="font-size:12px;color:#64748B;margin-top:2px;">' + escapeHtml(c.app_name) + '</div>' : '');
                var amountVal = Number(c.amount || 0);
                var discountVal = Number(c.discount_amount || 0);
                var amountCell = (amountVal || discountVal)
                    ? '<div>$' + amountVal.toFixed(2) + '</div>' +
                      (discountVal ? '<div style="font-size:12px;color:#10B981;">-$' + discountVal.toFixed(2) + '</div>' : '')
                    : '<span class="text-secondary text-sm">-</span>';
                var linkCell = c.payment_link
                    ? '<a href="' + escapeHtml(normalizePaymentLink(c.payment_link)) + '" target="_blank" rel="noopener" class="btn btn-ghost btn-sm btn-icon" title="' + escapeHtml(c.payment_link) + '" style="color:var(--primary);"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg></a>'
                    : '<span class="text-secondary text-sm">-</span>';
                return '<tr><td>' + nameCell + '</td><td>' + escapeHtml(c.phone) + '</td><td>' + (c.group_name ? '<span class="badge badge-blue">' + escapeHtml(c.group_name) + '</span>' : '<span class="text-secondary text-sm">Sin grupo</span>') + '</td><td>' + remarkBadge + '</td><td>' + amountCell + '</td><td class="text-secondary text-sm">' + escapeHtml(c.notes || '-') + '</td><td>' + linkCell + '</td><td><button class="btn btn-ghost btn-sm btn-icon" onclick="showEditContactModal(' + c.id + ')" title="Editar"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button><button class="btn btn-ghost btn-sm btn-icon" onclick="deleteContact(' + c.id + ')" title="Eliminar" style="color:var(--danger);"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button></td></tr>';
            }).join('');

        var initialHtml =
            '<div class="flex-between mb-4"><h1 style="font-size:22px;font-weight:700;">Contactos</h1><div class="flex gap-2"><button class="btn btn-secondary btn-sm" onclick="showImportModal()"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg> Importar CSV</button><button class="btn btn-primary btn-sm" onclick="showAddContactModal()"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg> Nuevo Contacto</button></div></div>' +
            '<div class="card"><div class="card-body" style="padding-bottom:0;"><div class="toolbar"><input type="text" class="search-input" placeholder="Buscar por nombre, telefono..." value="' + escapeHtml(state.contacts.search) + '" onkeyup="handleContactSearch(event)"><select onchange="handleContactGroupFilter(this.value)"><option value="">Todos los grupos</option>' + groupOptions + '</select>' + remarkSelect + '</div></div><div class="table-container"><table><thead><tr><th>Nombre</th><th>Telefono</th><th>Grupo</th><th>Nota</th><th>Monto</th><th>Observaciones</th><th>Link</th><th>Acciones</th></tr></thead><tbody>' + rows + '</tbody></table></div>' + renderPagination(data, 'contacts') + '</div>';
        container.innerHTML = initialHtml;
        applyMobileTableLabels(container);
    } catch (err) {
        console.error('renderContacts error:', err);
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
        showModal('Nuevo Contacto', '<form id="add-contact-form" onsubmit="handleAddContact(event)"><div class="form-row" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;"><div class="form-group"><label>Nombre *</label><input type="text" name="name" required></div><div class="form-group"><label>Telefono *</label><input type="text" name="phone" required placeholder="+34 600 000 000"></div></div><div class="form-row" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;"><div class="form-group"><label>Grupo</label><select name="group_id"><option value="">Sin grupo</option>' + opts + '</select></div><div class="form-group"><label>Nota</label><select name="remark">' + remarkOpts + '</select></div></div><div class="form-group"><label>Nombre de APP</label><input type="text" name="app_name" placeholder="Ej: App Recargas" maxlength="255"></div><div class="form-row" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;"><div class="form-group"><label>Monto</label><input type="number" name="amount" step="0.01" min="0" placeholder="0.00"></div><div class="form-group"><label>Monto de descuento</label><input type="number" name="discount_amount" step="0.01" min="0" placeholder="0.00"></div></div><div class="form-group"><label>Link de pago</label><input type="text" name="payment_link" placeholder="Ej: liga.com/pago"></div><div class="form-group"><label>Observaciones</label><textarea name="notes" rows="3"></textarea></div><div class="modal-footer" style="padding:16px 0 0;"><button type="button" class="btn btn-secondary" onclick="hideModal()">Cancelar</button><button type="submit" class="btn btn-primary">Guardar</button></div></form>');
    });
}

async function handleAddContact(event) {
    event.preventDefault();
    var form = event.target;
    try {
        await api('/api/contacts', { method: 'POST', body: { name: form.name.value.trim(), phone: form.phone.value.trim(), group_id: form.group_id.value || null, remark: form.remark.value, app_name: form.app_name.value.trim(), amount: form.amount.value || 0, discount_amount: form.discount_amount.value || 0, payment_link: form.payment_link.value.trim(), notes: form.notes.value.trim() } });
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
        showModal('Editar Contacto', '<form onsubmit="handleEditContact(event, ' + id + ')"><div class="form-row" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;"><div class="form-group"><label>Nombre *</label><input type="text" name="name" value="' + escapeHtml(contact.name) + '" required></div><div class="form-group"><label>Telefono *</label><input type="text" name="phone" value="' + escapeHtml(contact.phone) + '" required></div></div><div class="form-row" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;"><div class="form-group"><label>Grupo</label><select name="group_id"><option value="">Sin grupo</option>' + groupOpts + '</select></div><div class="form-group"><label>Nota</label><select name="remark"><option value="">Sin nota</option>' + remarkOpts + '</select></div></div><div class="form-group"><label>Nombre de APP</label><input type="text" name="app_name" value="' + escapeHtml(contact.app_name || '') + '" maxlength="255"></div><div class="form-row" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;"><div class="form-group"><label>Monto</label><input type="number" name="amount" step="0.01" min="0" value="' + escapeHtml(contact.amount != null ? String(Number(contact.amount)) : '') + '"></div><div class="form-group"><label>Monto de descuento</label><input type="number" name="discount_amount" step="0.01" min="0" value="' + escapeHtml(contact.discount_amount != null ? String(Number(contact.discount_amount)) : '') + '"></div></div><div class="form-group"><label>Link de pago</label><input type="text" name="payment_link" value="' + escapeHtml(contact.payment_link || '') + '" placeholder="Ej: liga.com/pago"></div><div class="form-group"><label>Observaciones</label><textarea name="notes" rows="3">' + escapeHtml(contact.notes || '') + '</textarea></div><div class="modal-footer" style="padding:16px 0 0;"><button type="button" class="btn btn-secondary" onclick="hideModal()">Cancelar</button><button type="submit" class="btn btn-primary">Actualizar</button></div></form>');
    } catch (err) { showToast(err.message, 'error'); }
}

async function handleEditContact(event, id) {
    event.preventDefault();
    var form = event.target;
    try {
        await api('/api/contacts/' + id, { method: 'PUT', body: { name: form.name.value.trim(), phone: form.phone.value.trim(), group_id: form.group_id.value || null, remark: form.remark.value, app_name: form.app_name.value.trim(), amount: form.amount.value || 0, discount_amount: form.discount_amount.value || 0, payment_link: form.payment_link.value.trim(), notes: form.notes.value.trim() } });
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
        var templateBox = '' +
            '<a href="/api/contacts/template" download="plantilla_contactos.csv" ' +
            'style="display:flex;align-items:center;gap:12px;padding:12px 14px;margin-bottom:16px;' +
            'background:#EFF6FF;border:1px solid #BFDBFE;border-radius:10px;text-decoration:none;' +
            'transition:background .15s ease;" onmouseover="this.style.background=\'#DBEAFE\'" onmouseout="this.style.background=\'#EFF6FF\'">' +
            '<span style="display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;' +
            'border-radius:8px;background:#2563EB;color:#fff;flex-shrink:0;">' +
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>' +
            '<polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>' +
            '</span>' +
            '<span style="flex:1;line-height:1.3;">' +
            '<span style="display:block;font-size:14px;font-weight:600;color:#1E293B;">Descargar plantilla CSV</span>' +
            '<span style="display:block;font-size:12px;color:#64748B;margin-top:2px;">Columnas: name, phone, notes, remark, app_name, amount, discount_amount, payment_link</span>' +
            '</span>' +
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563EB" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><polyline points="9 18 15 12 9 6"></polyline></svg>' +
            '</a>';
        var deviceContactsBox = '';
        if (isContactPickerSupported()) {
            deviceContactsBox =
                '<button type="button" onclick="importDeviceContacts()" ' +
                'style="display:flex;align-items:center;gap:12px;width:100%;padding:12px 14px;margin-bottom:12px;' +
                'background:#ECFDF5;border:1px solid #A7F3D0;border-radius:10px;cursor:pointer;text-align:left;' +
                'transition:background .15s ease;" onmouseover="this.style.background=\'#D1FAE5\'" onmouseout="this.style.background=\'#ECFDF5\'">' +
                '<span style="display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;' +
                'border-radius:8px;background:#10B981;color:#fff;flex-shrink:0;">' +
                '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
                '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>' +
                '</span>' +
                '<span style="flex:1;line-height:1.3;">' +
                '<span style="display:block;font-size:14px;font-weight:600;color:#065F46;">Importar contactos del telefono</span>' +
                '<span style="display:block;font-size:12px;color:#047857;margin-top:2px;">Selecciona contactos de tu agenda</span>' +
                '</span>' +
                '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#059669" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><polyline points="9 18 15 12 9 6"></polyline></svg>' +
                '</button>';
        }
        showModal('Importar Contactos', deviceContactsBox + templateBox + '<p class="text-secondary mb-4" style="font-size:13px;">El archivo CSV debe tener las columnas: <strong>name, phone, notes, remark, app_name, amount, discount_amount, payment_link</strong> (las ultimas 4 son opcionales).</p><p class="text-secondary mb-4" style="font-size:12px;">Valores de <strong>remark</strong>: No contactable | Promesa de pago | Dispuesto a pagar sin fondos | No dispuesto a pagar</p><form id="import-form" onsubmit="handleImport(event)"><div class="form-group"><label>Grupo destino (opcional)</label><select name="group_id"><option value="">Sin grupo</option>' + opts + '</select></div><div class="form-group"><label>Archivo CSV</label><label class="file-input-wrap"><input type="file" name="file" accept=".csv" required onchange="document.getElementById(\'import-file-name\').textContent = this.files.length ? this.files[0].name : \'Ningun archivo seleccionado\'"><span class="file-input-btn"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg> Seleccionar archivo</span><span class="file-input-name" id="import-file-name">Ningun archivo seleccionado</span></label></div><div class="modal-footer" style="padding:16px 0 0;"><button type="button" class="btn btn-secondary" onclick="hideModal()">Cancelar</button><button type="submit" class="btn btn-primary">Importar</button></div></form>');
    });
}

// ============================================================
// Device contacts (Web Contact Picker / Capacitor native bridge)
// ============================================================
function isContactPickerSupported() {
    return !!(
        window.MobileNative ||
        (navigator.contacts && navigator.contacts.select)
    );
}

async function pickDeviceContacts() {
    if (window.MobileNative && typeof window.MobileNative.getContacts === 'function') {
        return await window.MobileNative.getContacts();
    }
    var props = ['name', 'tel'];
    if (navigator.contacts && navigator.contacts.getProperties) {
        var available = navigator.contacts.getProperties();
        props = available.filter(function(p) { return ['name','tel'].indexOf(p) !== -1; });
    }
    var selected = await navigator.contacts.select(props, { multiple: true });
    return selected.map(function(c) {
        var name = Array.isArray(c.name) ? (c.name[0] || '') : (c.name || '');
        var tels = Array.isArray(c.tel) ? c.tel : (c.tel ? [c.tel] : []);
        var phone = (tels.find(function(t) {
            return t && t.replace(/\D/g,'').length >= 7;
        }) || tels[0] || '').replace(/[\s\-()]/g,'');
        return { name: name, phone: phone, notes: '' };
    }).filter(function(r) { return r.name && r.phone; });
}
async function importDeviceContacts() {
    try {
        var contacts = await pickDeviceContacts();
        if (!contacts || !contacts.length) return;
        var rows = contacts.map(function(c) {
            var name = Array.isArray(c.name) ? (c.name[0] || '') : (c.name || '');
            var tels = Array.isArray(c.phones) ? c.phones : (c.phone ? [c.phone] : []);
            var phone = (tels.find(function(t) {
                return String(t).replace(/\D/g,'').length >= 7;
            }) || tels[0] || '').toString().replace(/[\s\-()]/g,'');
            return {
                name: String(name || c.displayName || phone).trim(),
                phone: phone,
                notes: c.notes || ''
            };
        }).filter(function(r) { return r.name && r.phone; });
        if (!rows.length) { showToast('No se obtuvieron contactos con nombre y telefono validos', 'error'); return; }
        var groupEl = document.getElementById('import-form') && document.getElementById('import-form').group_id;
        var groupId = groupEl ? groupEl.value : '';
        if (!confirm('Se importaran ' + rows.length + ' contacto(s) del telefono. Continuar?')) return;
        var result = await api('/api/contacts/import-device', {
            method: 'POST',
            body: { contacts: rows, group_id: groupId || null, remark: 'Contacto del telefono' }
        });
        hideModal();
        var created = result.created || 0;
        var skipped = result.skipped || 0;
        showToast(created + ' contacto(s) importado(s)' + (skipped ? ', ' + skipped + ' omitido(s)' : ''), created ? 'success' : 'warning');
        renderContacts(document.getElementById('page-content'));
    } catch (err) {
        if (err && (err.name === 'SecurityError' || /denegad|cancel|cancelled/i.test(err.message || ''))) return;
        showToast('No se pudo acceder a los contactos: ' + (err && err.message ? err.message : 'error'), 'error');
    }
}

async function handleImport(event) {
    event.preventDefault();
    var form = event.target;
    var formData = new FormData(form);
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
        container.innerHTML = '<div class="flex-between mb-4"><h1 style="font-size:22px;font-weight:700;">Plantillas de SMS</h1><button class="btn btn-primary btn-sm" onclick="showAddTemplateModal()"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg> Nueva Plantilla</button></div><div class="card"><div class="card-body" style="padding-bottom:0;"><div class="toolbar"><input type="text" class="search-input" placeholder="Buscar plantillas..." id="template-search" onkeyup="handleTemplateSearch(event)"></div></div><div class="table-container"><table><thead><tr><th>Nombre</th><th>Categoria</th><th>Contenido</th><th>Actualizado</th><th>Acciones</th></tr></thead><tbody>' + rows + '</tbody></table></div></div><div class="mt-4 text-secondary text-sm"><strong>Variables disponibles:</strong> <code>{nombre}</code> - Nombre, <code>{telefono}</code> - Telefono, <code>{app_name}</code> - Nombre de APP, <code>{amount}</code> - Monto, <code>{discount}</code> - Descuento, <code>{payment_link}</code> - Link de pago</div>';
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
    showModal('Nueva Plantilla', '<form onsubmit="handleAddTemplate(event)"><div class="form-group"><label>Nombre *</label><input type="text" name="name" required placeholder="Ej: Promocion de verano"></div><div class="form-group"><label>Categoria</label><select name="category"><option value="general">General</option><option value="promocion">Promocion</option><option value="recordatorio">Recordatorio</option><option value="bienvenida">Bienvenida</option><option value="otro">Otro</option></select></div><div class="form-group"><label>Contenido *</label><textarea id="tpl-content" name="content" rows="4" required placeholder="Hola {nombre}, te informamos que..."></textarea><div class="var-chips">' + variableChips('tpl-content') + '</div></div><div class="modal-footer" style="padding:16px 0 0;"><button type="button" class="btn btn-secondary" onclick="hideModal()">Cancelar</button><button type="submit" class="btn btn-primary">Crear</button></div></form>');
}

async function handleAddTemplate(event) {
    event.preventDefault(); var form = event.target;
    try { await api('/api/templates', { method: 'POST', body: { name: form.name.value.trim(), content: form.content.value.trim(), category: form.category.value } }); hideModal(); showToast('Plantilla creada', 'success'); renderTemplates(document.getElementById('page-content')); }
    catch (err) { showToast(err.message, 'error'); }
}

function showEditTemplateModal(id) {
    var t = (window._templates || []).find(function(tpl) { return tpl.id === id; });
    if (!t) return;
    showModal('Editar Plantilla', '<form onsubmit="handleEditTemplate(event, ' + id + ')"><div class="form-group"><label>Nombre *</label><input type="text" name="name" value="' + escapeHtml(t.name) + '" required></div><div class="form-group"><label>Categoria</label><select name="category"><option value="general"' + (t.category==='general'?' selected':'') + '>General</option><option value="promocion"' + (t.category==='promocion'?' selected':'') + '>Promocion</option><option value="recordatorio"' + (t.category==='recordatorio'?' selected':'') + '>Recordatorio</option><option value="bienvenida"' + (t.category==='bienvenida'?' selected':'') + '>Bienvenida</option><option value="otro"' + (t.category==='otro'?' selected':'') + '>Otro</option></select></div><div class="form-group"><label>Contenido *</label><textarea id="tpl-content" name="content" rows="4" required>' + escapeHtml(t.content) + '</textarea><div class="var-chips">' + variableChips('tpl-content') + '</div></div><div class="modal-footer" style="padding:16px 0 0;"><button type="button" class="btn btn-secondary" onclick="hideModal()">Cancelar</button><button type="submit" class="btn btn-primary">Actualizar</button></div></form>');
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
                '<div id="send-manual" class="form-group"><label>Numeros de telefono</label>' +
                    '<form class="phone-add-row" onsubmit="commitPhoneInput(); return false;">' +
                      '<input type="text" id="phone-input" inputmode="tel" enterkeyhint="done" placeholder="Escriba un numero y toque Agregar" autocomplete="off" onkeydown="handlePhoneInput(event)" oninput="onPhoneTyping(event)" onblur="schedulePhoneCommit()">' +
                      '<button type="submit" class="btn btn-primary btn-sm" id="phone-add-btn">Agregar</button>' +
                    '</form>' +
                    '<div class="phone-tags" id="phone-tags"></div>' +
                    '<small class="text-secondary">Toque Agregar o Enter para confirmar; puede separar varios con coma.</small>' +
                '</div>' +
                '<div id="send-contacts" class="form-group" style="display:none;"><label>Seleccionar contactos</label><div id="contacts-select-list" class="contact-select-list"></div></div>' +
                '<div id="send-group" class="form-group" style="display:none;"><label>Seleccionar grupo</label><select id="send-group-select" onchange="loadGroupContacts(this.value)"><option value="">-- Seleccione un grupo --</option>' + groupOpts + '</select><div id="group-contacts-preview" class="mt-2"></div></div>' +
                '<div class="form-group mt-4"><label>Plantilla (opcional)</label><select id="send-template" onchange="loadTemplateContent(this.value)"><option value="">-- Escribir mensaje personalizado --</option>' + templateOpts + '</select></div>' +
                '<div class="form-group"><label>Mensaje *</label><textarea id="send-content" rows="4" placeholder="Escriba su mensaje aqui..." oninput="updatePreview()"></textarea><div class="var-chips">' + variableChips('send-content') + '</div></div>' +
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

let phoneCommitTimer = null;
function handlePhoneInput(event) {
    if (event.key === 'Enter' || event.key === ',' || event.key === '，') {
        event.preventDefault();
        commitPhoneInput();
    }
}
function onPhoneTyping(event) {
    // When the user types a comma/semicolon, commit immediately
    var v = event.target.value;
    if (/[,;，；]/.test(v)) {
        commitPhoneInput();
        return;
    }
}
function schedulePhoneCommit() {
    // On mobile, some IMEs do not fire Enter reliably; if the field loses
    // focus while it still holds a number, we keep it ready but do NOT
    // auto-commit (the user might be tapping elsewhere intentionally).
    if (phoneCommitTimer) clearTimeout(phoneCommitTimer);
}
function commitPhoneInput() {
    var input = document.getElementById('phone-input');
    if (!input) return;
    var raw = (input.value || '').trim();
    if (!raw) return;
    // Support multiple numbers separated by comma/semicolon
    var parts = raw.split(/[,;，；\s]+/).map(function(s){return s.trim();}).filter(Boolean);
    var defaultCode = (state.user && state.user.team_country_code) || '+52';
    parts.forEach(function(part) {
        var p = normalizePhone(part, defaultCode);
        if (p && state.sendPhones.indexOf(p) === -1) state.sendPhones.push(p);
    });
    input.value = '';
    renderPhoneTags();
}
function addPhoneFromInput() {
    commitPhoneInput();
    var input = document.getElementById('phone-input');
    if (input) input.focus();
}
function renderPhoneTags() {
    var container = document.getElementById('phone-tags');
    if (!container) return;
    container.innerHTML = '';
    state.sendPhones.forEach(function(phone, i) {
        var tag = document.createElement('span');
        tag.className = 'phone-tag';
        tag.innerHTML = escapeHtml(phone) + ' <button type="button" onclick="removePhone(' + i + ')" aria-label="Quitar">&times;</button>';
        container.appendChild(tag);
    });
}
function removePhone(index) {
    state.sendPhones.splice(index, 1);
    renderPhoneTags();
}

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
        previewText.textContent = content.replace(/{nombre}/g, 'Juan').replace(/{telefono}/g, '+34 600 000 000').replace(/{app_name}/g, 'App Demo').replace(/{amount}/g, '150.00').replace(/{discount}/g, '20.00').replace(/{payment_link}/g, 'https://pago.ejemplo.com/juan');
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
    var sample = content.replace(/{nombre}/g, 'Juan').replace(/{telefono}/g, phones[0] || '').replace(/{app_name}/g, 'App Demo').replace(/{amount}/g, '150.00').replace(/{discount}/g, '20.00').replace(/{payment_link}/g, 'https://pago.ejemplo.com/juan');
    showModal('Vista Previa del Envio', '<div class="preview-box"><div class="preview-label">Mensaje (' + phones.length + ' destinatario(s))</div><div class="preview-content">' + escapeHtml(sample) + '</div></div>' + (scheduled ? '<p class="mt-2 text-secondary"><strong>Programado para:</strong> ' + new Date(scheduledAt).toLocaleString('es-ES') + '</p>' : '<p class="mt-2 text-secondary"><strong>Envio:</strong> Inmediato</p>') + '<div class="modal-footer" style="padding:16px 0 0;"><button class="btn btn-secondary" onclick="hideModal()">Cerrar</button></div>');
}

function getSendPhones() {
    if (state.sendMode === 'manual') return state.sendPhones;
    if (state.sendMode === 'contacts') {
        return Array.from(document.querySelectorAll('#contacts-select-list input[type="checkbox"]:checked')).map(function(cb) { return cb.value; });
    }
    return state.sendPhones;
}


function normalizePhone(phone, defaultCode) {
    phone = phone.replace(/[\s\-\(\)]/g, '');
    if (!phone) return '';
    // Known country codes (1-3 digits)
    var knownCodes = ['+52', '+57', '+1', '+55', '+54', '+56', '+51', '+58', '+593', '+502', '+503', '+504', '+505', '+506', '+507', '+591', '+595', '+34', '+44', '+33', '+49', '+39', '+86', '+91', '+81', '+82', '+61'];
    // Already has + prefix
    if (phone.startsWith('+')) {
        return phone;
    }
    // Starts with 00 (international prefix)
    if (phone.startsWith('00')) {
        return '+' + phone.substring(2);
    }
    // Check if starts with a known country code (without +)
    for (var i = 0; i < knownCodes.length; i++) {
        var code = knownCodes[i].substring(1); // remove +
        if (phone.startsWith(code) && phone.length > code.length + 5) {
            return '+' + phone;
        }
    }
    // No country code detected, add default
    var prefix = (defaultCode || '+52').replace('+', '');
    return '+' + prefix + phone;
}

function showBatchImportModal() {
    var defaultCode = (state.user && state.user.team_country_code) || '+52';
    showModal('Importar Numeros en Lote', 
        '<div class="form-group">' +
            '<label>Prefijo internacional (codigo de pais)</label>' +
            '<select id="batch-country-code" class="form-control">' +
                '<option value="+52"' + (defaultCode === '+52' ? ' selected' : '') + '>Mexico (+52)</option>' +
                '<option value="+57"' + (defaultCode === '+57' ? ' selected' : '') + '>Colombia (+57)</option>' +
                '<option value="+1">Estados Unidos (+1)</option>' +
                '<option value="+55">Brasil (+55)</option>' +
                '<option value="+54">Argentina (+54)</option>' +
                '<option value="+56">Chile (+56)</option>' +
                '<option value="+51">Peru (+51)</option>' +
                '<option value="+34">Espana (+34)</option>' +
            '</select>' +
            '<small class="text-secondary">Se aplicara automaticamente a numeros sin codigo de pais</small>' +
        '</div>' +
        '<div class="form-group mt-3">' +
            '<label>Archivo CSV (opcional)</label>' +
            '<input type="file" id="batch-file" accept=".csv,.txt" class="form-control">' +
            '<small class="text-secondary">Formato: una columna con encabezado "phone" o "telefono"</small>' +
        '</div>' +
        '<div class="form-group mt-3">' +
            '<label>O pegar numeros (uno por linea o separados por coma)</label>' +
            '<textarea id="batch-phones" rows="6" class="form-control" placeholder="+521234567890&#10;7226452713&#10;o: 7226452713, 226452714"></textarea>' +
        '</div>' +
        '<div class="modal-footer" style="padding:16px 0 0;">' +
            '<button type="button" class="btn btn-secondary" onclick="hideModal()">Cancelar</button>' +
            '<button type="button" class="btn btn-primary" onclick="handleBatchImport()">Importar</button>' +
        '</div>'
    );
}

function handleBatchImport() {
    var fileInput = document.getElementById('batch-file');
    var phonesText = document.getElementById('batch-phones').value.trim();
    var countryCode = document.getElementById('batch-country-code').value;
    var phones = [];
    
    // Parse text input
    if (phonesText) {
        var lines = phonesText.split(/[\n,;]+/);
        lines.forEach(function(line) {
            var phone = normalizePhone(line.trim(), countryCode);
            if (phone && phone.length >= 10 && phones.indexOf(phone) === -1) phones.push(phone);
        });
    }
    
    // Parse file if provided
    if (fileInput.files.length > 0) {
        var file = fileInput.files[0];
        var reader = new FileReader();
        reader.onload = function(e) {
            var text = e.target.result;
            var lines = text.split(/\r?\n/);
            var isHeader = true;
            lines.forEach(function(line) {
                if (isHeader) { isHeader = false; return; } // Skip header
                var parts = line.split(/[,;\t]/);
                var phone = '';
                // Try to find phone column
                for (var i = 0; i < parts.length; i++) {
                    var p = parts[i].trim();
                    if (/^[0-9\+\s\-]{7,20}$/.test(p)) {
                        phone = p;
                        break;
                    }
                }
                phone = normalizePhone(phone, countryCode);
                if (phone && phone.length >= 10 && phones.indexOf(phone) === -1) phones.push(phone);
            });
            
            // Add to send phones
            addBatchPhones(phones);
        };
        reader.readAsText(file);
    } else {
        addBatchPhones(phones);
    }
}

function addBatchPhones(phones) {
    phones.forEach(function(phone) {
        if (state.sendPhones.indexOf(phone) === -1) {
            state.sendPhones.push(phone);
        }
    });
    renderPhoneTags();
    hideModal();
    showToast(phones.length + ' numeros importados', 'success');
}

function clearAllPhones() {
    state.sendPhones = [];
    renderPhoneTags();
}

async function handleSendSMS() {
    // Make sure any number still sitting in the input is committed before sending
    commitPhoneInput();
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
            ? '<tr><td colspan="7" class="text-center text-secondary" style="padding:32px;">No hay registros</td></tr>'
            : data.records.map(function(r) {
                var apiInfo = '';
                if (r.msgid) apiInfo += '<span class="text-secondary" style="font-size:11px;">ID: ' + escapeHtml(r.msgid) + '</span>';
                if (r.api_msg) apiInfo += '<br><span class="text-secondary" style="font-size:11px;">' + escapeHtml(r.api_msg) + '</span>';
                var senderName = escapeHtml(r.sender_full_name || r.sender_username || '-');
                var senderBadge = r.sender_role === 'admin'
                    ? '<span style="display:inline-block;background:#EFF6FF;color:#1D4ED8;font-size:11px;padding:2px 8px;border-radius:999px;">' + senderName + '</span>'
                    : senderName;
                return '<tr><td class="text-sm text-secondary">' + formatDate(r.created_at) + '</td><td class="text-sm" style="white-space:nowrap;">' + senderBadge + '</td><td>' + escapeHtml(r.phone) + '</td><td>' + escapeHtml(r.contact_name || '-') + '</td><td class="text-sm" style="max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + escapeHtml(r.content) + '">' + escapeHtml(r.content) + '</td><td>' + getStatusBadge(r.status) + '</td><td class="text-sm">' + (apiInfo || '<span class="text-secondary">-</span>') + '</td></tr>';
            }).join('');

        container.innerHTML =
            '<h1 class="mb-4" style="font-size:22px;font-weight:700;">Registros de Envio</h1>' +
            '<div class="card"><div class="card-body" style="padding-bottom:0;"><div class="toolbar"><div style="display:flex;gap:8px;flex:1;"><input type="text" class="search-input" placeholder="Buscar por numero, nombre, usuario o contenido..." value="' + escapeHtml(state.records.search) + '" onkeyup="handleRecordSearch(event)" style="flex:1;"><button onclick="triggerRecordSearch()" style="padding:8px 16px;background:#2563EB;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:14px;">Buscar</button></div><select onchange="handleRecordStatusFilter(this.value)"><option value="">Todos los estados</option><option value="sent"' + (state.records.status==='sent'?' selected':'') + '>Enviado</option><option value="failed"' + (state.records.status==='failed'?' selected':'') + '>Fallido</option><option value="pending"' + (state.records.status==='pending'?' selected':'') + '>Pendiente</option><option value="scheduled"' + (state.records.status==='scheduled'?' selected':'') + '>Programado</option></select><input type="date" lang="es" value="' + state.records.dateFrom + '" onchange="handleRecordDateFrom(this.value)" title="Fecha desde"><input type="date" lang="es" value="' + state.records.dateTo + '" onchange="handleRecordDateTo(this.value)" title="Fecha hasta"></div></div><div class="table-container"><table><thead><tr><th>Fecha</th><th>Usuario</th><th>Telefono</th><th>Nombre</th><th>Contenido</th><th>Estado</th><th>Detalles API</th></tr></thead><tbody>' + rows + '</tbody></table></div>' + renderPagination(data, 'records') + '</div>';
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
            ? '<tr><td colspan="7" class="text-center text-secondary" style="padding:32px;">No se encontraron mensajes con ese contenido</td></tr>'
            : data.records.map(function(r) {
                var highlightContent = state.contentSearch.keyword ? highlightText(r.content, state.contentSearch.keyword) : escapeHtml(r.content);
                var senderName = escapeHtml(r.sender_full_name || r.sender_username || '-');
                var senderBadge = r.sender_role === 'admin'
                    ? '<span style="display:inline-block;background:#EFF6FF;color:#1D4ED8;font-size:11px;padding:2px 8px;border-radius:999px;">' + senderName + '</span>'
                    : senderName;
                return '<tr><td class="text-sm text-secondary">' + formatDate(r.created_at) + '</td><td class="text-sm" style="white-space:nowrap;">' + senderBadge + '</td><td>' + escapeHtml(r.phone) + '</td><td>' + escapeHtml(r.contact_name || '-') + '</td><td class="text-sm" style="max-width:300px;">' + highlightContent + '</td><td>' + getStatusBadge(r.status) + '</td><td class="text-sm">' + (r.api_msg ? '<span class="text-secondary" style="font-size:11px;">' + escapeHtml(r.api_msg) + '</span>' : '<span class="text-secondary">-</span>') + '</td></tr>';
            }).join('');

        container.innerHTML =
            '<h1 class="mb-4" style="font-size:22px;font-weight:700;">Buscar por Contenido</h1>' +
            '<div class="card"><div class="card-body" style="padding-bottom:0;"><div class="toolbar"><input type="text" class="search-input" placeholder="Ingrese palabra clave del mensaje o nombre de usuario..." value="' + escapeHtml(state.contentSearch.keyword) + '" onkeyup="handleContentSearch(event)" style="flex:2;"><input type="date" lang="es" value="' + state.contentSearch.dateFrom + '" onchange="handleContentDateFrom(this.value)" title="Fecha desde"><input type="date" lang="es" value="' + state.contentSearch.dateTo + '" onchange="handleContentDateTo(this.value)" title="Fecha hasta"><button class="btn btn-secondary btn-sm" onclick="clearContentSearch()">Limpiar</button></div></div><div class="table-container"><table><thead><tr><th>Fecha</th><th>Usuario</th><th>Telefono</th><th>Nombre</th><th>Contenido</th><th>Estado</th><th>Detalles</th></tr></thead><tbody>' + rows + '</tbody></table></div>' + renderPagination(data, 'contentSearch') + '</div>';
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
            // Bulk-deletable: same rule as delete button
            var bulkDeletable = canEdit;
            var checkbox = bulkDeletable ? '<input type="checkbox" class="user-row-check" data-id="' + u.id + '" data-username="' + escapeHtml(u.username) + '" onchange="onBulkUserSelect()" style="width:16px;height:16px;accent-color:var(--primary);cursor:pointer;">' : '';
            var editBtn = canEdit ? '<button class="btn btn-ghost btn-sm btn-icon" onclick="showEditUserModal(' + u.id + ')" title="Editar"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button>' : '';
            var roleBtn = (myRole === 'admin' && u.role !== 'admin') ? '<button class="btn btn-ghost btn-sm btn-icon" onclick="showRoleModal(' + u.id + ', \'' + u.role + '\')" title="Cambiar Rol" style="color:var(--primary);"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg></button>' : '';
            var deleteBtn = canEdit ? '<button class="btn btn-ghost btn-sm btn-icon" onclick="deleteUser(' + u.id + ')" title="Eliminar" style="color:var(--danger);"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>' : '';
            var teamCell = u.team_affiliation ? '<span class="text-sm">' + escapeHtml(u.team_affiliation) + '</span>' : '<span class="text-sm text-secondary">-</span>';
            var extCell = u.extnumber ? '<span class="badge badge-blue" title="Extension/telefono fijo asignado">' + escapeHtml(u.extnumber) + '</span>' : '<span class="text-sm text-secondary">-</span>';
            var countryLabels = {mx: 'Mexico', co: 'Colombia', pe: 'Peru'};
            var countryCell = u.country ? '<span class="text-sm">' + escapeHtml(countryLabels[u.country] || u.country) + '</span>' : '<span class="text-sm text-secondary">-</span>';
            var categoryCell = '<span class="text-sm text-secondary">-</span>';
            if (myRole === 'admin' || myRole === 'team_admin') {
                if (u.category_name) {
                    categoryCell = '<span class="badge badge-gray">' + escapeHtml(u.category_name) + ' · ' + retentionLabel(u.category_retention_days) + '</span>';
                } else {
                    categoryCell = '<span class="text-sm text-secondary">Por defecto</span>';
                }
            }
            return '<tr><td style="width:40px;">' + checkbox + '</td><td><strong>' + escapeHtml(u.username) + '</strong></td><td>' + escapeHtml(u.full_name || '-') + '</td><td><span class="badge ' + (ROLE_BADGE[u.role]||'badge-gray') + '">' + escapeHtml(ROLE_LABELS[u.role]||u.role) + '</span></td><td>' + teamCell + '</td><td>' + extCell + '</td><td>' + countryCell + '</td>' + ((myRole === 'admin' || myRole === 'team_admin') ? '<td>' + categoryCell + '</td>' : '') + '<td><span class="badge ' + (u.is_active ? 'badge-green' : 'badge-red') + '">' + (u.is_active ? 'Activo' : 'Desactivado') + '</span></td><td class="text-sm text-secondary">' + formatDate(u.created_at) + '</td><td style="white-space:nowrap;">' + editBtn + roleBtn + deleteBtn + '</td></tr>';
        }).join('');

        // Role filter options based on current user role
        var roleOptions = '<option value="">Todos los roles</option>';
        if (myRole === 'admin') {
            roleOptions += '<option value="admin">Administrador del Sistema</option><option value="team_admin">Administrador de Equipo</option><option value="team_member">Miembro de Equipo</option>';
        } else {
            roleOptions += '<option value="team_member">Miembro de Equipo</option>';
        }

        var userCols = (myRole === 'admin' || myRole === 'team_admin') ? 11 : 10;
        container.innerHTML = '<div class="flex-between mb-4"><div><h1 style="font-size:22px;font-weight:700;">' + title + '</h1><p class="text-secondary" style="margin-top:4px;">' + desc + '</p></div><div style="display:flex;gap:8px;flex-wrap:wrap;"><button class="btn btn-secondary btn-sm" onclick="showBulkCreateModal()"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="12" y1="18" x2="12" y2="12"></line><line x1="9" y1="15" x2="15" y2="15"></line></svg> Creacion Masiva</button><button class="btn btn-secondary btn-sm" onclick="showBulkImportModal()"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg> Importar Excel</button><button class="btn btn-secondary btn-sm" onclick="showBulkPasswordModal()"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"></path></svg> Clave Masiva</button><button class="btn btn-secondary btn-sm" onclick="exportUsers()"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg> Exportar</button><button class="btn btn-danger btn-sm" id="bulk-delete-btn" onclick="bulkDeleteUsers()" disabled style="opacity:0.5;cursor:not-allowed;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg> Eliminar (<span id="bulk-selected-count">0</span>)</button><button class="btn btn-primary btn-sm" onclick="showAddUserModal()"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg> Nuevo</button></div></div><div id="bulk-action-bar" class="card mb-3" style="display:none;padding:10px 16px;background:var(--light-blue);border-color:var(--primary);"></div><div class="card mb-3"><div style="display:flex;gap:12px;align-items:center;padding:12px 16px;flex-wrap:wrap;"><div style="flex:1;min-width:200px;position:relative;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--text-secondary);"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg><input type="text" id="user-search" class="form-control" placeholder="Buscar por usuario o nombre..." value="' + escapeHtml(searchVal) + '" style="padding-left:36px;" oninput="debounceRenderUsers()"></div><select id="user-role-filter" class="form-control" style="width:auto;min-width:180px;" onchange="renderUsers(document.getElementById(\'page-content\'))">' + roleOptions + '</select></div></div><div class="card"><div class="table-container"><table><thead><tr><th style="width:40px;"><input type="checkbox" id="user-select-all" onchange="toggleAllUsers(this)" style="width:16px;height:16px;accent-color:var(--primary);cursor:pointer;"></th><th>Usuario</th><th>Nombre Completo</th><th>Rol</th><th>Equipo</th><th>Extension</th><th>Pais</th>' + (userCols === 11 ? '<th>Categoria</th>' : '') + '<th>Estado</th><th>Creado</th><th>Acciones</th></tr></thead><tbody>' + (rows || '<tr><td colspan="' + userCols + '" class="empty-state">Sin usuarios</td></tr>') + '</tbody></table></div></div>';
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

async function showAddUserModal() {
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
    // Fetch API configs for team_admin creation
    var apiConfigHtml = '';
    if (myRole === 'admin' || (state.user.permissions || []).includes('team-api-select')) {
        try {
            var configsData = await api('/api/config/sms');
            var configs = configsData.configs || [];
            var configOptions = configs.map(function(c) {
                return '<option value="' + c.id + '">' + escapeHtml(c.name) + ' (' + escapeHtml(c.country) + ')</option>';
            }).join('');
            apiConfigHtml = '<div class="form-group"><label>Configuracion API (Pais) *</label><select name="api_config_id" required><option value="">Seleccionar pais...</option>' + configOptions + '</select><small class="text-secondary">Cada equipo usa la API de un solo pais. Esta configuracion no se puede cambiar despues.</small></div>';
        } catch (e) {
            apiConfigHtml = '<div class="form-group"><label>Configuracion API (Pais)</label><p class="text-secondary">No hay configuraciones API disponibles</p></div>';
        }
    }
    var countryFieldHtml = '<div class="form-group"><label>Pais del agente</label><select name="country"><option value="">Sin pais especifico</option><option value="mx">Mexico</option><option value="co">Colombia</option><option value="pe">Peru</option></select><small class="text-secondary">Define de que pool de extensiones se asigna (Mexico/Colombia/Peru).</small></div>';
    var extFieldHtml = '<div class="form-group"><label style="display:flex;align-items:center;gap:8px;cursor:pointer;"><input type="checkbox" name="assign_extension" style="width:16px;height:16px;accent-color:var(--primary);"><span>Asignar una extension/telefono automaticamente</span></label><small class="text-secondary">El sistema elige una extension libre del pool del pais seleccionado. No se permite escribir el numero manualmente; si no hay extensiones libres, pida al administrador del sistema que agregue mas.</small></div>';
    var categoryHtml = await categoryFieldHtml(null);
    showModal('Nuevo Usuario', '<form onsubmit="handleAddUser(event)"><div class="form-group"><label>Nombre de usuario *</label><input type="text" name="username" required></div><div class="form-group"><label>Nombre completo</label><input type="text" name="full_name"></div><div class="form-group"><label>Contrasena *</label><input type="password" name="password" required minlength="6"><small class="text-secondary">Minimo 6 caracteres</small></div><div class="form-group"><label>Rol</label><select name="role" id="add-user-role" onchange="toggleApiConfig()">' + roleOptions + '</select><small class="text-secondary">' + infoText + '</small></div>' + apiConfigHtml + countryFieldHtml + categoryHtml + extFieldHtml + '<div class="modal-footer" style="padding:16px 0 0;"><button type="button" class="btn btn-secondary" onclick="hideModal()">Cancelar</button><button type="submit" class="btn btn-primary">Crear</button></div></form>');
}

// Cache de categorias para los formularios de usuario (solo admin las asigna).
var _userCategoriesCache = null;
async function loadUserCategories() {
    if (_userCategoriesCache) return _userCategoriesCache;
    try {
        var d = await api('/api/user-categories');
        _userCategoriesCache = d.categories || [];
    } catch (e) {
        _userCategoriesCache = [];
    }
    return _userCategoriesCache;
}

async function categoryFieldHtml(selectedId) {
    if (state.user.role !== 'admin' && state.user.role !== 'team_admin') return '';
    var cats = await loadUserCategories();
    if (!cats.length) return '';
    var options = cats.map(function(c) {
        var sel = (parseInt(selectedId, 10) === c.id) ? ' selected' : '';
        var label = c.name + ' (' + retentionLabel(c.retention_days) + ')';
        return '<option value="' + c.id + '"' + sel + '>' + escapeHtml(label) + '</option>';
    }).join('');
    return '<div class="form-group"><label>Categoria de empleado</label><select name="category_id"><option value="">Por defecto</option>' + options + '</select><small class="text-secondary">Define cuantos dias se conservan los contactos de este empleado. Se configura en "Retencion de Contactos".</small></div>';
}

function toggleApiConfig() {
    var roleSelect = document.getElementById('add-user-role');
    var apiSelect = document.querySelector('select[name="api_config_id"]');
    if (apiSelect) {
        apiSelect.required = (roleSelect.value === 'team_admin');
    }
}

async function handleAddUser(event) {
    event.preventDefault(); var form = event.target;
    var body = { username: form.username.value.trim(), full_name: form.full_name.value.trim(), password: form.password.value, role: form.role.value, country: form.country ? form.country.value : '', assign_extension: !!form.assign_extension.checked };
    if (form.category_id) { body.category_id = form.category_id.value ? parseInt(form.category_id.value) : null; }
    var apiConfigSelect = form.querySelector('select[name="api_config_id"]');
    if (apiConfigSelect && apiConfigSelect.value) {
        body.api_config_id = parseInt(apiConfigSelect.value);
    }
    try { await api('/api/users', { method: 'POST', body: body }); hideModal(); showToast('Usuario creado', 'success'); _userCategoriesCache = null; renderUsers(document.getElementById('page-content')); }
    catch (err) { showToast(err.message, 'error'); }
}

async function showEditUserModal(id) {
    var u = (window._users || []).find(function(usr) { return usr.id === id; });
    if (!u) return;
    var extHtml;
    if (u.extnumber) {
        extHtml = '<div class="form-group"><label>Extension / Telefono asignado</label><div style="display:flex;align-items:center;gap:10px;"><span class="badge badge-blue" style="font-size:14px;padding:6px 12px;">' + escapeHtml(u.extnumber) + '</span><button type="button" class="btn btn-secondary btn-sm" onclick="releaseUserExtension(' + id + ')">Liberar extension</button></div><small class="text-secondary">El numero lo asigna el sistema y no se puede editar manualmente.</small></div>';
    } else {
        extHtml = '<div class="form-group"><label style="display:flex;align-items:center;gap:8px;cursor:pointer;"><input type="checkbox" name="assign_extension" style="width:16px;height:16px;accent-color:var(--primary);"><span>Asignar una extension/telefono automaticamente</span></label><small class="text-secondary">El sistema elige una extension libre del pool del pais. Si no hay disponibles, pida al administrador del sistema que agregue mas.</small></div>';
    }
    var currentCountry = u.country || '';
    var countryHtml = '<div class="form-group"><label>Pais del agente</label><select name="country"><option value=""' + (!currentCountry?' selected':'') + '>Sin pais especifico</option><option value="mx"' + (currentCountry==='mx'?' selected':'') + '>Mexico</option><option value="co"' + (currentCountry==='co'?' selected':'') + '>Colombia</option><option value="pe"' + (currentCountry==='pe'?' selected':'') + '>Peru</option></select><small class="text-secondary">Define de que pool se asigna la extension. Cambiar de pais no reasigna la extension actual (liberela primero si necesita otra).</small></div>';
    var categoryHtml = await categoryFieldHtml(u.category_id);
    showModal('Editar Usuario', '<form onsubmit="handleEditUser(event, ' + id + ')"><div class="form-group"><label>Nombre de usuario</label><input type="text" value="' + escapeHtml(u.username) + '" disabled style="background:var(--bg);"></div><div class="form-group"><label>Rol</label><input type="text" value="' + escapeHtml(ROLE_LABELS[u.role]||u.role) + '" disabled style="background:var(--bg);"><small class="text-secondary">El rol no se puede cambiar despues de la creacion</small></div><div class="form-group"><label>Nombre completo</label><input type="text" name="full_name" value="' + escapeHtml(u.full_name || '') + '"></div>' + countryHtml + categoryHtml + extHtml + '<div class="form-group"><label>Nueva contrasena (dejar vacio para no cambiar)</label><input type="password" name="password" minlength="6"></div><div class="form-group"><label>Estado</label><select name="is_active"><option value="1"' + (u.is_active?' selected':'') + '>Activo</option><option value="0"' + (!u.is_active?' selected':'') + '>Desactivado</option></select></div><div class="modal-footer" style="padding:16px 0 0;"><button type="button" class="btn btn-secondary" onclick="hideModal()">Cancelar</button><button type="submit" class="btn btn-primary">Actualizar</button></div></form>');
}

async function handleEditUser(event, id) {
    event.preventDefault(); var form = event.target;
    try {
        var body = { full_name: form.full_name.value.trim(), country: form.country.value, is_active: parseInt(form.is_active.value) };
        if (form.password.value) body.password = form.password.value;
        if (form.assign_extension) body.assign_extension = !!form.assign_extension.checked;
        if (form.category_id) { body.category_id = form.category_id.value ? parseInt(form.category_id.value) : null; }
        await api('/api/users/' + id, { method: 'PUT', body: body });
        hideModal(); showToast('Usuario actualizado', 'success'); _userCategoriesCache = null; renderUsers(document.getElementById('page-content'));
    } catch (err) { showToast(err.message, 'error'); }
}

async function releaseUserExtension(id) {
    if (!confirm('Seguro que deseas liberar la extension/telefono de este usuario? Volvera al pool y quedara disponible para otro agente.')) return;
    try {
        await api('/api/users/' + id, { method: 'PUT', body: { release_extension: true } });
        hideModal(); showToast('Extension liberada', 'success'); renderUsers(document.getElementById('page-content'));
    } catch (err) { showToast(err.message, 'error'); }
}

// Permission menu items definition
var PERM_ITEMS = [
    { key: 'dashboard', label: 'Panel Principal', icon: 'grid' },
    { key: 'contacts', label: 'Contactos', icon: 'users' },
    { key: 'groups', label: 'Grupos', icon: 'folder' },
    { key: 'templates', label: 'Plantillas', icon: 'file' },
    { key: 'send', label: 'Enviar SMS', icon: 'send' },
    { key: 'records', label: 'Registros SMS', icon: 'activity' },
    { key: 'calls', label: 'Llamadas (Voz)', icon: 'phone' },
    { key: 'content-search', label: 'Buscar Contenido', icon: 'search' },
    { key: 'users', label: 'Usuarios', icon: 'user-plus' },
    { key: 'my-account', label: 'Mi Cuenta', icon: 'user' },
    { key: 'my-team', label: 'Mi Equipo', icon: 'users' },
    { key: 'all-teams', label: 'Todos los Equipos', icon: 'bar-chart' },
    { key: 'config', label: 'Configuracion API SMS', icon: 'settings' },
    { key: 'voice-config', label: 'Configuracion Voz', icon: 'settings' },
    { key: 'extensions', label: 'Extensiones', icon: 'phone' },
    { key: 'retention', label: 'Retencion de Contactos', icon: 'shield' },
    { key: 'team-api-select', label: 'Seleccionar API de Equipo', icon: 'server' }
];

function showPermModal(id) {
    var u = (window._users || []).find(function(usr) { return usr.id === id; });
    if (!u) return;
    var currentPerms = u.permissions || [];
    var checkboxes = PERM_ITEMS.map(function(item) {
        var checked = currentPerms.indexOf(item.key) !== -1 ? ' checked' : '';
        return '<label style="display:flex;align-items:center;gap:8px;padding:8px 0;cursor:pointer;border-bottom:1px solid var(--border);"><input type="checkbox" value="' + item.key + '"' + checked + ' style="width:16px;height:16px;accent-color:var(--primary);"><span style="font-size:14px;">' + item.label + '</span></label>';
    }).join('');
    showModal('Permisos de ' + escapeHtml(u.username), '<div style="padding:8px 0;"><p style="font-size:13px;color:var(--text-secondary);margin-bottom:12px;">Selecciona los modulos a los que este usuario puede acceder:</p><div id="perm-checkboxes">' + checkboxes + '</div><div style="margin-top:12px;display:flex;gap:8px;"><button class="btn btn-secondary btn-sm" onclick="toggleAllPerms(true)">Seleccionar todo</button><button class="btn btn-secondary btn-sm" onclick="toggleAllPerms(false)">Deseleccionar todo</button></div></div><div class="modal-footer" style="padding:16px 0 0;"><button type="button" class="btn btn-secondary" onclick="hideModal()">Cancelar</button><button class="btn btn-primary" onclick="savePerms(' + id + ')">Guardar</button></div>');
}

function toggleAllPerms(check) {
    document.querySelectorAll('#perm-checkboxes input[type="checkbox"]').forEach(function(cb) { cb.checked = check; });
}

async function savePerms(id) {
    var checked = [];
    document.querySelectorAll('#perm-checkboxes input[type="checkbox"]:checked').forEach(function(cb) { checked.push(cb.value); });
    try {
        await api('/api/permissions/' + id, { method: 'PUT', body: { permissions: checked } });
        hideModal(); showToast('Permisos actualizados', 'success'); renderUsers(document.getElementById('page-content'));
    } catch (err) { showToast(err.message, 'error'); }
}

async function deleteUser(id) {
    if (!confirm('Esta seguro de eliminar este usuario?')) return;
    try { await api('/api/users/' + id, { method: 'DELETE' }); showToast('Usuario eliminado', 'success'); renderUsers(document.getElementById('page-content')); }
    catch (err) { showToast(err.message, 'error'); }
}

// ============================================================
// Bulk user operations
// ============================================================
function getSelectedUsers() {
    var checks = document.querySelectorAll('.user-row-check:checked');
    return Array.prototype.map.call(checks, function(cb) {
        return { id: parseInt(cb.getAttribute('data-id')), username: cb.getAttribute('data-username') };
    });
}

function onBulkUserSelect() {
    updateBulkSelectionUI();
}

function toggleAllUsers(master) {
    document.querySelectorAll('.user-row-check').forEach(function(cb) { cb.checked = master.checked; });
    updateBulkSelectionUI();
}

function updateBulkSelectionUI() {
    var selected = getSelectedUsers();
    var countEl = document.getElementById('bulk-selected-count');
    var btn = document.getElementById('bulk-delete-btn');
    if (countEl) countEl.textContent = selected.length;
    if (btn) {
        if (selected.length > 0) {
            btn.disabled = false;
            btn.style.opacity = '1';
            btn.style.cursor = 'pointer';
        } else {
            btn.disabled = true;
            btn.style.opacity = '0.5';
            btn.style.cursor = 'not-allowed';
        }
    }
    // Sync master checkbox state
    var all = document.querySelectorAll('.user-row-check');
    var master = document.getElementById('user-select-all');
    if (master && all.length) {
        master.checked = selected.length === all.length;
    }
}

async function bulkDeleteUsers() {
    var selected = getSelectedUsers();
    if (!selected.length) { showToast('Selecciona al menos un usuario', 'error'); return; }
    if (!confirm('Esta seguro de eliminar ' + selected.length + ' usuario(s)? Esta accion no se puede deshacer.')) return;
    var ids = selected.map(function(u) { return u.id; });
    try {
        var result = await api('/api/users/bulk-delete', { method: 'POST', body: { ids: ids } });
        var msg = 'Eliminados: ' + result.deleted_count;
        if (result.error_count > 0) msg += '. Errores: ' + result.error_count;
        showToast(msg, result.error_count > 0 ? 'error' : 'success');
        renderUsers(document.getElementById('page-content'));
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function showBulkCreateModal() {
    var myRole = state.user.role;
    if (myRole !== 'admin' && myRole !== 'team_admin') { showToast('Permisos insuficientes', 'error'); return; }

    // For admin, fetch API configs (country selection)
    var apiConfigHtml = '';
    if (myRole === 'admin') {
        try {
            var configsData = await api('/api/config/sms');
            var configs = configsData.configs || [];
            var configOptions = configs.map(function(c) {
                return '<option value="' + c.id + '">' + escapeHtml(c.name) + ' (' + escapeHtml(c.country) + ')</option>';
            }).join('');
            apiConfigHtml = '<div class="form-group"><label>Configuracion API (Pais) para todos los nuevos equipos *</label><select name="api_config_id" id="bulk-api-config" required><option value="">Seleccionar pais...</option>' + configOptions + '</select><small class="text-secondary">El Administrador del Sistema crea Administradores de Equipo. Cada equipo se asocia a la API de un pais.</small></div>';
        } catch (e) {
            apiConfigHtml = '<div class="form-group"><label>Configuracion API</label><p class="text-secondary">No hay configuraciones API disponibles</p></div>';
        }
    }

    var defaultPwdMsg = myRole === 'admin'
        ? 'Se crearan Administradores de Equipo.'
        : 'Se crearan Miembros de Equipo bajo tu gestion.';

    showModal('Creacion Masiva de Usuarios',
        '<form onsubmit="handleBulkCreate(event)">' +
            '<div style="margin-bottom:12px;">' +
                '<a href="/api/users/template" download="plantilla_usuarios.xlsx" class="btn btn-secondary" style="font-size:13px;padding:6px 12px;">⬇ Descargar plantilla Excel</a>' +
            '</div>' +
            '<div class="form-group"><label>Pais por defecto (para asignar extensiones)</label>' +
                '<select id="bulk-country" style="max-width:280px;"><option value="">Sin pais especifico</option><option value="mx">Mexico</option><option value="co">Colombia</option><option value="pe">Peru</option></select>' +
                '<small class="text-secondary">Cada nuevo usuario se asocia a este pais para tomar una extension del pool correspondiente. Puede indicar el pais por linea como 4a columna (mx/co/pe), que tiene prioridad.</small>' +
            '</div>' +
            '<div class="form-group"><label>Lista de usuarios *</label>' +
                '<textarea name="users_text" id="bulk-users-text" rows="10" style="width:100%;font-family:monospace;font-size:13px;" placeholder="usuario,contrasena,nombre_completo,pais&#10;jperez,,Juan Perez,mx&#10;mlopez,,Maria Lopez,co&#10;garcia,,," required></textarea>' +
                '<small class="text-secondary">Formato: <strong>usuario,contrasena,nombre_completo,pais</strong> (una linea por usuario). Solo el <strong>usuario es obligatorio</strong>; contrasena, nombre y pais son opcionales. El pais acepta mx/co/pe. Las <strong>extensiones no se indican aqui</strong>: se asignan automaticamente marcando la opcion inferior. Si omite la contrasena se genera automaticamente una clave de 10 caracteres alfanumericos.' +
                '<br>Descargue la plantilla Excel o pegue datos desde Excel/CSV (use coma como separador).</small>' +
            '</div>' +
            '<div class="form-group"><label>Contrasena por defecto (opcional)</label>' +
                '<input type="text" name="default_password" id="bulk-default-pwd" placeholder="Se usa cuando la linea no trae contrasena" minlength="6">' +
                '<small class="text-secondary">Si una linea solo tiene usuario (o usuario,nombre), se asignara esta contrasena.</small>' +
            '</div>' +
            '<div class="form-group"><label style="display:flex;align-items:center;gap:8px;cursor:pointer;"><input type="checkbox" id="bulk-assign-ext" style="width:16px;height:16px;accent-color:var(--primary);"><span>Asignar automaticamente una extension/telefono a cada usuario</span></label><small class="text-secondary">El sistema elige una extension libre del pool del pais para cada usuario nuevo. Si no hay suficientes extensiones, las filas restantes se marcan como error para que el administrador agregue mas.</small></div>' +
            apiConfigHtml +
            '<div style="background:var(--light-blue);padding:10px 12px;border-radius:8px;font-size:13px;color:var(--text-secondary);margin-bottom:12px;">' + defaultPwdMsg + ' Maximo 500 usuarios por carga.</div>' +
            '<div id="bulk-result" style="display:none;margin-bottom:12px;"></div>' +
            '<div class="modal-footer" style="padding:16px 0 0;">' +
                '<button type="button" class="btn btn-secondary" onclick="hideModal()">Cancelar</button>' +
                '<button type="submit" class="btn btn-primary" id="bulk-create-submit">Crear Usuarios</button>' +
            '</div>' +
        '</form>'
    );
}

function normalizeCountryInput(val) {
    if (!val) return '';
    var v = String(val).trim().toLowerCase();
    if (!v) return '';
    if (['mx', 'mexico', 'méxico', 'mex', '52', '+52'].indexOf(v) >= 0) return 'mx';
    if (['co', 'colombia', 'col', '57', '+57'].indexOf(v) >= 0) return 'co';
    if (['pe', 'peru', 'perú', 'per', '51', '+51'].indexOf(v) >= 0) return 'pe';
    return '';
}

function parseBulkUsersText(text, defaultPassword, defaultCountry) {
    var users = [];
    var errors = [];
    var lines = text.split(/\r?\n/);
    var country = normalizeCountryInput(defaultCountry);
    lines.forEach(function(line, idx) {
        var trimmed = line.trim();
        if (!trimmed) return;
        // Support comma or tab or semicolon separated
        var parts = trimmed.split(/[,;\t]/).map(function(p) { return p.trim(); });
        var username = parts[0] || '';
        var password = parts[1] || defaultPassword || '';
        // The 3rd field is the full name; the 4th (optional) is the country.
        // Extensions are never read from text (auto-allocated by the system).
        var full_name = parts[2] || '';
        var lineCountry = normalizeCountryInput(parts[3]) || country;
        if (!username) {
            errors.push({ line: idx + 1, error: 'Usuario vacio' });
            return;
        }
        if (!password || password.length < 6) {
            errors.push({ line: idx + 1, username: username, error: 'Contrasena minima de 6 caracteres' });
            return;
        }
        users.push({ username: username, password: password, full_name: full_name, country: lineCountry });
    });
    return { users: users, errors: errors };
}

async function handleBulkCreate(event) {
    event.preventDefault();
    var form = event.target;
    var text = document.getElementById('bulk-users-text').value;
    var defaultPassword = document.getElementById('bulk-default-pwd').value.trim();
    var defaultCountry = document.getElementById('bulk-country') ? document.getElementById('bulk-country').value : '';
    var apiConfigSelect = document.getElementById('bulk-api-config');
    var apiConfigId = apiConfigSelect ? parseInt(apiConfigSelect.value) : null;
    var assignExtensions = document.getElementById('bulk-assign-ext') ? document.getElementById('bulk-assign-ext').checked : false;

    var parsed = parseBulkUsersText(text, defaultPassword, defaultCountry);

    var resultEl = document.getElementById('bulk-result');
    function showResult(html, type) {
        resultEl.style.display = 'block';
        resultEl.style.padding = '10px 12px';
        resultEl.style.borderRadius = '8px';
        resultEl.style.fontSize = '13px';
        resultEl.style.background = type === 'error' ? '#FEE2E2' : '#ECFDF5';
        resultEl.style.color = type === 'error' ? 'var(--danger)' : 'var(--success)';
        resultEl.innerHTML = html;
    }

    if (parsed.errors.length) {
        var errHtml = '<strong>Errores en el formato:</strong><ul style="margin:6px 0 0;padding-left:18px;">' +
            parsed.errors.map(function(e) { return '<li>Linea ' + e.line + (e.username ? ' (' + escapeHtml(e.username) + ')' : '') + ': ' + escapeHtml(e.error) + '</li>'; }).join('') +
            '</ul>';
        showResult(errHtml, 'error');
        return;
    }
    if (!parsed.users.length) {
        showResult('No se encontraron usuarios validos.', 'error');
        return;
    }

    var submitBtn = document.getElementById('bulk-create-submit');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Creando...';

    try {
        var body = { users: parsed.users, assign_extensions: assignExtensions };
        if (apiConfigId) body.api_config_id = apiConfigId;
        if (defaultCountry) body.country = defaultCountry;
        var result = await api('/api/users/bulk', { method: 'POST', body: body });
        var html = '<strong>Creacion completada.</strong> Creados: ' + result.created_count + '.';
        if (assignExtensions && result.created && result.created.length) {
            var assigned = result.created.filter(function(u){ return u.extnumber; });
            if (assigned.length) {
                html += '<br><small>Extensiones asignadas: ' + assigned.map(function(u){ return escapeHtml(u.username) + '→' + escapeHtml(u.extnumber); }).join(', ') + '</small>';
            }
        }
        if (result.error_count > 0) {
            html += ' Errores: ' + result.error_count + '<ul style="margin:6px 0 0;padding-left:18px;">' +
                result.errors.map(function(e) { return '<li>' + escapeHtml(e.username || ('#' + e.index)) + ': ' + escapeHtml(e.error) + '</li>'; }).join('') + '</ul>';
        }
        showResult(html, result.error_count > 0 ? 'error' : 'success');
        showToast('Usuarios creados: ' + result.created_count, result.error_count > 0 ? 'error' : 'success');
        if (result.created_count > 0) {
            // Refresh user list in background after a short delay
            setTimeout(function() { renderUsers(document.getElementById('page-content')); }, 800);
        }
    } catch (err) {
        showResult('Error: ' + escapeHtml(err.message), 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Crear Usuarios';
    }
}

async function showBulkImportModal() {
    var myRole = state.user.role;
    if (myRole !== 'admin' && myRole !== 'team_admin') { showToast('Permisos insuficientes', 'error'); return; }
    var apiConfigHtml = '';
    if (myRole === 'admin') {
        try {
            var configsData = await api('/api/config/sms');
            var configs = configsData.configs || [];
            var options = configs.map(function(c) {
                return '<option value="' + c.id + '">' + escapeHtml(c.name) + ' (' + escapeHtml(c.country) + ')</option>';
            }).join('');
            apiConfigHtml = '<div class="form-group"><label>Configuracion API (Pais) *</label><select name="api_config_id" id="bulk-import-api-config" required><option value="">Seleccionar pais...</option>' + options + '</select><small class="text-secondary">Se crearan Administradores de Equipo asociados a este pais.</small></div>';
        } catch (e) {
            apiConfigHtml = '<div class="form-group"><label>Configuracion API</label><p class="text-secondary">No hay configuraciones API disponibles</p></div>';
        }
    }

    showModal('Importar Usuarios desde Excel',
        '<form onsubmit="handleBulkImport(event)" enctype="multipart/form-data">' +
            '<div class="form-group">' +
                '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">' +
                    '<label style="margin:0;">Archivo Excel (.xlsx) *</label>' +
                    '<a href="/api/users/template" download="plantilla_usuarios.xlsx" style="font-size:12px;font-weight:500;color:var(--primary);text-decoration:none;display:inline-flex;align-items:center;gap:4px;">' +
                        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>' +
                        'Descargar plantilla' +
                    '</a>' +
                '</div>' +
                '<input type="file" name="users_file" id="bulk-import-file" accept=".xlsx" required style="padding:8px;border:1px solid var(--border);border-radius:8px;width:100%;">' +
                '<small class="text-secondary">Columnas esperadas: <strong>usuario</strong> (obligatorio), <strong>contrasena</strong> (opcional), <strong>nombre_completo</strong> (opcional), <strong>pais</strong> (opcional: mx/co/pe). La primera fila se usa como encabezado. Maximo 500 usuarios. Las extensiones no se leen del archivo: se asignan automaticamente marcando la opcion inferior segun el pais del agente.</small>' +
            '</div>' +
            '<div class="form-group"><label>Pais por defecto (cuando la fila no trae pais)</label>' +
                '<select id="bulk-import-country" style="max-width:280px;"><option value="">Sin pais especifico</option><option value="mx">Mexico</option><option value="co">Colombia</option><option value="pe">Peru</option></select>' +
                '<small class="text-secondary">Define de que pool de extensiones se asigna cuando la fila no trae pais.</small>' +
            '</div>' +
            '<div class="form-group"><label>Contrasena por defecto (opcional)</label>' +
                '<input type="text" name="default_password" id="bulk-import-default-pwd" minlength="6" placeholder="Se usa cuando la fila no trae contrasena">' +
            '</div>' +
            '<div class="form-group"><label style="display:flex;align-items:center;gap:8px;cursor:pointer;"><input type="checkbox" id="bulk-import-assign-ext" style="width:16px;height:16px;accent-color:var(--primary);"><span>Asignar automaticamente una extension/telefono a cada usuario</span></label><small class="text-secondary">El sistema elige una extension libre del pool del pais para cada usuario nuevo. Si no hay suficientes extensiones, las filas restantes se marcan como error.</small></div>' +
            apiConfigHtml +
            '<div id="bulk-import-result" style="display:none;margin-bottom:12px;"></div>' +
            '<div class="modal-footer" style="padding:16px 0 0;">' +
                '<button type="button" class="btn btn-secondary" onclick="hideModal()">Cancelar</button>' +
                '<button type="submit" class="btn btn-primary" id="bulk-import-submit">Importar</button>' +
            '</div>' +
        '</form>'
    );
}

async function handleBulkImport(event) {
    event.preventDefault();
    var fileInput = document.getElementById('bulk-import-file');
    if (!fileInput.files || !fileInput.files.length) { showToast('Selecciona un archivo Excel', 'error'); return; }
    var formData = new FormData();
    formData.append('file', fileInput.files[0]);
    var defaultPwd = document.getElementById('bulk-import-default-pwd').value.trim();
    if (defaultPwd) formData.append('default_password', defaultPwd);
    var apiConfig = document.getElementById('bulk-import-api-config');
    if (apiConfig && apiConfig.value) formData.append('api_config_id', apiConfig.value);
    var assignExt = document.getElementById('bulk-import-assign-ext');
    if (assignExt && assignExt.checked) formData.append('assign_extensions', 'true');
    var importCountry = document.getElementById('bulk-import-country');
    if (importCountry && importCountry.value) formData.append('country', importCountry.value);

    var resultEl = document.getElementById('bulk-import-result');
    var submitBtn = document.getElementById('bulk-import-submit');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Importando...';
    resultEl.style.display = 'block';
    resultEl.style.padding = '10px 12px';
    resultEl.style.borderRadius = '8px';
    resultEl.style.fontSize = '13px';
    resultEl.style.background = '#EFF6FF';
    resultEl.style.color = 'var(--text-secondary)';
    resultEl.textContent = 'Procesando archivo...';

    try {
        var response = await fetch('/api/users/bulk-import', {
            method: 'POST',
            credentials: 'include',
            body: formData
        });
        var data = await response.json().catch(function() { return { error: 'Respuesta invalida del servidor' }; });
        if (!response.ok) throw new Error(data.error || 'Error al importar');
        var hasErrors = (data.errors || []).length > 0;
        resultEl.style.background = hasErrors ? '#FEF3C7' : '#ECFDF5';
        resultEl.style.color = hasErrors ? '#B45309' : 'var(--success)';
        var html = '<strong>Importacion completada.</strong> Creados: ' + data.created_count + '. Errores: ' + data.error_count + '.';
        if (hasErrors) {
            html += '<ul style="margin:6px 0 0;padding-left:18px;max-height:180px;overflow:auto;">' +
                data.errors.map(function(e) { return '<li>Fila ' + e.row + (e.username ? ' (' + escapeHtml(e.username) + ')' : '') + ': ' + escapeHtml(e.error) + '</li>'; }).join('') + '</ul>';
        }
        resultEl.innerHTML = html;
        showToast('Usuarios creados: ' + data.created_count, hasErrors ? 'error' : 'success');
        if (data.created_count > 0) setTimeout(function() { renderUsers(document.getElementById('page-content')); }, 800);
    } catch (err) {
        resultEl.style.background = '#FEE2E2';
        resultEl.style.color = 'var(--danger)';
        resultEl.textContent = 'Error: ' + err.message;
        showToast(err.message, 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Importar';
    }
}

async function showBulkPasswordModal() {
    var selected = getSelectedUsers();
    if (!selected.length) { showToast('Selecciona al menos un usuario', 'error'); return; }
    showModal('Cambio Masivo de Contrasena',
        '<form onsubmit="handleBulkPassword(event)">' +
            '<div class="form-group"><label>Usuarios seleccionados: ' + selected.length + '</label>' +
                '<div style="max-height:120px;overflow:auto;border:1px solid var(--border);border-radius:8px;padding:8px;font-size:13px;">' +
                selected.map(function(u) { return escapeHtml(u.username); }).join('<br>') + '</div>' +
            '</div>' +
            '<div class="form-group" style="background:var(--light-blue-bg);border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-size:13px;color:var(--text-secondary);">' +
                'Se generara automaticamente una contrasena aleatoria de 10 caracteres (letras y numeros) para cada usuario seleccionado. Podras verla y exportarla en el resultado.' +
            '</div>' +
            '<div id="bulk-password-result" style="display:none;margin-bottom:12px;"></div>' +
            '<div class="modal-footer" style="padding:16px 0 0;">' +
                '<button type="button" class="btn btn-secondary" onclick="hideModal()">Cancelar</button>' +
                '<button type="submit" class="btn btn-primary" id="bulk-password-submit">Generar Contrasenas</button>' +
            '</div>' +
        '</form>'
    );
}

async function handleBulkPassword(event) {
    event.preventDefault();
    var selected = getSelectedUsers();
    var submitBtn = document.getElementById('bulk-password-submit');
    var resultEl = document.getElementById('bulk-password-result');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Generando...';
    resultEl.style.display = 'block';
    resultEl.style.padding = '10px 12px';
    resultEl.style.borderRadius = '8px';
    resultEl.style.fontSize = '13px';
    resultEl.style.background = '#EFF6FF';
    resultEl.textContent = 'Aplicando cambios...';
    try {
        var result = await api('/api/users/bulk-password', {
            method: 'POST',
            body: { ids: selected.map(function(u) { return u.id; }) }
        });
        var updated = result.updated || [];
        var hasErrors = (result.errors || []).length > 0;
        resultEl.style.background = hasErrors ? '#FEF3C7' : '#ECFDF5';
        resultEl.style.color = hasErrors ? '#B45309' : 'var(--success)';
        var html = '<strong>Contrasenas actualizadas: ' + result.updated_count + '.</strong>';
        if (updated.length) {
            html += '<div style="margin-top:8px;display:grid;gap:4px;max-height:200px;overflow:auto;">' +
                updated.map(function(u) {
                    return '<div style="display:flex;justify-content:space-between;gap:8px;padding:4px 8px;background:#fff;border:1px solid var(--border);border-radius:6px;">' +
                        '<span style="font-weight:500;">' + escapeHtml(u.username) + '</span>' +
                        '<code style="color:var(--primary-blue);font-weight:600;">' + escapeHtml(u.password) + '</code></div>';
                }).join('') + '</div>';
            html += '<div style="margin-top:10px;"><button type="button" class="btn btn-secondary" onclick="downloadResetPasswords()">Descargar Excel (.xlsx)</button></div>';
        }
        if (hasErrors) {
            html += '<ul style="margin:6px 0 0;padding-left:18px;max-height:180px;overflow:auto;">' +
                result.errors.map(function(e) { return '<li>' + escapeHtml(e.username || ('ID ' + e.id)) + ': ' + escapeHtml(e.error) + '</li>'; }).join('') + '</ul>';
        }
        resultEl.innerHTML = html;
        if (updated.length) {
            lastResetPasswords = { ids: updated.map(function(u) { return u.id; }), passwords: updated.reduce(function(acc, u) { acc[u.id] = u.password; return acc; }, {}) };
            // Auto-download the account+password spreadsheet for this batch
            downloadResetPasswords();
        }
        showToast('Contrasenas actualizadas: ' + result.updated_count, hasErrors ? 'error' : 'success');
    } catch (err) {
        resultEl.style.background = '#FEE2E2';
        resultEl.style.color = 'var(--danger)';
        resultEl.textContent = 'Error: ' + err.message;
        showToast(err.message, 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Generar Contrasenas';
    }
}

var lastResetPasswords = null;

async function downloadResetPasswords() {
    if (!lastResetPasswords || !lastResetPasswords.ids.length) { return; }
    try {
        var response = await fetch('/api/users/export-passwords', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(lastResetPasswords)
        });
        if (!response.ok) {
            var data = await response.json().catch(function() { return {}; });
            throw new Error(data.error || 'Error al exportar');
        }
        var blob = await response.blob();
        var url = window.URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'contrasenas_usuarios_' + new Date().toISOString().slice(0,10) + '.xlsx';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        showToast('Archivo de contrasenas descargado', 'success');
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function exportUsers() {
    try {
        var response = await fetch('/api/users/export', { credentials: 'include' });
        if (!response.ok) {
            var data = await response.json().catch(function() { return {}; });
            throw new Error(data.error || 'Error al exportar');
        }
        var blob = await response.blob();
        var url = window.URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'usuarios_' + new Date().toISOString().slice(0,10) + '.xlsx';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        showToast('Exportacion completada', 'success');
    } catch (err) {
        showToast(err.message, 'error');
    }
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

async function renderMyAccount(container) {
    container.innerHTML = '<div class="loading"><div class="spinner"></div><p>Cargando estadisticas...</p></div>';
    try {
        var params = new URLSearchParams();
        var dateFrom = document.getElementById('stats-date-from') ? document.getElementById('stats-date-from').value : '';
        var dateTo = document.getElementById('stats-date-to') ? document.getElementById('stats-date-to').value : '';
        if (dateFrom) params.set('date_from', dateFrom);
        if (dateTo) params.set('date_to', dateTo);

        var data = await api('/api/admin/unified-stats?' + params.toString());
        var myAcct = data.my_account || {};

        function statCard(label, value, color) {
            return '<div class="stat-card"><div class="stat-value" style="' + (color ? 'color:' + color : '') + '">' + value + '</div><div class="stat-label">' + label + '</div></div>';
        }

        var filterHtml = '<div class="page-header page-filter mb-4"><h1 style="font-size:22px;font-weight:700;">Mi Cuenta</h1><div class="filter-row"><input type="date" id="stats-date-from" class="form-control" value="' + dateFrom + '"><span class="text-secondary filter-sep">a</span><input type="date" id="stats-date-to" class="form-control" value="' + dateTo + '"><button class="btn btn-primary btn-sm" onclick="renderMyAccount(document.getElementById(\'page-content\'))">Filtrar</button></div></div>';

        var myRate = myAcct.total > 0 ? (myAcct.sent / myAcct.total * 100).toFixed(1) : '0.0';
        var billingNote = Number(data.unit_price) > 0 ? ('Costo por SMS: ' + formatPrice(data.unit_price)) : 'Costo por SMS no configurado';
        var html = filterHtml + '<div class="card mb-4"><div class="card-header card-header-wrap"><span style="font-size:20px;"></span><h3 style="margin:0;">Resumen de Cuenta</h3><span class="badge badge-primary header-badge">' + escapeHtml(state.user.username) + '</span></div><div class="card-body"><div class="stats-grid stats-grid-5">' + statCard('Total SMS', myAcct.total || 0) + statCard('Enviados', myAcct.sent || 0, 'var(--success)') + statCard('Fallidos', myAcct.failed || 0, 'var(--danger)') + statCard('Costo Total', formatMoney(myAcct.total || 0, data.unit_price), 'var(--primary)') + statCard('Tasa de Exito', myRate + '%') + '</div><table class="info-table"><tbody><tr><td class="info-label">SMS Pendientes</td><td class="info-value">' + (myAcct.pending || 0) + '</td></tr><tr><td class="info-label">Facturacion</td><td class="info-value">' + billingNote + ' <span class="text-secondary">(se cuenta cada SMS enviado, exitoso o fallido)</span></td></tr></tbody></table></div></div>';

        if (window.MobileNative && MobileNative.getFloatingPlugin && MobileNative.getFloatingPlugin()) {
            html += '<div class="card mb-4"><div class="card-header"><h3 style="margin:0;">Widget flotante</h3></div>' +
                '<div class="card-body"><p class="text-secondary" style="margin-top:0;">Muestra un botón flotante sobre otras aplicaciones para abrir el envío rápido de SMS sin volver a la app.</p>' +
                '<div class="callout callout-warning" style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:8px;padding:12px;margin-bottom:12px;color:#1E40AF;font-size:13px;line-height:1.5;">' +
                '<strong>Permisos necesarios:</strong> al activar, Android abrirá los ajustes para permitir "Mostrar sobre otras apps". También recomendamos permitir la ejecución en segundo plano / desactivar la optimización de batería.' +
                '</div>' +
                '<button id="bubble-toggle-btn" class="btn btn-primary" onclick="toggleSystemBubble()">Activar widget flotante</button> ' +
                '<button class="btn btn-secondary" onclick="ensureBubblePermissions()">Solicitar permisos</button> ' +
                '<button class="btn btn-secondary" onclick="runBubbleDiagnostic()">Diagnóstico</button> ' +
                '<button class="btn btn-secondary" onclick="MobileNative.openBatterySettings()">Ajustes de batería</button>' +
                '</div></div>';
        }

        container.innerHTML = html;
        if (window.MobileNative && MobileNative.getFloatingPlugin && MobileNative.getFloatingPlugin()) refreshBubbleToggle();
    } catch (err) { container.innerHTML = '<div class="empty-state"><h3>Error</h3><p>' + escapeHtml(err.message) + '</p></div>'; }
}

async function renderMyTeam(container) {
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
        var myTeam = data.my_team || {};

        function statCard(label, value, color) {
            return '<div class="stat-card"><div class="stat-value" style="' + (color ? 'color:' + color : '') + '">' + value + '</div><div class="stat-label">' + label + '</div></div>';
        }

        function statRow(label, value) {
            return '<tr><td class="info-label">' + label + '</td><td class="info-value">' + value + '</td></tr>';
        }

        var userOptions = (data.users || []).map(function(u) {
            return '<option value="' + u.id + '"' + (filterUserId == u.id ? ' selected' : '') + '>' + escapeHtml(u.username) + (u.full_name ? ' - ' + escapeHtml(u.full_name) : '') + '</option>';
        }).join('');
        var filterHtml = '<div class="page-header page-filter mb-4"><h1 style="font-size:22px;font-weight:700;">Mi Equipo</h1><div class="filter-row filter-row-multi"><input type="date" id="stats-date-from" class="form-control" value="' + dateFrom + '"><span class="text-secondary filter-sep">a</span><input type="date" id="stats-date-to" class="form-control" value="' + dateTo + '"><select id="stats-user-filter" class="form-control"><option value="">Todos los usuarios</option>' + userOptions + '</select><button class="btn btn-primary btn-sm" onclick="renderMyTeam(document.getElementById(\'page-content\'))">Filtrar</button></div></div>';

        var html = filterHtml;
        if (myTeam && myTeam.member_count !== undefined) {
            var teamRate = myTeam.total > 0 ? (myTeam.sent / myTeam.total * 100).toFixed(1) : '0.0';
            html += '<div class="card mb-4"><div class="card-header card-header-wrap"><span style="font-size:20px;"></span><h3 style="margin:0;">Resumen del Equipo</h3><span class="badge badge-success header-badge">' + (myTeam.team_name || '-') + '</span></div><div class="card-body"><div class="stats-grid stats-grid-5">' + statCard('Miembros', myTeam.member_count || 0) + statCard('Total SMS', myTeam.total || 0) + statCard('Enviados Hoy', myTeam.today || 0, 'var(--success)') + statCard('Costo Total', formatMoney(myTeam.total || 0, data.unit_price), 'var(--primary)') + statCard('Tasa de Exito', teamRate + '%') + '</div><table class="info-table"><tbody>' + statRow('SMS Pendientes', myTeam.pending || 0) + statRow('Costo por SMS', Number(data.unit_price) > 0 ? formatPrice(data.unit_price) : 'No configurado') + statRow('Facturacion', 'Cada SMS enviado se factura (exito o fallo)') + statRow('Limite Diario', myTeam.daily_limit > 0 ? myTeam.daily_limit + ' SMS/usuario' : 'Sin limite') + statRow('Ultima Actividad', myTeam.last_activity ? timeAgo(myTeam.last_activity) : 'Sin actividad') + '</tbody></table></div></div>';
        } else {
            html += '<div class="card mb-4"><div class="card-body"><div class="empty-state"><h3>Sin datos de equipo</h3><p>No tienes acceso a datos de equipo.</p></div></div></div>';
        }

        container.innerHTML = html;
    } catch (err) { container.innerHTML = '<div class="empty-state"><h3>Error</h3><p>' + escapeHtml(err.message) + '</p></div>'; }
}

async function renderAllTeams(container) {
    container.innerHTML = '<div class="loading"><div class="spinner"></div><p>Cargando estadisticas...</p></div>';
    try {
        var params = new URLSearchParams();
        var dateFrom = document.getElementById('stats-date-from') ? document.getElementById('stats-date-from').value : '';
        var dateTo = document.getElementById('stats-date-to') ? document.getElementById('stats-date-to').value : '';
        if (dateFrom) params.set('date_from', dateFrom);
        if (dateTo) params.set('date_to', dateTo);

        var data = await api('/api/admin/unified-stats?' + params.toString());
        var allTeamsList = data.all_teams_list || [];

        function statCard(label, value, color) {
            return '<div class="stat-card"><div class="stat-value" style="' + (color ? 'color:' + color : '') + '">' + value + '</div><div class="stat-label">' + label + '</div></div>';
        }

        var filterHtml = '<div class="page-header page-filter mb-4"><h1 style="font-size:22px;font-weight:700;">Todos los Equipos</h1><div class="filter-row filter-row-multi"><input type="date" id="stats-date-from" class="form-control" value="' + dateFrom + '"><span class="text-secondary filter-sep">a</span><input type="date" id="stats-date-to" class="form-control" value="' + dateTo + '"><button class="btn btn-primary btn-sm" onclick="renderAllTeams(document.getElementById(\'page-content\'))">Filtrar</button><button class="btn btn-secondary btn-sm" onclick="exportAllTeamsStats()">Exportar</button></div></div>';

        var html = filterHtml;
        if (allTeamsList && allTeamsList.length > 0) {
            var teamRows = allTeamsList.map(function(t) {
                var r = t.total > 0 ? (t.sent / t.total * 100).toFixed(1) : '0.0';
                var rateClass = r >= 90 ? 'badge-success' : r >= 70 ? 'badge-warning' : 'badge-danger';
                var displayName = t.unit_role === 'admin' ? ('Administrador' + (state.user && state.user.username ? ' (' + state.user.username + ')' : '')) : (t.team_name || t.team_admin_username || 'Equipo');
                var subName = t.unit_role === 'admin' ? 'Cuenta propia' : (t.team_admin_username || '-');
                var nameCell = '<strong>' + escapeHtml(displayName) + '</strong><br><small class="text-secondary">' + escapeHtml(subName) + '</small>';
                return '<tr><td>' + nameCell + '</td><td style="text-align:center;">' + t.member_count + '</td><td style="text-align:right;font-weight:600;">' + t.total + '</td><td style="text-align:right;color:var(--success);">' + t.sent + '</td><td style="text-align:right;color:var(--danger);">' + t.failed + '</td><td style="text-align:right;color:var(--primary);font-weight:600;">' + formatMoney(t.total || 0, data.unit_price) + '</td><td style="text-align:right;color:var(--primary);">' + (t.today || 0) + '</td><td style="text-align:right;"><span class="badge ' + rateClass + '">' + r + '%</span></td></tr>';
            }).join('');
            html += '<div class="card mb-4"><div class="card-header card-header-wrap"><h3 style="margin:0;">Equipos</h3><span class="badge header-badge" style="background:var(--primary);color:#fff;">' + allTeamsList.length + ' equipos</span></div><div class="card-body"><div class="table-container"><table><thead><tr><th>Equipo</th><th style="text-align:center;">Miembros</th><th style="text-align:right;">Total SMS</th><th style="text-align:right;">Enviados</th><th style="text-align:right;">Fallidos</th><th style="text-align:right;">Costo</th><th style="text-align:right;">Hoy</th><th style="text-align:right;">Exito</th></tr></thead><tbody>' + teamRows + '</tbody></table></div></div></div>';
        } else {
            html += '<div class="card mb-4"><div class="card-body"><div class="empty-state"><h3>Sin datos</h3><p>No hay datos de equipos disponibles.</p></div></div></div>';
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
async function renderTeamApiConfig(container) {
    if (state.user.role !== 'admin') { container.innerHTML = '<div class="empty-state"><h3>Acceso denegado</h3></div>'; return; }
    container.innerHTML = '<div class="text-center text-secondary">Cargando...</div>';
    try {
        var data = await api('/api/config/team-api-config');
        var teams = data.teams || [];
        var configs = data.configs || [];

        var configOptions = configs.map(function(c) {
            return '<option value="' + c.id + '">' + escapeHtml(c.name) + ' (' + escapeHtml(c.country) + ')</option>';
        }).join('');

        var teamRows = teams.map(function(t) {
            return '<tr><td><strong>' + escapeHtml(t.team_admin_name) + '</strong><br><small class="text-secondary">' + escapeHtml(t.team_admin_full_name || '') + '</small></td><td style="text-align:center;">' + t.daily_sms_limit + '</td><td><select onchange="updateTeamApiConfig(' + t.team_admin_id + ', this.value)" style="padding:6px 10px;border:1px solid #E2E8F0;border-radius:8px;font-size:13px;"><option value="">Sin asignar</option>' + configOptions.replace('value="' + t.api_config_id + '"', 'value="' + t.api_config_id + '" selected') + '</select></td><td><span class="badge badge-blue">' + escapeHtml(t.api_config_name) + '</span></td></tr>';
        }).join('');

        var html = '<h1 class="mb-4" style="font-size:22px;font-weight:700;">API por Equipo</h1>' +
            '<div class="card mb-4"><div class="card-header"><h3 style="margin:0;">Asignacion de API SMS por Equipo</h3></div><div class="card-body">' +
            '<p class="text-secondary mb-3">Asigna una configuracion de API SMS a cada equipo. Los mensajes de los miembros del equipo se enviaran usando la API configurada.</p>' +
            (teams.length > 0 ? '<div class="table-container"><table><thead><tr><th>Equipo (Admin)</th><th style="text-align:center;">Limite Diario</th><th>Configuracion API</th><th>API Asignada</th></tr></thead><tbody>' + teamRows + '</tbody></table></div>' : '<div class="empty-state"><p>No hay equipos configurados</p></div>') +
            '</div></div>';

        container.innerHTML = html;
    } catch (err) { container.innerHTML = '<div class="empty-state"><h3>Error</h3><p>' + escapeHtml(err.message) + '</p></div>'; }
}

async function updateTeamApiConfig(teamAdminId, apiConfigId) {
    try {
        await api('/api/config/team-api-config', { method: 'PUT', body: { team_admin_id: teamAdminId, api_config_id: apiConfigId ? parseInt(apiConfigId) : null } });
        showToast('Configuracion API actualizada', 'success');
    } catch (err) { showToast(err.message, 'error'); }
}

async function renderRolePermissions(container) {
    if (state.user.role !== 'admin') { container.innerHTML = '<div class="empty-state"><h3>Acceso denegado</h3></div>'; return; }
    container.innerHTML = '<div class="text-center text-secondary">Cargando...</div>';
    try {
        var data = await api('/api/role-permissions');
        var pages = data.available_pages || [];
        var roles = data.roles || [];

        var html = '<div class="flex-between mb-4"><h1 style="font-size:22px;font-weight:700;">Permisos por Rol</h1></div>';
        html += '<p class="text-secondary mb-4">Configura que menus puede ver cada rol. Los cambios se aplican inmediatamente al iniciar sesion.</p>';

        roles.forEach(function(role) {
            var rolePerms = role.permissions || [];
            html += '<div class="card mb-4"><div class="card-header"><h3 style="margin:0;">' + escapeHtml(role.role_label) + '</h3></div><div class="card-body">';
            html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;">';

            pages.forEach(function(page) {
                var checked = rolePerms.indexOf(page.id) >= 0 ? 'checked' : '';
                var disabled = role.role === 'admin' ? 'disabled' : '';
                html += '<label style="display:flex;align-items:center;gap:8px;padding:8px 12px;border:1px solid var(--border);border-radius:8px;cursor:pointer;">';
                html += '<input type="checkbox" class="role-perm-check" data-role="' + escapeHtml(role.role) + '" data-page="' + escapeHtml(page.id) + '" ' + checked + ' ' + disabled + '>';
                html += '<span>' + escapeHtml(page.label) + '</span>';
                html += '</label>';
            });

            html += '</div>';
            if (role.role !== 'admin') {
                html += '<div style="margin-top:16px;text-align:right;"><button class="btn btn-primary btn-sm" onclick="saveRolePermissions(\'' + escapeHtml(role.role) + '\')">Guardar</button></div>';
            }
            html += '</div></div>';
        });

        container.innerHTML = html;
    } catch (err) { container.innerHTML = '<div class="empty-state"><h3>Error</h3><p>' + escapeHtml(err.message) + '</p></div>'; }
}

async function saveRolePermissions(role) {
    var checks = document.querySelectorAll('.role-perm-check[data-role="' + role + '"]');
    var permissions = [];
    checks.forEach(function(cb) { if (cb.checked) permissions.push(cb.dataset.page); });

    try {
        await api('/api/role-permissions/' + role, { method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({permissions: permissions}) });
        showToast('Permisos actualizados para ' + role);
    } catch (err) { showToast('Error: ' + err.message, 'error'); }
}

async function renderConfig(container) {
    if (state.user.role !== 'admin') { container.innerHTML = '<div class="empty-state"><h3>Acceso denegado</h3></div>'; return; }
    container.innerHTML = '<div class="text-center text-secondary">Cargando...</div>';
    try {
        var results = await Promise.all([api('/api/config/sms'), api('/api/config/logs'), api('/api/config/auto-clear')]);
        if (state.user.role === 'admin') {
            try {
                var billing = await api('/api/settings/billing');
                results.billing = billing;
            } catch (e) { results.billing = { sms_unit_price: 0 }; }
        }
        var configs = results[0].configs || [];
        var logsData = results[1];
        var anyConfigured = configs.some(function(c) { return c.domain && c.spid && c.api_pwd; });
        var logRows = logsData.logs.length === 0
            ? '<tr><td colspan="4" class="text-center text-secondary" style="padding:24px;">No hay registros</td></tr>'
            : logsData.logs.map(function(l) { return '<tr><td class="text-sm text-secondary">' + formatDate(l.created_at) + '</td><td>' + escapeHtml(l.action) + '</td><td class="text-sm">' + escapeHtml(l.details || '-') + '</td><td><span class="badge ' + (l.status === 'success' ? 'badge-green' : l.status === 'error' ? 'badge-red' : 'badge-gray') + '">' + escapeHtml(l.status) + '</span></td></tr>'; }).join('');

        var initialHtml =
            '<div class="flex-between mb-4"><h1 style="font-size:22px;font-weight:700;">Configuraciones API SMS</h1><button class="btn btn-primary btn-sm" onclick="showAddApiConfig()">+ Nueva Configuracion</button></div>' +
            configs.map(function(c) {
                var isCfg = c.domain && c.spid && c.api_pwd;
                return '<div class="card mb-3"><div class="card-header" style="display:flex;align-items:center;gap:10px;"><h3 style="margin:0;">' + escapeHtml(c.name) + ' <span class="badge ' + (c.country === 'MX' ? 'badge-green' : 'badge-blue') + '">' + escapeHtml(c.country) + '</span></h3><span class="badge ' + (c.is_active ? 'badge-green' : 'badge-gray') + '" style="margin-left:auto;">' + (c.is_active ? 'Activa' : 'Inactiva') + '</span></div><div class="card-body"><form onsubmit="handleSaveApiConfig(event, ' + c.id + ')"><div class="form-grid"><div class="form-group"><label>Dominio del Servidor</label><input type="text" name="domain" value="' + escapeHtml(c.domain || '') + '" placeholder="api.infin8linx.com"></div><div class="form-group"><label>Cuenta de Interfaz (SPID)</label><input type="text" name="spid" value="' + escapeHtml(c.spid || '') + '" placeholder="Su cuenta de interfaz"></div><div class="form-group"><label>Contrasena API</label><input type="password" name="api_pwd" value="' + escapeHtml(c.api_pwd || '') + '" placeholder="Contrasena de la API"></div><div class="form-group"><label>Nombre del Remitente</label><input type="text" name="sender_name" value="' + escapeHtml(c.sender_name || '') + '" placeholder="MiEmpresa"></div></div><div class="flex gap-2 mt-3"><button type="submit" class="btn btn-primary">Guardar</button><button type="button" class="btn btn-secondary" onclick="testApiConfig(' + c.id + ')">Probar</button><button type="button" class="btn btn-danger btn-sm" onclick="deleteApiConfig(' + c.id + ')">Eliminar</button></div></form>' + (isCfg ? '<div class="mt-3"><span class="badge badge-green">API Configurada</span></div>' : '<div class="mt-3"><span class="badge badge-yellow">API No Configurada - Modo Simulacion</span></div>') + '</div></div>';
            }).join('') +
            '<div class="card mb-4"><div class="card-body"><div style="padding:12px;background:#EFF6FF;border-radius:8px;font-size:13px;color:#1E293B;"><strong>Nota sobre codificacion:</strong> El espanol usa codificacion UCS2. Cada SMS individual admite hasta 70 caracteres. SMS largos se dividen en partes de 67 caracteres cada una.</div></div></div>';

        var html = initialHtml;

        if (state.user.role === 'admin') {
            var price = (results.billing && results.billing.sms_unit_price != null) ? results.billing.sms_unit_price : 0;
            html += '<div class="card mb-4"><div class="card-header"><h2 style="margin:0;">Facturacion por SMS</h2></div><div class="card-body"><p class="text-secondary" style="margin-bottom:16px">Define el costo por SMS enviado. La facturacion se calcula por <strong>SMS enviado</strong> (se cuenta cada intento, exitoso o fallido). Se aplica a los costos mostrados en Mi Cuenta, Mi Equipo y Todos los Equipos.</p><div style="display:flex;align-items:flex-end;gap:12px;flex-wrap:wrap;"><div style="flex:1;min-width:200px"><label class="form-label">Costo por SMS</label><input type="number" id="sms-unit-price" class="form-input" value="' + price + '" min="0" step="0.0001" placeholder="0.0000"></div><button class="btn btn-primary" onclick="saveBillingPrice()">Guardar Costo</button></div></div></div>';
        }

        var ac = results[2] || {};
        html += '<div class="card mb-4"><div class="card-header" style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;"><div><h2 style="margin:0;">Retencion de contactos</h2><p class="text-secondary" style="margin:4px 0 0;font-size:13px;">La limpieza diaria ahora elimina solo los contactos vencidos segun la categoria de cada empleado (ya no borra todos los contactos).</p></div><a class="btn btn-primary btn-sm" href="#/retention">Configurar categorias</a></div><div class="card-body"><div class="mt-1 text-sm" style="display:grid;gap:6px;"><span>Ultima ejecucion: <strong>' + (ac.last_run_at ? escapeHtml(ac.last_run_at) : 'Nunca') + '</strong></span><span>Contactos eliminados la ultima vez: <strong>' + (ac.last_run_count || 0) + '</strong></span><span>Estado: <strong>' + escapeHtml(ac.last_run_status || 'pendiente') + '</strong></span></div></div></div>';

        html += '<div class="card"><div class="card-header"><h2>Registros de Actividad</h2></div><div class="table-container"><table><thead><tr><th>Fecha</th><th>Accion</th><th>Detalles</th><th>Estado</th></tr></thead><tbody>' + logRows + '</tbody></table></div></div>';
        container.innerHTML = html;
    } catch (err) { container.innerHTML = '<div class="empty-state"><h3>Error</h3><p>' + escapeHtml(err.message) + '</p></div>'; }
}

async function handleSaveApiConfig(event, configId) {
    event.preventDefault(); var form = event.target;
    try { await api('/api/config/sms/' + configId, { method: 'PUT', body: { name: form.closest('.card').querySelector('h3').textContent.trim().split(' ')[0], country: '', domain: form.domain.value.trim(), spid: form.spid.value.trim(), api_pwd: form.api_pwd.value.trim(), sender_name: form.sender_name.value.trim(), is_active: true } }); showToast('Configuracion guardada', 'success'); renderConfig(document.getElementById('page-content')); }
    catch (err) { showToast(err.message, 'error'); }
}

async function testApiConfig(configId) {
    try { var data = await api('/api/config/sms/test', { method: 'POST', body: { config_id: configId } }); showToast(data.message, 'success'); }
    catch (err) { showToast(err.message, 'error'); }
}

async function saveBillingPrice() {
    var input = document.getElementById('sms-unit-price');
    if (!input) return;
    var val = parseFloat(input.value);
    if (isNaN(val) || val < 0) { showToast('Ingrese un costo valido', 'error'); return; }
    try {
        await api('/api/settings/billing', { method: 'PUT', body: { sms_unit_price: val } });
        showToast('Costo por SMS guardado', 'success');
        renderConfig(document.getElementById('page-content'));
    } catch (err) { showToast(err.message, 'error'); }
}

async function showAddApiConfig() {
    var name = prompt('Nombre de la configuracion (ej: Mexico, Colombia):');
    if (!name) return;
    var country = prompt('Codigo de pais (ej: MX, CO):');
    if (!country) return;
    try { await api('/api/config/sms', { method: 'POST', body: { name: name.trim(), country: country.trim().toUpperCase(), domain: '', spid: '', api_pwd: '', sender_name: '' } }); showToast('Configuracion creada', 'success'); renderConfig(document.getElementById('page-content')); }
    catch (err) { showToast(err.message, 'error'); }
}

async function deleteApiConfig(configId) {
    if (!confirm('Eliminar esta configuracion?')) return;
    try { await api('/api/config/sms/' + configId, { method: 'DELETE' }); showToast('Configuracion eliminada', 'success'); renderConfig(document.getElementById('page-content')); }
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
// Floating Action Button - Quick SMS
// ============================================================
let quickSendPhones = [];

function isFabVisible() {
    if (!currentUser) return false;
    if (!currentUser.permissions) return true;
    return currentUser.permissions.includes('send');
}

function updateFabVisibility() {
    const fab = document.getElementById('fab-quick-send');
    if (!fab) return;
    // Hide when a modal is already open, or on login page
    const anyModalOpen = document.querySelector('.modal.show');
    fab.classList.toggle('hidden', !isFabVisible() || !!anyModalOpen);
}

function openQuickSend(prefillPhone) {
    if (!isFabVisible()) return;
    const modal = document.getElementById('quick-send-modal');
    if (!modal) return;
    quickSendPhones = [];
    if (prefillPhone) quickSendPhones.push(prefillPhone);
    renderQuickSend();
    modal.classList.add('show');
    setTimeout(() => {
        const input = document.getElementById('quick-phone-input');
        if (input) input.focus();
    }, 200);
}

function closeQuickSend() {
    const modal = document.getElementById('quick-send-modal');
    if (modal) modal.classList.remove('show');
}

function renderQuickSend() {
    const chips = document.getElementById('quick-phone-chips');
    if (chips) {
        chips.innerHTML = quickSendPhones.length
            ? quickSendPhones.map((p, i) => `<span class="chip">${escapeHtml(p)}<button onclick="removeQuickPhone(${i})" aria-label="Quitar">×</button></span>`).join('')
            : '<span class="muted" style="font-size:12px;color:var(--text-secondary)">Sin números seleccionados</span>';
    }
    const count = document.getElementById('quick-count');
    if (count) count.textContent = quickSendPhones.length;
}

function addQuickPhone(phone) {
    const cleaned = String(phone || '').trim();
    if (!cleaned) return;
    if (!quickSendPhones.includes(cleaned)) quickSendPhones.push(cleaned);
    renderQuickSend();
}

function removeQuickPhone(idx) {
    quickSendPhones.splice(idx, 1);
    renderQuickSend();
}

function onQuickPhoneKey(event) {
    if (event.key === 'Enter' || event.keyCode === 13) {
        event.preventDefault();
        const input = document.getElementById('quick-phone-input');
        if (!input) return;
        const raw = (input.value || '').trim();
        if (!raw) return;
        // If a contact result is highlighted, prefer it; otherwise add typed value(s)
        const results = document.getElementById('quick-contact-results');
        const highlighted = results && results.querySelector('li.hover, li:focus, li[aria-selected="true"]');
        if (highlighted && typeof highlighted.onclick === 'function') {
            highlighted.click();
            return;
        }
        // Split multiple numbers pasted/typed with comma or semicolon
        raw.split(/[;,]/).map(s => s.trim()).filter(Boolean).forEach(addQuickPhone);
        input.value = '';
        if (results) results.innerHTML = '';
        // keep focus for rapid entry
        setTimeout(() => input.focus(), 0);
    }
}

async function onQuickPhoneInput() {
    const input = document.getElementById('quick-phone-input');
    const results = document.getElementById('quick-contact-results');
    if (!input || !results) return;
    const q = input.value.trim();
    if (q.length < 2) { results.innerHTML = ''; return; }
    try {
        const data = await api(`/api/contacts?search=${encodeURIComponent(q)}&page=1&per_page=20`);
        const contacts = (data && data.contacts) || [];
        results.innerHTML = contacts.length
            ? contacts.map(c => `<li onclick="pickQuickContact('${c.phone}','${(c.name||'').replace(/'/g,"\\'")}')"><strong>${escapeHtml(c.name || '(Sin nombre)')}</strong><span class="muted">${escapeHtml(c.phone)}</span></li>`).join('')
            : '<li class="muted" style="cursor:default">Sin coincidencias — escribe un número y pulsa "Añadir"</li>';
    } catch (e) {
        results.innerHTML = '<li class="muted" style="cursor:default">Error al buscar contactos</li>';
    }
}

function pickQuickContact(phone, name) {
    addQuickPhone(phone);
    const input = document.getElementById('quick-phone-input');
    if (input) input.value = '';
    const results = document.getElementById('quick-contact-results');
    if (results) results.innerHTML = '';
}

function quickAddManual(ev) {
    if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
    const input = document.getElementById('quick-phone-input');
    if (!input) return;
    const val = input.value.trim();
    if (!val) return;
    const phones = val.split(/[;,]/).map(s => s.trim()).filter(Boolean);
    phones.forEach(addQuickPhone);
    input.value = '';
    const results = document.getElementById('quick-contact-results');
    if (results) results.innerHTML = '';
    // Keep focus for rapid entry
    setTimeout(() => input.focus(), 0);
}

async function submitQuickSend() {
    const content = (document.getElementById('quick-content')?.value || '').trim();
    if (quickSendPhones.length === 0) { showToast('Añade al menos un número', 'error'); return; }
    if (!content) { showToast('Escribe un mensaje', 'error'); return; }
    const body = {
        phones: quickSendPhones,
        content,
        contact_names: {},
    };
    try {
        const result = await api('/api/sms/send', { method: 'POST', body });
        const successCount = (result.results || []).filter(r => r.success).length;
        const failCount = (result.results || []).length - successCount;
        if (result.warnings && result.warnings.length) {
            console.warn('SMS warnings:', result.warnings);
        }
        showToast(`Enviado: ${successCount} exitoso(s)${failCount ? `, ${failCount} fallido(s)` : ''}`, failCount ? 'warning' : 'success');
        closeQuickSend();
        if (typeof loadSmsData === 'function' && (location.hash || '').includes('records')) loadSmsData();
    } catch (e) {
        showToast(e.message || 'Error al enviar', 'error');
    }
}

// Hide FAB when any modal opens; show again when all modals close
const modalRoot = document.getElementById('modal-container');
if (modalRoot) {
    const mo = new MutationObserver(updateFabVisibility);
    mo.observe(modalRoot, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
}
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const qs = document.getElementById('quick-send-modal');
        if (qs && qs.classList.contains('show')) closeQuickSend();
    }
});
updateFabVisibility();

// ============================================================
// Embedded bubble panel (#/quick-send-embed) and system bubble toggle
// ============================================================
function renderEmbedLogin() {
    document.body.className = 'embed-body';
    document.body.innerHTML =
        '<div class="embed-shell">' +
            '<div class="embed-head">' +
                '<div class="embed-title">SMS Marketing</div>' +
                '<button class="embed-close" onclick="MobileNative && MobileNative.closePanel && MobileNative.closePanel()" aria-label="Cerrar">×</button>' +
            '</div>' +
            '<form class="embed-form" onsubmit="embedLogin(event)">' +
                '<label>Usuario<input id="embed-user" type="text" autocomplete="username" required></label>' +
                '<label>Contraseña<input id="embed-pass" type="password" autocomplete="current-password" required></label>' +
                '<button class="btn btn-primary w-full" type="submit">Entrar</button>' +
                '<div id="embed-err" class="embed-err"></div>' +
            '</form>' +
        '</div>';
}

async function embedLogin(ev) {
    ev.preventDefault();
    var u = document.getElementById('embed-user').value.trim();
    var p = document.getElementById('embed-pass').value;
    var err = document.getElementById('embed-err');
    err.textContent = '';
    try {
        await api('/api/auth/login', { method: 'POST', body: { username: u, password: p } });
        var d = await api('/api/auth/me');
        state.user = d.user;
        renderQuickSendEmbed();
    } catch (e) {
        err.textContent = e.message || 'Error al iniciar sesión';
    }
}

function renderQuickSendEmbed() {
    document.body.className = 'embed-body';
    document.body.innerHTML =
        '<div class="embed-shell">' +
            '<div class="embed-head">' +
                '<div class="embed-title">Envío rápido</div>' +
                '<button class="embed-close" onclick="MobileNative.closePanel && MobileNative.closePanel()" aria-label="Cerrar">×</button>' +
            '</div>' +
            '<div class="embed-body-inner">' +
                '<div class="embed-user">' + escapeHtml(state.user.full_name || state.user.username) + '</div>' +
                '<form class="embed-field" onsubmit="quickAddManual(event)" autocomplete="off">' +
                    '<label for="quick-phone-input" style="margin-bottom:6px;">Buscar contacto o escribir número</label>' +
                    '<div class="embed-input-row">' +
                        '<input id="quick-phone-input" name="phone" type="tel" inputmode="tel" enterkeyhint="done" list="embed-contact-list" placeholder="Nombre o teléfono (pulsa ✓ para añadir)" oninput="onQuickPhoneInput()" onkeydown="onQuickPhoneKey(event)" autocomplete="off" autocapitalize="off" spellcheck="false">' +
                        '<datalist id="embed-contact-list"></datalist>' +
                        '<button type="submit" class="btn btn-secondary">Añadir</button>' +
                    '</div>' +
                '</form>' +
                '<ul id="quick-contact-results" class="quick-results"></ul>' +
                '<div class="chip-row" id="quick-phone-chips"></div>' +
                '<label class="embed-field">Mensaje' +
                    '<textarea id="quick-content" rows="5" maxlength="600" placeholder="Escribe el SMS..." oninput="updateEmbedCounter()"></textarea>' +
                '</label>' +
                '<div class="embed-counter"><span id="embed-char-count">0</span> caracteres · <span id="embed-sms-count">1</span> SMS</div>' +
                '<button class="btn btn-primary w-full" onclick="submitQuickSend()">Enviar SMS</button>' +
            '</div>' +
        '</div>';
    quickSendPhones = [];
    renderQuickSend();
}

function updateEmbedCounter() {
    var ta = document.getElementById('quick-content');
    if (!ta) return;
    var len = ta.value.length;
    var perMsg = /[^\u0000-\u007F]/.test(ta.value) ? 70 : 160;
    var longPer = /[^\u0000-\u007F]/.test(ta.value) ? 67 : 153;
    var parts = len === 0 ? 1 : (len <= perMsg ? 1 : Math.ceil(len / longPer));
    var cc = document.getElementById('embed-char-count');
    var sc = document.getElementById('embed-sms-count');
    if (cc) cc.textContent = len;
    if (sc) sc.textContent = parts;
}

async function syncSystemBubble() {
    if (!window.MobileNative || !MobileNative.getFloatingPlugin) return;
    try {
        if (await MobileNative.isBubbleRunning()) return;
        if (await MobileNative.canDrawOverlays()) {
            await MobileNative.startBubble(window.location.origin);
        }
    } catch (e) {}
}

async function ensureBubblePermissions() {
    if (!window.MobileNative || !MobileNative.getFloatingPlugin) {
        showToast('El widget flotante solo está disponible en la app Android', 'warning');
        return false;
    }
    try {
        var granted = await MobileNative.requestOverlayPermission();
        if (!granted) {
            showToast('Concede el permiso de "mostrar sobre otras apps"', 'warning');
            return false;
        }
        var batteryOk = await MobileNative.isIgnoringBatteryOptimizations();
        if (!batteryOk && MobileNative.openBatterySettings) {
            await MobileNative.openBatterySettings();
            showToast('Permite la ejecución en segundo plano para mantener el widget', 'info');
        }
        return true;
    } catch (e) {
        showToast(e.message || 'No se pudieron solicitar los permisos', 'error');
        return false;
    }
}

async function toggleSystemBubble() {
    if (!window.MobileNative || !MobileNative.getFloatingPlugin) {
        showToast('El widget flotante solo está disponible en la app Android', 'warning');
        return;
    }
    try {
        var running = await MobileNative.isBubbleRunning();
        if (running) {
            await MobileNative.stopBubble();
            showToast('Widget flotante desactivado', 'success');
        } else {
            var ok = await ensureBubblePermissions();
            if (!ok) return;
            await MobileNative.startBubble(window.location.origin);
            showToast('Widget flotante activado', 'success');
        }
        if (typeof refreshBubbleToggle === 'function') refreshBubbleToggle();
    } catch (e) {
        showToast(e.message || 'No se pudo activar el widget', 'error');
    }
}

async function refreshBubbleToggle() {
    var btn = document.getElementById('bubble-toggle-btn');
    if (!btn || !window.MobileNative) return;
    try {
        var running = await MobileNative.isBubbleRunning();
        btn.textContent = running ? 'Desactivar widget flotante' : 'Activar widget flotante';
        btn.className = running ? 'btn btn-danger' : 'btn btn-primary';
        // Hide the in-app FAB while the native system bubble is active (avoid two FABs).
        if (typeof MobileNative.syncInAppFab === 'function') MobileNative.syncInAppFab();
    } catch (e) {}
}

async function runBubbleDiagnostic() {
    var info = document.getElementById('bubble-info');
    if (!window.MobileNative || !MobileNative.getFloatingPlugin) {
        if (info) info.innerHTML = '<div class="alert alert-warning">Plugin nativo no disponible. Abre esta página desde la app Android.</div>';
        return;
    }
    if (info) info.innerHTML = '<div class="alert alert-info">Ejecutando diagnóstico…</div>';
    try {
        var echo = await MobileNative.echoBubble();
        var diag = await MobileNative.diagnoseBubble();
        console.log('[BubbleDiagnostic]', echo, diag);
        if (!diag || diag.available === false) {
            if (info) info.innerHTML = '<div class="alert alert-danger">El plugin no responde. Razón: ' + escapeHtml(diag && diag.reason || 'desconocida') + '</div>';
            return;
        }
        var lines = [];
        lines.push('Paquete: ' + (diag.package || '-'));
        lines.push('SDK Android: ' + (diag.sdk || '-'));
        lines.push('Permiso "mostrar encima": ' + (diag.overlayGranted ? '✅ concedido' : '❌ denegado'));
        lines.push('Permiso notificaciones: ' + (diag.notificationsGranted ? '✅ concedido' : '❌ denegado'));
        lines.push('Exento de optimización de batería: ' + (diag.ignoringBattery ? '✅ sí' : '❌ no'));
        lines.push('Servicio ejecutándose: ' + (diag.serviceRunning ? '✅ sí' : '❌ no'));
        lines.push('URL del servidor: ' + (diag.serverUrl || '-'));
        if (info) info.innerHTML = '<div class="alert alert-' + (diag.overlayGranted && diag.serviceRunning ? 'success' : 'warning') + '" style="white-space:pre-line;font-family:monospace;font-size:12px">' + escapeHtml(lines.join('\n')) + '</div>';
    } catch (e) {
        if (info) info.innerHTML = '<div class="alert alert-danger">Error: ' + escapeHtml(e.message || String(e)) + '</div>';
    }
}

// ============================================================
// In-app quick SMS sheet (FAB #quick-sms-fab)
// ============================================================
let qsRecipients = [];
let qsContacts = [];

function openQuickSms(prefillPhone) {
    qsRecipients = [];
    qsContacts = [];
    if (prefillPhone) qsRecipients.push(prefillPhone);
    const overlay = document.getElementById('quick-sms-overlay');
    if (!overlay) return;
    overlay.style.display = 'flex';
    renderQsRecipients();
    renderQsContactList();
    updateQuickSmsCount();
    const phoneInput = document.getElementById('quick-sms-phone');
    if (phoneInput) {
        phoneInput.value = '';
        setTimeout(() => phoneInput.focus(), 200);
    }
}

function closeQuickSms(ev) {
    if (ev && ev.target && ev.target.closest('.quick-sms-sheet')) return;
    const overlay = document.getElementById('quick-sms-overlay');
    if (overlay) overlay.style.display = 'none';
    document.getElementById('quick-sms-contact-list').style.display = 'none';
    document.getElementById('quick-sms-content').value = '';
    qsRecipients = [];
    qsContacts = [];
}

function renderQsRecipients() {
    const wrap = document.getElementById('quick-sms-chips');
    if (!wrap) return;
    if (qsRecipients.length === 0) {
        wrap.innerHTML = '<span class="muted" style="font-size:12px;color:var(--text-secondary)">Sin destinatarios — escribe un número y pulsa ✓</span>';
        return;
    }
    wrap.innerHTML = qsRecipients.map((p, i) =>
        `<span class="chip">${escapeHtml(p)}<button type="button" onclick="removeQsRecipient(${i})" aria-label="Quitar">×</button></span>`
    ).join('');
}

function removeQsRecipient(i) {
    qsRecipients.splice(i, 1);
    renderQsRecipients();
}

function onQsPhoneInput() {
    const input = document.getElementById('quick-sms-phone');
    const list = document.getElementById('quick-sms-contact-list');
    if (!input || !list) return;
    const q = input.value.trim();
    if (q.length < 2) { list.style.display = 'none'; return; }
    api(`/api/contacts?search=${encodeURIComponent(q)}&page=1&per_page=20`).then(data => {
        qsContacts = (data && data.contacts) || [];
        if (!qsContacts.length) { list.style.display = 'none'; return; }
        list.innerHTML = qsContacts.map((c, i) =>
            `<div class="quick-sms-contact-item" onclick="pickQsContactIndex(${i})">
                <strong>${escapeHtml(c.name || '(Sin nombre)')}</strong>
                <span class="muted">${escapeHtml(c.phone)}</span>
            </div>`
        ).join('');
        list.style.display = 'block';
    }).catch(() => { list.style.display = 'none'; });
}

function renderQsContactList() {
    const list = document.getElementById('quick-sms-contact-list');
    if (list) list.style.display = 'none';
}

function pickQsContactIndex(i) {
    const c = qsContacts[i];
    if (!c) return;
    if (!qsRecipients.includes(c.phone)) qsRecipients.push(c.phone);
    renderQsRecipients();
    const input = document.getElementById('quick-sms-phone');
    if (input) input.value = '';
    const list = document.getElementById('quick-sms-contact-list');
    if (list) list.style.display = 'none';
    if (input) setTimeout(() => input.focus(), 0);
}

function pickQuickSmsContact() {
    const input = document.getElementById('quick-sms-phone');
    if (input) input.focus();
}

function onQsPhoneKey(ev) {
    const input = document.getElementById('quick-sms-phone');
    if (!input) return;
    const list = document.getElementById('quick-sms-contact-list');
    if (ev.key === 'ArrowDown' && list && qsContacts.length) {
        ev.preventDefault();
        const items = list.querySelectorAll('.quick-sms-contact-item');
        if (items.length) items[0].focus && items[0].classList.add('hover');
        return;
    }
    if (ev.key === 'Enter') {
        ev.preventDefault();
        // Prefer a highlighted contact if one is selected
        const hovered = list && list.querySelector('.quick-sms-contact-item.hover');
        if (hovered) { hovered.click(); return; }
        // If exactly one matching contact shown, pick it
        if (list && qsContacts.length === 1 && list.style.display !== 'none') {
            pickQsContactIndex(0);
            return;
        }
        addQsTypedPhone();
    }
}

function addQsTypedPhone() {
    const input = document.getElementById('quick-sms-phone');
    if (!input) return;
    const val = input.value.trim();
    if (!val) return;
    val.split(/[;,]/).map(s => s.trim()).filter(Boolean).forEach(raw => {
        // Basic normalization: if 10 digits, prefix +52 (Mexico default)
        let p = raw;
        if (/^\d{10}$/.test(p.replace(/\s|-/g, ''))) p = '+52' + p.replace(/\s|-/g, '');
        if (!qsRecipients.includes(p)) qsRecipients.push(p);
    });
    renderQsRecipients();
    input.value = '';
    const list = document.getElementById('quick-sms-contact-list');
    if (list) list.style.display = 'none';
    setTimeout(() => input.focus(), 0);
}

function updateQuickSmsCount() {
    const ta = document.getElementById('quick-sms-content');
    const cc = document.getElementById('quick-sms-chars');
    if (!ta || !cc) return;
    cc.textContent = ta.value.length;
}

async function submitQuickSms() {
    const ta = document.getElementById('quick-sms-content');
    const content = (ta.value || '').trim();
    const errBox = document.getElementById('quick-sms-error');
    errBox.style.display = 'none';
    if (qsRecipients.length === 0) {
        errBox.textContent = 'Añade al menos un número de teléfono';
        errBox.style.display = 'block';
        return;
    }
    if (!content) {
        errBox.textContent = 'Escribe el mensaje';
        errBox.style.display = 'block';
        return;
    }
    const sendBtn = document.getElementById('quick-sms-send');
    sendBtn.disabled = true;
    sendBtn.textContent = 'Enviando...';
    try {
        const result = await api('/api/sms/send', {
            method: 'POST',
            body: { phones: qsRecipients, content, contact_names: {} },
        });
        const successCount = (result.results || []).filter(r => r.success).length;
        const failCount = (result.results || []).length - successCount;
        showToast(`Enviado: ${successCount} exitoso(s)${failCount ? `, ${failCount} fallido(s)` : ''}`, failCount ? 'warning' : 'success');
        closeQuickSms();
        if (typeof loadSmsData === 'function' && (location.hash || '').includes('records')) loadSmsData();
    } catch (e) {
        errBox.textContent = e.message || 'Error al enviar';
        errBox.style.display = 'block';
    } finally {
        sendBtn.disabled = false;
        sendBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Enviar';
    }
}

// Bind once DOM ready
document.addEventListener('DOMContentLoaded', () => {
    const phone = document.getElementById('quick-sms-phone');
    if (phone) {
        phone.addEventListener('input', onQsPhoneInput);
        phone.addEventListener('keydown', onQsPhoneKey);
    }
    // ESC closes the sheet
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeQuickSms();
    });
    // If the native system bubble is running, hide the in-app FAB to avoid duplicates.
    if (window.MobileNative && typeof MobileNative.syncInAppFab === 'function') {
        setTimeout(() => MobileNative.syncInAppFab(), 600);
    }
});

// ============================================================
// Voice Calls (Llamadas / 电呼)
// ============================================================
if (!state.calls) state.calls = { page: 1, perPage: 20, total: 0, status: '', search: '', dateFrom: '', dateTo: '' };
if (!state.voiceCall) state.voiceCall = { phones: [], mode: 'manual' };

var VOICE_STATUS_BADGE = {
    'pending': 'badge-gray',
    'initiated': 'badge-blue',
    'ringing': 'badge-blue',
    'answered': 'badge-blue',
    'completed': 'badge-green',
    'failed': 'badge-red',
    'no-answer': 'badge-yellow',
    'busy': 'badge-yellow',
    'canceled': 'badge-gray'
};
var VOICE_STATUS_LABELS = {
    'pending': 'Pendiente', 'initiated': 'Iniciada', 'ringing': 'Llamando',
    'answered': 'Contestada', 'completed': 'Completada', 'failed': 'Fallida',
    'no-answer': 'Sin respuesta', 'busy': 'Ocupado', 'canceled': 'Cancelada'
};

function getVoiceStatusBadge(status) {
    var cls = VOICE_STATUS_BADGE[status] || 'badge-gray';
    var label = VOICE_STATUS_LABELS[status] || status;
    return '<span class="badge ' + cls + '">' + escapeHtml(label) + '</span>';
}

function formatDuration(sec) {
    sec = parseInt(sec || 0, 10);
    if (!sec) return '-';
    var m = Math.floor(sec / 60), s = sec % 60;
    return (m > 0 ? m + 'm ' : '') + s + 's';
}

async function renderCalls(container) {
    container.innerHTML = '<div class="text-center text-secondary">Cargando...</div>';
    try {
        var [stats, groupsData, templatesData] = await Promise.all([
            api('/api/voice/statistics'),
            api('/api/groups'),
            api('/api/templates')
        ]);
        window._voiceGroups = groupsData.groups || [];
        window._voiceTemplates = templatesData.templates || [];
        var groupOpts = window._voiceGroups.map(function(g) {
            return '<option value="' + g.id + '">' + escapeHtml(g.name) + ' (' + g.contact_count + ')</option>';
        }).join('');
        var tplOpts = window._voiceTemplates.map(function(t) {
            return '<option value="' + t.id + '">' + escapeHtml(t.name) + '</option>';
        }).join('');
        var simBanner = stats.configured
            ? ''
            : '<div class="alert alert-warning" style="margin-bottom:16px;">La API de voz no esta configurada. Las llamadas se procesan en <strong>modo simulacion</strong>. Configurela en <a href="#/voice-config" style="color:inherit;text-decoration:underline;">Configuracion Voz</a>.</div>';
        var extBanner = (stats.configured && stats.provider === 'infin8linx' && !stats.can_call)
            ? '<div class="alert alert-error" style="margin-bottom:16px;"><strong>No tienes extension asignada.</strong> Para realizar llamadas reales un administrador debe asignarte una extension/telefono fijo en <a href="#/users" style="color:inherit;text-decoration:underline;">Gestion de Usuarios</a>.</div>'
            : '';
        var callerExtTag = (stats.configured && stats.provider === 'infin8linx' && stats.can_call)
            ? '<span class="badge badge-blue" style="margin-left:8px;">Extension: ' + escapeHtml(stats.caller_ext) + '</span>'
            : '';

        container.innerHTML =
            '<h1 class="mb-4" style="font-size:22px;font-weight:700;">Llamadas de Voz' + callerExtTag + '</h1>' +
            simBanner + extBanner +
            '<div class="stats-grid" style="grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));margin-bottom:20px;">' +
                '<div class="stat-card"><div class="stat-icon blue"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg></div><div class="stat-label">Hoy</div><div class="stat-value" style="font-size:22px;">' + stats.today_calls + '</div></div>' +
                '<div class="stat-card"><div class="stat-icon green"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg></div><div class="stat-label">Completadas</div><div class="stat-value" style="font-size:22px;">' + stats.completed + '</div></div>' +
                '<div class="stat-card"><div class="stat-icon yellow"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div><div class="stat-label">En curso / Pendientes</div><div class="stat-value" style="font-size:22px;">' + stats.pending + '</div></div>' +
                '<div class="stat-card"><div class="stat-icon" style="background:#FEF2F2;color:#DC2626;"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></div><div class="stat-label">Fallidas</div><div class="stat-value" style="font-size:22px;">' + stats.failed + '</div></div>' +
                '<div class="stat-card"><div class="stat-label">Tasa de contacto</div><div class="stat-value" style="font-size:22px;">' + stats.answer_rate + '%</div></div>' +
                '<div class="stat-card"><div class="stat-label">Duracion total</div><div class="stat-value" style="font-size:22px;">' + formatDuration(stats.total_duration) + '</div></div>' +
            '</div>' +
            '<div class="card mb-4"><div class="card-header" style="display:flex;justify-content:space-between;align-items:center;"><h2>Nueva Llamada Masiva</h2><span class="text-secondary" style="font-size:12px;">El sistema marca los numeros seleccionados</span></div><div class="card-body">' +
                '<div class="send-options"><button class="tab active" onclick="switchVoiceMode(\'manual\', this)">Manual</button><button class="tab" onclick="switchVoiceMode(\'contacts\', this)">Contactos</button><button class="tab" onclick="switchVoiceMode(\'group\', this)">Por Grupo</button></div>' +
                '<div id="voice-manual" class="form-group"><label>Telefonos</label>' +
                    '<form class="phone-add-row" onsubmit="commitVoicePhoneInput(); return false;">' +
                      '<input type="text" id="voice-phone-input" inputmode="tel" enterkeyhint="done" placeholder="Escriba un numero y Enter" autocomplete="off" onkeydown="if(event.key===\'Enter\'){event.preventDefault();commitVoicePhoneInput();}">' +
                      '<button type="submit" class="btn btn-primary btn-sm">Agregar</button>' +
                    '</form>' +
                    '<div class="phone-tags" id="voice-phone-tags"></div>' +
                '</div>' +
                '<div id="voice-contacts" class="form-group" style="display:none;"><label>Seleccionar contactos</label><div id="voice-contacts-list" class="contact-select-list"></div></div>' +
                '<div id="voice-group" class="form-group" style="display:none;"><label>Grupo</label><select id="voice-group-select" onchange="loadVoiceGroupContacts(this.value)"><option value="">-- Seleccione --</option>' + groupOpts + '</select><div id="voice-group-preview" class="mt-2 text-secondary text-sm"></div></div>' +
                '<div class="form-group mt-3"><label>Plantilla de guion (opcional)</label><select id="voice-template" onchange="loadVoiceTemplate(this.value)"><option value="">-- Personalizado --</option>' + tplOpts + '</select></div>' +
                '<div class="form-group"><label>Guion de la llamada (opcional)</label><textarea id="voice-script" rows="5" placeholder="Hola {nombre}, le llamamos para... (opcional)"></textarea><div class="var-chips">' + variableChips('voice-script') + '</div><small class="text-secondary">El guion lo lee el agente de la extension Infinity (infin8linx). Puede dejarlo vacio para marcar directamente.</small></div>' +
                '<div id="voice-error" class="alert alert-error" style="display:none;"></div>' +
                '<div style="display:flex;gap:8px;margin-top:8px;"><button class="btn btn-primary" id="voice-place-btn" onclick="handlePlaceCalls()"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg> Iniciar Llamada(s)</button><span class="text-secondary text-sm" style="align-self:center;">Maximo 200 numeros por tanda.</span></div>' +
            '</div></div>' +
            '<div class="card"><div class="card-body" style="padding-bottom:0;"><div class="toolbar" style="display:flex;gap:8px;flex-wrap:wrap;"><input type="text" id="voice-search" placeholder="Buscar telefono, nombre o guion..." value="' + escapeHtml(state.calls.search) + '" onkeydown="if(event.key===\'Enter\')triggerVoiceSearch()" style="flex:1;min-width:200px;"><button class="btn btn-primary btn-sm" onclick="triggerVoiceSearch()">Buscar</button><select id="voice-status-filter" onchange="handleVoiceStatus(this.value)"><option value="">Todos los estados</option>' + Object.keys(VOICE_STATUS_LABELS).map(function(s){return '<option value="'+s+'"'+(state.calls.status===s?' selected':'')+'>'+VOICE_STATUS_LABELS[s]+'</option>';}).join('') + '</select><input type="date" lang="es" value="' + state.calls.dateFrom + '" onchange="handleVoiceDateFrom(this.value)"><input type="date" lang="es" value="' + state.calls.dateTo + '" onchange="handleVoiceDateTo(this.value)"></div></div><div id="voice-records-container"><div class="text-center text-secondary" style="padding:24px;">Cargando registros...</div></div></div>';

        loadVoiceContactsForSelection();
        loadVoiceRecords();
        // Bloquear el boton de llamada si el agente no tiene extension (infin8linx real)
        if (stats.configured && stats.provider === 'infin8linx' && !stats.can_call) {
            var placeBtn = document.getElementById('voice-place-btn');
            if (placeBtn) { placeBtn.disabled = true; placeBtn.style.opacity = '0.5'; placeBtn.style.cursor = 'not-allowed'; }
        }
    } catch (err) {
        container.innerHTML = '<div class="empty-state"><h3>Error</h3><p>' + escapeHtml(err.message) + '</p></div>';
    }
}

function switchVoiceMode(mode, btn) {
    state.voiceCall.mode = mode;
    document.querySelectorAll('#voice-manual, #voice-contacts, #voice-group').forEach(function(el){ el.style.display='none'; });
    var target = document.getElementById('voice-' + mode);
    if (target) target.style.display = 'block';
    btn.parentNode.querySelectorAll('.tab').forEach(function(t){ t.classList.remove('active'); });
    btn.classList.add('active');
}

function commitVoicePhoneInput() {
    var input = document.getElementById('voice-phone-input');
    if (!input) return;
    var raw = (input.value || '').trim();
    if (!raw) return;
    var parts = raw.split(/[,;，；\s]+/).map(function(s){return s.trim();}).filter(Boolean);
    var defaultCode = (state.user && state.user.team_country_code) || '+52';
    parts.forEach(function(part) {
        var p = normalizePhone(part, defaultCode);
        if (p && state.voiceCall.phones.indexOf(p) === -1) state.voiceCall.phones.push(p);
    });
    input.value = '';
    renderVoicePhoneTags();
}

function renderVoicePhoneTags() {
    var c = document.getElementById('voice-phone-tags');
    if (!c) return;
    c.innerHTML = state.voiceCall.phones.map(function(p, i){
        return '<span class="phone-tag">' + escapeHtml(p) + ' <button type="button" onclick="removeVoicePhone(' + i + ')" style="background:none;border:none;color:inherit;cursor:pointer;font-weight:bold;">&times;</button></span>';
    }).join('');
}

function removeVoicePhone(i) { state.voiceCall.phones.splice(i, 1); renderVoicePhoneTags(); }

async function loadVoiceContactsForSelection() {
    try {
        var data = await api('/api/contacts?per_page=1000');
        var list = document.getElementById('voice-contacts-list');
        if (!list) return;
        if (!data.contacts || !data.contacts.length) { list.innerHTML = '<p class="text-secondary">Sin contactos.</p>'; return; }
        list.innerHTML = data.contacts.map(function(c) {
            return '<label class="contact-select-item"><input type="checkbox" class="voice-contact-check" data-phone="' + escapeHtml(c.phone) + '" data-name="' + escapeHtml(c.name || '') + '" onchange="syncVoiceContactSelection()"> ' + escapeHtml(c.name || '') + ' <span class="text-secondary">' + escapeHtml(c.phone) + '</span></label>';
        }).join('');
    } catch (e) { /* ignore */ }
}

function syncVoiceContactSelection() {
    var checks = document.querySelectorAll('.voice-contact-check:checked');
    var selected = [];
    checks.forEach(function(cb) {
        var p = normalizePhone(cb.dataset.phone);
        if (selected.indexOf(p) === -1) selected.push(p);
    });
    state.voiceCall.selectedContacts = selected;
}

async function loadVoiceGroupContacts(groupId) {
    var preview = document.getElementById('voice-group-preview');
    if (!groupId) { if (preview) preview.textContent = ''; state.voiceCall.groupPhones = []; return; }
    try {
        var data = await api('/api/contacts?group_id=' + groupId + '&per_page=1000');
        var phones = (data.contacts || []).map(function(c){ return normalizePhone(c.phone); });
        state.voiceCall.groupPhones = phones;
        if (preview) preview.textContent = phones.length + ' contacto(s) en el grupo.';
    } catch (e) { if (preview) preview.textContent = 'Error: ' + e.message; }
}

function loadVoiceTemplate(id) {
    var tpl = (window._voiceTemplates || []).find(function(t){ return String(t.id) === String(id); });
    var ta = document.getElementById('voice-script');
    if (tpl && ta) ta.value = tpl.content;
}

function collectVoicePhones() {
    var mode = state.voiceCall.mode;
    var phones = [];
    var add = function(p) { p = normalizePhone(p); if (p && phones.indexOf(p) === -1) phones.push(p); };
    if (mode === 'manual') {
        (state.voiceCall.phones || []).forEach(add);
    } else if (mode === 'contacts') {
        (state.voiceCall.selectedContacts || []).forEach(add);
    } else if (mode === 'group') {
        (state.voiceCall.groupPhones || []).forEach(add);
    }
    return phones;
}

async function handlePlaceCalls() {
    var errBox = document.getElementById('voice-error');
    errBox.style.display = 'none';
    var script = (document.getElementById('voice-script').value || '').trim();
    var phones = collectVoicePhones();
    if (!phones.length) { errBox.textContent = 'Seleccione o ingrese al menos un numero.'; errBox.style.display='block'; return; }
    if (phones.length > 200) { errBox.textContent = 'Maximo 200 numeros por tanda.'; errBox.style.display='block'; return; }
    if (!confirm('Se iniciaran ' + phones.length + ' llamada(s). Continuar?')) return;
    try {
        var result = await api('/api/voice/call', { method: 'POST', body: { phones: phones, script: script } });
        if (result.errors && result.errors.length) {
            errBox.innerHTML = '<strong>' + (result.message || 'Algunas llamadas fallaron') + '</strong><ul style="margin:6px 0 0 18px;padding:0;">' +
                result.errors.map(function(e) { return '<li>' + escapeHtml(e) + '</li>'; }).join('') + '</ul>';
            errBox.style.display = 'block';
            showToast((result.message || 'Llamadas con errores') + (result.simulated ? ' (simulacion)' : ''), 'warning');
        } else {
            showToast((result.message || 'Llamadas iniciadas') + (result.simulated ? ' (modo simulacion - API de voz no configurada)' : ''), 'success');
        }
        state.voiceCall.phones = [];
        state.voiceCall.selectedContacts = [];
        state.voiceCall.groupPhones = [];
        renderVoicePhoneTags();
        loadVoiceRecords();
        // Refresh stats
        renderCalls(document.getElementById('page-content'));
    } catch (e) {
        errBox.textContent = e.message || 'Error al iniciar llamadas';
        errBox.style.display = 'block';
    }
}

async function loadVoiceRecords() {
    var container = document.getElementById('voice-records-container');
    if (!container) return;
    try {
        var params = new URLSearchParams({ page: state.calls.page, per_page: state.calls.perPage });
        if (state.calls.status) params.set('status', state.calls.status);
        if (state.calls.search) params.set('search', state.calls.search);
        if (state.calls.dateFrom) params.set('date_from', state.calls.dateFrom);
        if (state.calls.dateTo) params.set('date_to', state.calls.dateTo);
        var data = await api('/api/voice/records?' + params.toString());
        state.calls.total = data.total;
        var rows = data.records.length === 0
            ? '<tr><td colspan="9" class="text-center text-secondary" style="padding:32px;">No hay llamadas registradas</td></tr>'
            : data.records.map(function(r) {
                var isReal = r.call_sid && r.call_sid.indexOf('SIM') !== 0;
                var active = ['pending', 'initiated', 'ringing', 'answered'].indexOf(r.status) !== -1;
                var actions = '';
                if (isReal) {
                    actions += '<button class="btn btn-ghost btn-sm" onclick="refreshVoiceStatus(' + r.id + ',\'' + escapeHtml(r.call_sid) + '\')" title="Actualizar estado"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg></button>';
                    if (r.record_file) {
                        actions += '<button class="btn btn-ghost btn-sm" onclick="playVoiceRecording(' + r.id + ')" title="Reproducir grabacion" style="color:#2563EB;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg></button>';
                    }
                    if (active && r.provider === 'infin8linx') {
                        actions += '<button class="btn btn-ghost btn-sm" onclick="hangupVoiceCall(' + r.id + ')" title="Colgar" style="color:#DC2626;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91"/></svg></button>';
                    }
                } else {
                    actions = '<span class="text-secondary text-sm">simulada</span>';
                }
                return '<tr><td class="text-sm text-secondary">' + formatDate(r.created_at) + '</td><td>' + escapeHtml(r.phone) + '</td><td>' + escapeHtml(r.contact_name || '-') + '</td><td class="text-sm">' + escapeHtml(r.ext_used || '-') + '</td><td class="text-sm" style="max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + escapeHtml(r.script) + '">' + escapeHtml(r.script) + '</td><td>' + getVoiceStatusBadge(r.status) + '</td><td class="text-sm">' + formatDuration(r.duration) + '</td><td class="text-sm text-secondary">' + escapeHtml(r.sender_full_name || r.sender_username || '-') + '</td><td style="white-space:nowrap;">' + actions + (r.error_msg ? '<div class="text-secondary text-sm" title="' + escapeHtml(r.error_msg) + '" style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#DC2626;">' + escapeHtml(r.error_msg) + '</div>' : '') + '</td></tr>';
            }).join('');
        container.innerHTML =
            '<div class="table-container"><table><thead><tr><th>Fecha</th><th>Telefono</th><th>Nombre</th><th>Ext.</th><th>Guion</th><th>Estado</th><th>Duracion</th><th>Operador</th><th>Acciones</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
            renderPagination({ page: data.page, per_page: data.per_page, total: data.total, total_pages: Math.ceil(data.total / data.per_page) }, 'calls');
    } catch (e) {
        container.innerHTML = '<div class="empty-state"><p>' + escapeHtml(e.message) + '</p></div>';
    }
}

async function refreshVoiceStatus(id, sid) {
    try {
        const r = await api('/api/voice/query-status', { method: 'POST', body: { id: id, call_sid: sid } });
        if (r && r.live_status_supported === false) {
            showToast(r.message || 'El estado en tiempo real no esta soportado; se actualiza via CDR/callback.', 'info');
        } else {
            showToast('Estado actualizado', 'success');
        }
        loadVoiceRecords();
    } catch (e) { showToast(e.message, 'error'); }
}

async function hangupVoiceCall(id) {
    if (!confirm('Seguro que deseas colgar esta llamada?')) return;
    try {
        const r = await api('/api/voice/hangup', { method: 'POST', body: { id: id } });
        showToast(r.message || 'Llamada colgada', 'success');
        loadVoiceRecords();
    } catch (e) { showToast(e.message, 'error'); }
}

async function playVoiceRecording(id) {
    try {
        const r = await api('/api/voice/recording?id=' + encodeURIComponent(id));
        if (r && r.url) {
            window.open(r.url, '_blank', 'noopener');
        } else {
            showToast('No se pudo obtener la grabacion', 'error');
        }
    } catch (e) { showToast(e.message, 'error'); }
}

function triggerVoiceSearch() { state.calls.search = document.getElementById('voice-search').value; state.calls.page = 1; loadVoiceRecords(); }
function handleVoiceStatus(s) { state.calls.status = s; state.calls.page = 1; loadVoiceRecords(); }
function handleVoiceDateFrom(d) { state.calls.dateFrom = d; state.calls.page = 1; loadVoiceRecords(); }
function handleVoiceDateTo(d) { state.calls.dateTo = d; state.calls.page = 1; loadVoiceRecords(); }

// ============================================================
// Voice Config (admin) - one card per country, like API SMS config
// ============================================================
var VOICE_COUNTRY_LABELS = { mx: 'Mexico', co: 'Colombia', pe: 'Peru' };

async function renderVoiceConfig(container) {
    container.innerHTML = '<div class="text-center text-secondary">Cargando...</div>';
    try {
        var res = await api('/api/config/voice');
        var configs = res.configs || [];
        var anyConfigured = configs.some(function(c) { return c.configured; });
        var cards = configs.map(function(c) {
            var label = VOICE_COUNTRY_LABELS[c.country] || c.name || c.country;
            var statusBadge = c.configured
                ? '<span class="badge badge-green">Configurada</span>'
                : '<span class="badge badge-yellow">No configurada - Simulacion</span>';
            return '' +
                '<div class="card mb-3" data-vc-id="' + c.id + '">' +
                  '<div class="card-header" style="display:flex;align-items:center;gap:10px;">' +
                    '<h3 style="margin:0;">' + escapeHtml(c.name || label) + ' <span class="badge badge-blue">' + escapeHtml((c.country || '').toUpperCase()) + '</span></h3>' +
                    '<span style="margin-left:auto;">' + statusBadge + '</span>' +
                  '</div>' +
                  '<div class="card-body">' +
                    '<form onsubmit="saveVoiceConfig(event, ' + c.id + ')">' +
                      '<div class="form-grid">' +
                        '<div class="form-group"><label>URL de la API</label><input type="text" name="api_domain" value="' + escapeHtml(c.api_domain || '') + '" placeholder="host:puerto (ej: mex.infin8link.com:4434)"></div>' +
                        '<div class="form-group"><label>AppID</label><input type="text" name="voice_appid" value="' + escapeHtml(c.voice_appid || '') + '" placeholder="AppID autorizado"></div>' +
                        '<div class="form-group"><label>AccessKey</label><input type="password" name="voice_accesskey" placeholder="' + (c.has_accesskey ? '******** (configurada - dejar vacia para conservar)' : 'AccessKey autorizada') + '"></div>' +
                        '<div class="form-group"><label>Numero remitente (disnumber, opcional)</label><input type="text" name="from_number" value="' + escapeHtml(c.from_number || '') + '" placeholder="Dejar vacio para asignar uno aleatorio"></div>' +
                      '</div>' +
                      '<div class="alert alert-warning" style="font-size:13px;margin-top:4px;"><strong>Infinity</strong> (infin8linx) <strong>MakeCall</strong> conecta primero la extension del agente con el numero destino (click-to-call); no es un broadcast TTS. El guion lo lee el agente. Las extensiones se gestionan por separado en la pagina <a href="#/extensions">Extensiones</a>.</div>' +
                      '<div class="flex gap-2 mt-3">' +
                        '<button type="submit" class="btn btn-primary">Guardar</button>' +
                        '<button type="button" class="btn btn-secondary" onclick="testVoiceConfig(' + c.id + ', \'' + escapeHtml(c.country || '') + '\')">Probar conexion</button>' +
                      '</div>' +
                      '<div class="vc-result mt-3"></div>' +
                    '</form>' +
                  '</div>' +
                '</div>';
        }).join('');

        container.innerHTML =
            '<div class="flex-between mb-4"><h1 style="font-size:22px;font-weight:700;">Configuracion de Voz (电呼)</h1></div>' +
            '<div class="card mb-4"><div class="card-body"><div class="alert alert-info" style="margin:0;">Proveedor unico: <strong>Infinity</strong> (infin8linx, click-to-call por extension). Cada pais (Mexico/Colombia/Peru) tiene su propia configuracion, igual que las API SMS. ' + (anyConfigured ? '' : 'Mientras no se configuren credenciales validas, el sistema opera en <strong>modo simulacion</strong>.') + ' Los agentes de un pais usan automaticamente su configuracion y su pool de extensiones.</div></div></div>' +
            cards +
            '<div class="flex gap-2 mt-2"><a class="btn btn-outline" href="#/calls">Ir a Llamadas</a><a class="btn btn-outline" href="#/extensions">Gestionar Extensiones</a></div>';
    } catch (e) {
        container.innerHTML = '<div class="empty-state"><h3>Error</h3><p>' + escapeHtml(e.message) + '</p></div>';
    }
}

async function saveVoiceConfig(event, configId) {
    event.preventDefault();
    var form = event.target;
    var result = form.closest('.card').querySelector('.vc-result');
    var body = {
        name: form.closest('.card').querySelector('h3').childNodes[0].textContent.trim(),
        api_domain: form.api_domain.value.trim(),
        voice_appid: form.voice_appid.value.trim(),
        from_number: form.from_number.value.trim()
    };
    if (form.voice_accesskey.value) body.voice_accesskey = form.voice_accesskey.value;
    try {
        var res = await api('/api/config/voice/' + configId, { method: 'PUT', body: body });
        result.innerHTML = '<div class="alert alert-success">' + escapeHtml(res.message || 'Guardado') + '</div>';
    } catch (e) {
        result.innerHTML = '<div class="alert alert-error">' + escapeHtml(e.message) + '</div>';
    }
}

async function testVoiceConfig(configId, country) {
    var card = document.querySelector('.card[data-vc-id="' + configId + '"]');
    var result = card ? card.querySelector('.vc-result') : null;
    if (result) result.innerHTML = '<div class="text-secondary">Probando conexion...</div>';
    try {
        var res = await api('/api/config/voice/test', { method: 'POST', body: { config_id: configId } });
        if (result) result.innerHTML = '<div class="alert alert-success">OK: ' + escapeHtml(res.message || 'Conectado') + '</div>';
    } catch (e) {
        if (result) result.innerHTML = '<div class="alert alert-error">Fallo: ' + escapeHtml(e.message) + '</div>';
    }
}

// ============================================================
// Extensions (分机号) management page - admin only
// ============================================================

var EXT_COUNTRIES = [
    { code: 'mx', label: 'Mexico' },
    { code: 'co', label: 'Colombia' },
    { code: 'pe', label: 'Peru' }
];
var extState = { country: 'mx', data: null };

function renderExtensions(content) {
    content.innerHTML =
        '<h1 style="margin-bottom:4px;">Extensiones / Telefonos de agentes (分机号)</h1>' +
        '<p style="color:var(--text-secondary);margin-bottom:20px;">Cargue y administre las extensiones SIP por pais. Las extensiones se asignan automaticamente a los agentes de ese pais; no se pueden ingresar manualmente.</p>' +
        '<div class="card" style="padding:0;overflow:hidden;">' +
            '<div style="display:flex;gap:4px;padding:12px 16px;border-bottom:1px solid var(--border);flex-wrap:wrap;">' +
                EXT_COUNTRIES.map(function(c) {
                    return '<button type="button" data-exttab="' + c.code + '" class="btn btn-' + (c.code === extState.country ? 'primary' : 'ghost') + '" style="min-width:130px;">' + c.label + '</button>';
                }).join('') +
            '</div>' +
            '<div id="ext-body" style="padding:20px;"><div class="loading">Cargando...</div></div>' +
        '</div>';
    content.querySelectorAll('[data-exttab]').forEach(function(btn) {
        btn.addEventListener('click', function() {
            extState.country = btn.dataset.exttab;
            renderExtensions(content);
        });
    });
    loadExtensions();
}

function loadExtensions() {
    api('/api/extensions?country=' + encodeURIComponent(extState.country)).then(function(d) {
        extState.data = d;
        renderExtensionsBody();
    }).catch(function(e) {
        var body = document.getElementById('ext-body');
        if (body) body.innerHTML = '<div class="alert alert-danger">' + escapeHtml(e.message || 'Error al cargar') + '</div>';
    });
}

function renderExtensionsBody() {
    var body = document.getElementById('ext-body');
    if (!body || !extState.data) return;
    var d = extState.data;
    var rows = (d.extensions || []).map(function(e) {
        var assigned = e.status === 'assigned';
        var agent = assigned ? escapeHtml(e.agent_full_name || e.agent_username || ('#' + e.assigned_to)) : '';
        return '<tr>' +
            '<td style="font-weight:600;">' + escapeHtml(e.extnumber) + '</td>' +
            '<td>' + (assigned
                ? '<span class="badge badge-green">Asignada</span>'
                : '<span class="badge badge-gray">Libre</span>') + '</td>' +
            '<td>' + (agent || '<span style="color:var(--text-muted);">—</span>') + '</td>' +
            '<td style="text-align:right;">' +
                (assigned ? '' : '<button type="button" data-del="' + e.id + '" class="btn btn-ghost btn-sm" style="color:var(--danger);">Eliminar</button>') +
            '</td>' +
        '</tr>';
    }).join('');
    body.innerHTML =
        '<div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:16px;">' +
            '<div class="stat-mini"><div class="stat-num">' + d.total + '</div><div class="stat-label">Total</div></div>' +
            '<div class="stat-mini"><div class="stat-num" style="color:var(--success);">' + d.free + '</div><div class="stat-label">Libres</div></div>' +
            '<div class="stat-mini"><div class="stat-num" style="color:var(--primary);">' + d.assigned + '</div><div class="stat-label">Asignadas</div></div>' +
        '</div>' +

        '<div class="ext-upload-card">' +
            '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;">' +
                '<div>' +
                    '<div style="font-weight:600;font-size:15px;">Cargar extensiones para ' + escapeHtml(d.country_label) + '</div>' +
                    '<div style="font-size:12px;color:var(--text-secondary);margin-top:2px;">Formatos admitidos: Excel (.xlsx), CSV, TXT. Una extension por fila o separadas por coma.</div>' +
                '</div>' +
                '<a href="/api/extensions/template" class="btn btn-ghost btn-sm" download>' +
                    '<i data-lucide="download"></i> Descargar plantilla' +
                '</a>' +
            '</div>' +
            '<label id="ext-dropzone" class="ext-dropzone" for="ext-file">' +
                '<input type="file" id="ext-file" accept=".xlsx,.xls,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/plain" style="display:none;">' +
                '<div class="ext-dropzone-inner">' +
                    '<i data-lucide="upload-cloud" style="width:32px;height:32px;"></i>' +
                    '<div style="font-weight:600;margin-top:8px;">Haga clic para seleccionar un archivo</div>' +
                    '<div style="font-size:12px;color:var(--text-secondary);">o arrastrelo aqui</div>' +
                '</div>' +
            '</label>' +
            '<div id="ext-file-status" class="ext-file-status" style="display:none;"></div>' +
        '</div>' +

        '<details class="ext-manual">' +
            '<summary>Pegar extensiones manualmente</summary>' +
            '<textarea id="ext-bulk" rows="4" style="width:100%;font-family:monospace;margin-top:10px;" placeholder="8001, 8002, 8003&#10;8004&#10;8005"></textarea>' +
            '<p style="font-size:12px;color:var(--text-secondary);margin:8px 0 12px;">Separe por comas, saltos de linea o espacios. Las extensiones duplicadas se omiten.</p>' +
            '<button type="button" id="ext-upload-btn" class="btn btn-primary">Subir extensiones</button>' +
        '</details>' +
        '<span id="ext-upload-result" style="display:inline-block;margin:12px 0;font-size:13px;"></span>' +

        '<div class="table-wrap">' +
            '<table class="data-table"><thead><tr>' +
                '<th>Extension</th><th>Estado</th><th>Agente</th><th style="text-align:right;">Acciones</th>' +
            '</tr></thead><tbody>' +
                (rows || '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:24px;">No hay extensiones. Carguelas arriba.</td></tr>') +
            '</tbody></table>' +
        '</div>';

    // Icons in freshly injected markup
    if (window.lucide) { try { window.lucide.createIcons(); } catch (e) {} }

    wireExtensionsUpload();
    body.querySelectorAll('[data-del]').forEach(function(b) {
        b.addEventListener('click', function() { deleteExtension(b.dataset.del); });
    });
}

function wireExtensionsUpload() {
    var fileInput = document.getElementById('ext-file');
    var dropzone = document.getElementById('ext-dropzone');
    var fileStatus = document.getElementById('ext-file-status');
    if (!fileInput || !dropzone) return;

    function handleFile(file) {
        if (!file) return;
        if (fileStatus) {
            fileStatus.style.display = 'block';
            fileStatus.className = 'ext-file-status ext-status-uploading';
            fileStatus.textContent = 'Subiendo ' + file.name + '...';
        }
        var fd = new FormData();
        fd.append('file', file);
        fd.append('country', extState.country);
        api('/api/extensions', { method: 'POST', body: fd }).then(function(d) {
            if (fileStatus) {
                fileStatus.className = 'ext-file-status ext-status-ok';
                var msg = 'Archivo: ' + file.name + ' — Agregadas: ' + d.added_count + ', duplicadas: ' + d.duplicate_count;
                if (d.invalid_count) msg += ', invalidas: ' + d.invalid_count;
                fileStatus.textContent = msg;
            }
            fileInput.value = '';
            loadExtensions();
        }).catch(function(e) {
            if (fileStatus) {
                fileStatus.className = 'ext-file-status ext-status-error';
                fileStatus.textContent = 'Error: ' + (e.message || 'No se pudo subir el archivo');
            }
            fileInput.value = '';
        });
    }

    fileInput.addEventListener('change', function() {
        handleFile(fileInput.files && fileInput.files[0]);
    });
    ['dragenter', 'dragover'].forEach(function(evt) {
        dropzone.addEventListener(evt, function(e) { e.preventDefault(); e.stopPropagation(); dropzone.classList.add('dragover'); });
    });
    ['dragleave', 'dragend', 'drop'].forEach(function(evt) {
        dropzone.addEventListener(evt, function(e) { e.preventDefault(); e.stopPropagation(); dropzone.classList.remove('dragover'); });
    });
    dropzone.addEventListener('drop', function(e) {
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
            handleFile(e.dataTransfer.files[0]);
        }
    });

    var upBtn = document.getElementById('ext-upload-btn');
    if (upBtn) upBtn.addEventListener('click', uploadExtensions);
}

function uploadExtensions() {
    var ta = document.getElementById('ext-bulk');
    var result = document.getElementById('ext-upload-result');
    var raw = ta ? ta.value.trim() : '';
    if (!raw) { if (result) result.textContent = 'Escriba al menos una extension.'; return; }
    if (result) { result.style.color = 'var(--text-secondary)'; result.textContent = 'Subiendo...'; }
    api('/api/extensions', {
        method: 'POST',
        body: { country: extState.country, extensions: raw }
    }).then(function(d) {
        if (result) {
            result.style.color = 'var(--success)';
            result.textContent = 'Agregadas: ' + d.added_count + '. Duplicadas: ' + d.duplicate_count + (d.invalid_count ? '. Invalidas: ' + d.invalid_count : '');
        }
        if (ta) ta.value = '';
        loadExtensions();
    }).catch(function(e) {
        if (result) { result.style.color = 'var(--danger)'; result.textContent = e.message || 'Error'; }
    });
}

function deleteExtension(id) {
    if (!confirm('Eliminar esta extension? Solo se pueden eliminar extensiones libres.')) return;
    api('/api/extensions/' + id, { method: 'DELETE' }).then(function() {
        loadExtensions();
    }).catch(function(e) { alert(e.message || 'Error al eliminar'); });
}

// ============================================================
// Retencion de contactos por categoria de empleado
// ============================================================
var retentionState = { categories: [], autoClear: null };

function retentionLabel(days) {
    var n = parseInt(days, 10);
    return n + (n === 1 ? ' dia' : ' dias');
}

function retentionDaysOptions(selected) {
    var sel = parseInt(selected, 10);
    if (!sel || sel < 1 || sel > 7) sel = 7;
    var opts = '';
    for (var d = 1; d <= 7; d++) {
        opts += '<option value="' + d + '"' + (d === sel ? ' selected' : '') + '>' +
            d + (d === 1 ? ' dia' : ' dias') + '</option>';
    }
    return opts;
}

async function renderRetention(container) {
    var isAdmin = state.user.role === 'admin';
    var newBtn = isAdmin
        ? '<button class="btn btn-primary btn-sm" onclick="showCategoryModal()"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg> Nueva categoria</button>'
        : '';
    var clearCard = isAdmin
        ? '<div class="card" id="retention-clear-card"><div class="card-header"><h3>Limpieza automatica</h3></div><div class="card-body"><div class="loading">Cargando...</div></div></div>'
        : '';
    container.innerHTML =
        '<h1 style="margin-bottom:4px;">Retencion de Contactos por Categoria</h1>' +
        '<p style="color:var(--text-secondary);margin-bottom:20px;">Clasifique a los empleados y defina cuantos dias se conservan sus contactos. Esta regla reemplaza la limpieza diaria total: cada dia se eliminan solo los contactos mas antiguos que el plazo de la categoria de su propietario.</p>' +
        '<div class="card mb-4" id="retention-cats-card"><div class="card-header" style="display:flex;justify-content:space-between;align-items:center;"><h3>Categorias de empleados</h3>' + newBtn + '</div><div class="card-body" style="padding:0;"><div class="loading">Cargando...</div></div></div>' +
        clearCard;
    if (isAdmin) {
        await Promise.all([loadCategoriesForRetention(), loadAutoClearForRetention()]);
    } else {
        await loadCategoriesForRetention();
    }
}

function loadCategoriesForRetention() {
    return api('/api/user-categories').then(function(d) {
        retentionState.categories = d.categories || [];
        renderRetentionCategories();
    }).catch(function(e) {
        var body = document.querySelector('#retention-cats-card .card-body');
        if (body) body.innerHTML = '<div class="alert alert-danger">' + escapeHtml(e.message || 'Error al cargar') + '</div>';
    });
}

function loadAutoClearForRetention() {
    return api('/api/config/auto-clear').then(function(d) {
        retentionState.autoClear = d;
        renderRetentionAutoClear();
    }).catch(function(e) {
        var body = document.querySelector('#retention-clear-card .card-body');
        if (body) body.innerHTML = '<div class="alert alert-danger">' + escapeHtml(e.message || 'Error al cargar') + '</div>';
    });
}

function renderRetentionCategories() {
    var body = document.querySelector('#retention-cats-card .card-body');
    if (!body) return;
    var cats = retentionState.categories || [];
    if (!cats.length) {
        body.innerHTML = '<div class="empty-state">Sin categorias</div>';
        return;
    }
    var canManage = (state.user.role === 'admin' || state.user.role === 'team_admin');
    var rows = cats.map(function(c) {
        var isDefault = c.is_default;
        var count = (typeof c.user_count === 'number') ? c.user_count : null;
        var actions = canManage
            ? '<button class="btn btn-ghost btn-sm" onclick="showCategoryModal(' + c.id + ')">Editar</button>' +
              (isDefault ? '' : ' <button class="btn btn-danger btn-sm" onclick="deleteCategory(' + c.id + ')">Eliminar</button>')
            : '';
        return '<tr>' +
            '<td style="font-weight:600;">' + escapeHtml(c.name) + (isDefault ? ' <span class="badge badge-blue">por defecto</span>' : '') + '</td>' +
            '<td>' + retentionLabel(c.retention_days) + '</td>' +
            '<td>' + (count !== null ? count : '-') + '</td>' +
            '<td style="text-align:right;white-space:nowrap;">' + actions + '</td>' +
        '</tr>';
    }).join('');
    body.innerHTML =
        '<div class="table-container"><table>' +
            '<thead><tr><th>Categoria</th><th>Retencion de contactos</th><th>Empleados</th><th style="text-align:right;">Acciones</th></tr></thead>' +
            '<tbody>' + rows + '</tbody>' +
        '</table></div>' +
        '<p style="padding:12px 16px 0;color:var(--text-secondary);font-size:12px;">0 dias = los contactos se conservan permanentemente. Los contactos sin propietario o sin categoria nunca se eliminan.</p>';
}

function renderRetentionAutoClear() {
    var body = document.querySelector('#retention-clear-card .card-body');
    if (!body || !retentionState.autoClear) return;
    var cfg = retentionState.autoClear;
    var lastRun = cfg.last_run_at ? formatDate(cfg.last_run_at) : 'Nunca';
    var checked = cfg.enabled ? 'checked' : '';
    var statusLine = cfg.last_run_status && cfg.last_run_status !== 'ok'
        ? '<span style="color:var(--danger);">' + escapeHtml(cfg.last_run_status) + '</span>'
        : 'OK';
    body.innerHTML =
        '<div style="display:flex;flex-direction:column;gap:16px;">' +
            '<label style="display:flex;align-items:center;gap:10px;cursor:pointer;">' +
                '<input type="checkbox" id="retention-enabled" ' + checked + ' style="width:18px;height:18px;accent-color:var(--primary);">' +
                '<span>Activar limpieza automatica diaria (solo contactos vencidos por categoria)</span>' +
            '</label>' +
            '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">' +
                '<label for="retention-time" style="font-weight:500;">Hora de ejecucion:</label>' +
                '<input type="time" id="retention-time" class="form-control" style="width:auto;" value="' + escapeHtml(cfg.time || '03:00') + '">' +
                '<button class="btn btn-primary btn-sm" onclick="saveAutoClear()">Guardar</button>' +
                '<button class="btn btn-secondary btn-sm" onclick="runAutoClearNow()">Ejecutar ahora</button>' +
            '</div>' +
            '<div style="font-size:13px;color:var(--text-secondary);border-top:1px solid var(--border);padding-top:12px;">' +
                '<div>Ultima ejecucion: <strong>' + lastRun + '</strong></div>' +
                '<div>Contactos eliminados en la ultima ejecucion: <strong>' + (cfg.last_run_count || 0) + '</strong> (' + statusLine + ')</div>' +
            '</div>' +
        '</div>';
}

function saveAutoClear() {
    var enabled = document.getElementById('retention-enabled').checked;
    var time = document.getElementById('retention-time').value;
    api('/api/config/auto-clear', { method: 'PUT', body: { enabled: enabled, time: time } }).then(function(d) {
        retentionState.autoClear = d;
        renderRetentionAutoClear();
        showToast('Configuracion guardada', 'success');
    }).catch(function(e) { showToast(e.message || 'Error', 'error'); });
}

function runAutoClearNow() {
    if (!confirm('Ejecutar ahora la limpieza de contactos vencidos segun las categorias?')) return;
    api('/api/config/auto-clear/run-now', { method: 'POST' }).then(function(d) {
        showToast('Limpieza completada: ' + d.deleted + ' contacto(s) eliminados', 'success');
        loadAutoClearForRetention();
    }).catch(function(e) { showToast(e.message || 'Error', 'error'); });
}

function showCategoryModal(id) {
    var cat = null;
    if (id) {
        cat = (retentionState.categories || []).find(function(c) { return c.id === id; });
        if (!cat) return;
    }
    var title = cat ? 'Editar categoria' : 'Nueva categoria';
    var nameVal = cat ? escapeHtml(cat.name) : '';
    var daysVal = cat ? cat.retention_days : 7;
    var body =
        '<form id="category-form" onsubmit="saveCategory(event, ' + (id || 'null') + ')">' +
            '<div class="form-group"><label>Nombre de la categoria</label><input type="text" name="name" class="form-control" required maxlength="100" value="' + nameVal + '" placeholder="Ej. Ventas, Cobranza, Administrador"></div>' +
            '<div class="form-group"><label>Dias de retencion de contactos</label><select name="retention_days" class="form-control" required>' + retentionDaysOptions(daysVal) + '</select><small style="color:var(--text-secondary);">Cuantos dias se conservan los contactos de los empleados de esta categoria (de 1 a 7 dias).</small></div>' +
            '<div class="modal-footer" style="padding:16px 0 0;"><button type="button" class="btn btn-secondary" onclick="hideModal()">Cancelar</button><button type="submit" class="btn btn-primary">Guardar</button></div>' +
        '</form>';
    showModal(title, body);
}

async function saveCategory(event, id) {
    event.preventDefault();
    var form = event.target;
    var payload = { name: form.name.value.trim(), retention_days: parseInt(form.retention_days.value, 10) };
    if (!payload.name) { showToast('El nombre es obligatorio', 'error'); return; }
    if (isNaN(payload.retention_days) || payload.retention_days < 1 || payload.retention_days > 7) { showToast('Los dias deben estar entre 1 y 7', 'error'); return; }
    try {
        if (id) {
            await api('/api/user-categories/' + id, { method: 'PUT', body: payload });
        } else {
            await api('/api/user-categories', { method: 'POST', body: payload });
        }
        hideModal();
        showToast('Categoria guardada', 'success');
        loadCategoriesForRetention();
    } catch (e) { showToast(e.message || 'Error', 'error'); }
}

function deleteCategory(id) {
    if (!confirm('Eliminar esta categoria? Los empleados de esta categoria quedaran sin categoria (contactos permanentes).')) return;
    api('/api/user-categories/' + id, { method: 'DELETE' }).then(function() {
        showToast('Categoria eliminada', 'success');
        loadCategoriesForRetention();
    }).catch(function(e) { showToast(e.message || 'Error', 'error'); });
}

// ============================================================
// Initialize
// ============================================================
checkAuth();
