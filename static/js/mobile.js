// Mobile native bridge for Capacitor Android app.
// When the app loads the remote server via server.url, window.Capacitor is
// injected by the native WebView and relative /api calls hit the same origin.
(function () {
    'use strict';

    function getPlugins() {
        var cap = window.Capacitor;
        if (cap && cap.Plugins) return cap.Plugins;
        if (window.capacitorExports && window.capacitorExports.Plugins) return window.capacitorExports.Plugins;
        return null;
    }

    function getContactsPlugin() {
        var plugins = getPlugins();
        return plugins ? (plugins.Contacts || plugins.ContactsX) : null;
    }

    function normalizeContacts(raw) {
        var list = [];
        (raw || []).forEach(function (c) {
            var name =
                (c && c.displayName) ||
                (c && c.name && (c.name.display || c.name.formatted ||
                    ((c.name.given || '') + ' ' + (c.name.family || '')).trim())) ||
                '';
            var phones = [];
            if (c) {
                if (Array.isArray(c.phones)) phones = c.phones;
                else if (Array.isArray(c.phoneNumbers)) phones = c.phoneNumbers;
            }
            var numbers = phones
                .map(function (p) {
                    if (typeof p === 'string') return p.trim();
                    return String(p && (p.number || p.phoneNumber || p.label) || '').trim();
                })
                .filter(Boolean);
            if (!numbers.length) return;
            numbers.forEach(function (phone) {
                list.push({ name: (name || phone).trim(), phone: phone, notes: '' });
            });
        });
        return list;
    }

    var nativeBridge = {
        platform: function () {
            var cap = window.Capacitor;
            if (cap && cap.getPlatform) return cap.getPlatform();
            if (cap) return 'android';
            return 'web';
        },
        isApp: function () {
            return this.platform() !== 'web';
        },
        isEmbedded: function () {
            try { return window.self !== window.top && !!window.parent; }
            catch (e) { return true; }
        },
        contactsAvailable: function () {
            return !!getContactsPlugin();
        },
        requestContactsPermission: async function () {
            var Contacts = getContactsPlugin();
            if (!Contacts) throw new Error('Puente de contactos no disponible');
            var perm;
            try {
                perm = await Contacts.checkPermissions();
            } catch (e) {
                perm = { contacts: 'prompt' };
            }
            var status = perm && (perm.contacts || perm.permission);
            if (status !== 'granted' && status !== 'limited') {
                var req = await Contacts.requestPermissions();
                status = req && (req.contacts || req.permission);
            }
            if (status !== 'granted' && status !== 'limited') {
                throw new Error('Permiso de contactos denegado');
            }
            return true;
        },
        getContacts: async function () {
            // 1) Native Capacitor bridge
            if (this.contactsAvailable()) {
                await this.requestContactsPermission();
                var Contacts = getContactsPlugin();
                var result = await Contacts.getContacts({
                    projection: { name: true, phones: true }
                });
                var contacts = normalizeContacts(result && result.contacts);
                if (!contacts.length) throw new Error('No se encontraron contactos con telefono');
                return contacts;
            }
            // 2) Embedded inside a native shell that proxies via postMessage
            if (this.isEmbedded()) {
                return await this.getContactsViaPostMessage();
            }
            // 3) Web Contact Picker API (Chrome on Android)
            if (navigator.contacts && navigator.contacts.select) {
                var props = ['name', 'tel'];
                if (navigator.contacts.getProperties) {
                    props = navigator.contacts.getProperties().filter(function (p) {
                        return p === 'name' || p === 'tel';
                    });
                }
                var selected = await navigator.contacts.select(props, { multiple: true });
                return (selected || []).map(function (c) {
                    var name = Array.isArray(c.name) ? (c.name[0] || '') : (c.name || '');
                    var tels = Array.isArray(c.tel) ? c.tel : (c.tel ? [c.tel] : []);
                    var phone = (tels.find(function (t) {
                        return t && t.replace(/\D/g, '').length >= 7;
                    }) || tels[0] || '').replace(/[\s\-()]/g, '');
                    return { name: name, phone: phone, notes: '' };
                }).filter(function (r) { return r.name && r.phone; });
            }
            throw new Error(
                'Tu dispositivo no permite leer contactos desde esta pagina. Usa la app Android o importa un CSV.'
            );
        },
        getFloatingPlugin: function () {
            var plugins = getPlugins();
            return plugins ? plugins.FloatingBubble : null;
        },
        canDrawOverlays: async function () {
            var p = this.getFloatingPlugin();
            if (!p) return false;
            try {
                var r = await p.canDrawOverlays();
                return !!(r && r.granted);
            } catch (e) { return false; }
        },
        requestOverlayPermission: async function () {
            var p = this.getFloatingPlugin();
            if (!p) return false;
            try {
                var r = await p.requestOverlayPermission();
                return !!(r && r.granted);
            } catch (e) { return false; }
        },
        requestAllBubblePermissions: async function () {
            var p = this.getFloatingPlugin();
            if (!p) return null;
            try { return await p.requestAllPermissions(); }
            catch (e) { return null; }
        },
        isIgnoringBatteryOptimizations: async function () {
            var p = this.getFloatingPlugin();
            if (!p) return true;
            try {
                var r = await p.isIgnoringBatteryOptimizations();
                return !!(r && r.ignoring);
            } catch (e) { return true; }
        },
        openOverlaySettings: async function () {
            var p = this.getFloatingPlugin();
            if (p) { try { await p.openOverlaySettings(); } catch (e) {} }
        },
        openBatterySettings: async function () {
            var p = this.getFloatingPlugin();
            if (p) { try { await p.openBatterySettings(); } catch (e) {} }
        },
        isBubbleRunning: async function () {
            var p = this.getFloatingPlugin();
            if (!p) return false;
            try {
                var r = await p.isRunning();
                return !!(r && r.running);
            } catch (e) { return false; }
        },
        echoBubble: async function () {
            var p = this.getFloatingPlugin();
            if (!p) return { ok: false, reason: 'plugin-unavailable' };
            try { return await p.echo({ value: 'ping' }); }
            catch (e) { return { ok: false, reason: String(e) }; }
        },
        diagnoseBubble: async function () {
            var p = this.getFloatingPlugin();
            if (!p) return { available: false, reason: 'plugin-unavailable' };
            try { return await p.diagnose(); }
            catch (e) { return { available: false, reason: String(e) }; }
        },
        startBubble: async function (serverUrl) {
            var p = this.getFloatingPlugin();
            if (!p) throw new Error('El widget flotante solo esta disponible en la app Android');
            return await p.start({ url: serverUrl || window.location.origin });
        },
        stopBubble: async function () {
            var p = this.getFloatingPlugin();
            if (p) { try { return await p.stop(); } catch (e) {} }
        },
        // Hide the in-app FAB when the native system bubble is running,
        // otherwise the user sees two floating buttons.
        syncInAppFab: async function () {
            var fab = document.getElementById('quick-sms-fab');
            if (!fab) return;
            if (!this.isApp()) { fab.style.display = ''; return; }
            var p = this.getFloatingPlugin();
            if (!p) { fab.style.display = ''; return; }
            try {
                var r = await p.isRunning();
                var running = !!(r && r.running);
                fab.style.display = running ? 'none' : '';
            } catch (e) {
                fab.style.display = '';
            }
        },
        closePanel: function () {
            try {
                if (window.AndroidBubble && typeof window.AndroidBubble.closePanel === 'function') {
                    window.AndroidBubble.closePanel();
                    return true;
                }
            } catch (e) {}
            return false;
        },
        isBubblePanel: function () {
            return !!(window.AndroidBubble && typeof window.AndroidBubble.closePanel === 'function');
        },
        getContactsViaPostMessage: function () {
            return new Promise(function (resolve, reject) {
                var requestId = 'sms_ct_' + Date.now() + '_' + Math.random().toString(36).slice(2);
                var timeout = setTimeout(function () {
                    window.removeEventListener('message', handler);
                    reject(new Error('Tiempo de espera agotado al leer contactos'));
                }, 60000);
                function handler(event) {
                    var data = event.data;
                    if (!data || data.type !== 'SMS_NATIVE_RESPONSE' || data.requestId !== requestId) return;
                    clearTimeout(timeout);
                    window.removeEventListener('message', handler);
                    if (data.error) reject(new Error(data.error));
                    else resolve(data.contacts || []);
                }
                window.addEventListener('message', handler);
                window.parent.postMessage(
                    { type: 'SMS_PICK_CONTACTS', requestId: requestId },
                    '*'
                );
            });
        }
    };

    window.MobileNative = nativeBridge;

    document.addEventListener('DOMContentLoaded', function () {
        if (nativeBridge.isApp() || nativeBridge.isEmbedded()) {
            document.documentElement.classList.add('native-app');
        }
    });
})();
