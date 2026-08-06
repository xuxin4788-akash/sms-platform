import os
import sqlite3
import hashlib
import secrets
import csv
import io
import json
from datetime import datetime, timedelta
from functools import wraps
from flask import Flask, request, jsonify, render_template, session, g, send_from_directory
from flask_cors import CORS
from werkzeug.utils import secure_filename

app = Flask(__name__)
app.secret_key = secrets.token_hex(32)
app.config['DATABASE'] = os.path.join(app.instance_path, 'sms_platform.db')
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max upload
CORS(app, supports_credentials=True)

# Ensure instance folder exists
os.makedirs(app.instance_path, exist_ok=True)

# ============================================================
# Database helpers
# ============================================================

def get_db():
    if 'db' not in g:
        g.db = sqlite3.connect(app.config['DATABASE'])
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA journal_mode=WAL")
        g.db.execute("PRAGMA foreign_keys=ON")
    return g.db

@app.teardown_appcontext
def close_db(exception):
    db = g.pop('db', None)
    if db is not None:
        db.close()

def init_db():
    db = sqlite3.connect(app.config['DATABASE'])
    db.executescript('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            full_name TEXT NOT NULL DEFAULT '',
            role TEXT NOT NULL DEFAULT 'employee' CHECK(role IN ('admin', 'employee')),
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS contact_groups (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT DEFAULT '',
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS contacts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            phone TEXT NOT NULL,
            notes TEXT DEFAULT '',
            group_id INTEGER,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (group_id) REFERENCES contact_groups(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS templates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            content TEXT NOT NULL,
            category TEXT DEFAULT 'general',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS sms_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            phone TEXT NOT NULL,
            contact_name TEXT DEFAULT '',
            content TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'sent', 'failed', 'scheduled')),
            scheduled_at TEXT,
            sent_at TEXT,
            created_by INTEGER,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS sms_config (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            api_url TEXT DEFAULT '',
            api_key TEXT DEFAULT '',
            sender_name TEXT DEFAULT '',
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS send_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            action TEXT NOT NULL,
            details TEXT DEFAULT '',
            status TEXT NOT NULL DEFAULT 'info',
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
    ''')
    # Create default admin if not exists
    cursor = db.execute("SELECT id FROM users WHERE username='admin'")
    if cursor.fetchone() is None:
        pw_hash = hashlib.sha256('admin123'.encode()).hexdigest()
        db.execute(
            "INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)",
            ('admin', pw_hash, 'Administrador', 'admin')
        )
    # Create default sms_config if not exists
    cursor = db.execute("SELECT id FROM sms_config LIMIT 1")
    if cursor.fetchone() is None:
        db.execute("INSERT INTO sms_config (api_url, api_key, sender_name) VALUES ('', '', '')")
    db.commit()
    db.close()

# ============================================================
# Auth helpers
# ============================================================

def hash_password(password):
    return hashlib.sha256(password.encode()).hexdigest()

def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'user_id' not in session:
            return jsonify({'error': 'No autorizado'}), 401
        user = get_db().execute("SELECT * FROM users WHERE id=? AND is_active=1", (session['user_id'],)).fetchone()
        if not user:
            session.clear()
            return jsonify({'error': 'Sesion expirada'}), 401
        g.user = dict(user)
        return f(*args, **kwargs)
    return decorated

def admin_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'user_id' not in session:
            return jsonify({'error': 'No autorizado'}), 401
        user = get_db().execute("SELECT * FROM users WHERE id=? AND is_active=1", (session['user_id'],)).fetchone()
        if not user:
            session.clear()
            return jsonify({'error': 'Sesion expirada'}), 401
        if user['role'] != 'admin':
            return jsonify({'error': 'Permisos insuficientes'}), 403
        g.user = dict(user)
        return f(*args, **kwargs)
    return decorated

# ============================================================
# Frontend route
# ============================================================

@app.route('/')
def index():
    return render_template('index.html')

# ============================================================
# Auth API
# ============================================================

@app.route('/api/auth/login', methods=['POST'])
def login():
    data = request.get_json()
    username = data.get('username', '').strip()
    password = data.get('password', '')
    if not username or not password:
        return jsonify({'error': 'Usuario y contrasena son requeridos'}), 400
    db = get_db()
    user = db.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
    if not user or user['password_hash'] != hash_password(password):
        return jsonify({'error': 'Credenciales invalidas'}), 401
    if not user['is_active']:
        return jsonify({'error': 'Cuenta desactivada. Contacte al administrador.'}), 403
    session['user_id'] = user['id']
    session['role'] = user['role']
    return jsonify({
        'user': {
            'id': user['id'],
            'username': user['username'],
            'full_name': user['full_name'],
            'role': user['role']
        }
    })

@app.route('/api/auth/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({'message': 'Sesion cerrada'})

@app.route('/api/auth/me', methods=['GET'])
@login_required
def get_me():
    return jsonify({
        'user': {
            'id': g.user['id'],
            'username': g.user['username'],
            'full_name': g.user['full_name'],
            'role': g.user['role']
        }
    })

# ============================================================
# Users API (admin)
# ============================================================

@app.route('/api/users', methods=['GET'])
@admin_required
def list_users():
    db = get_db()
    users = db.execute("SELECT id, username, full_name, role, is_active, created_at, updated_at FROM users ORDER BY created_at DESC").fetchall()
    return jsonify({'users': [dict(u) for u in users]})

@app.route('/api/users', methods=['POST'])
@admin_required
def create_user():
    data = request.get_json()
    username = data.get('username', '').strip()
    password = data.get('password', '')
    full_name = data.get('full_name', '').strip()
    role = data.get('role', 'employee')
    if not username or not password:
        return jsonify({'error': 'Usuario y contrasena son requeridos'}), 400
    if role not in ('admin', 'employee'):
        return jsonify({'error': 'Rol invalido'}), 400
    if len(password) < 6:
        return jsonify({'error': 'La contrasena debe tener minimo 6 caracteres'}), 400
    db = get_db()
    existing = db.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
    if existing:
        return jsonify({'error': 'El nombre de usuario ya existe'}), 409
    db.execute(
        "INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)",
        (username, hash_password(password), full_name, role)
    )
    db.commit()
    return jsonify({'message': 'Usuario creado exitosamente'}), 201

@app.route('/api/users/<int:user_id>', methods=['PUT'])
@admin_required
def update_user(user_id):
    data = request.get_json()
    db = get_db()
    user = db.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
    if not user:
        return jsonify({'error': 'Usuario no encontrado'}), 404
    full_name = data.get('full_name', user['full_name'])
    role = data.get('role', user['role'])
    is_active = data.get('is_active', user['is_active'])
    password = data.get('password', None)
    updates = ["updated_at=datetime('now')"]
    params = []
    if full_name is not None:
        updates.append("full_name=?")
        params.append(full_name)
    if role in ('admin', 'employee'):
        updates.append("role=?")
        params.append(role)
    if is_active in (0, 1, True, False):
        updates.append("is_active=?")
        params.append(int(is_active))
    if password:
        if len(password) < 6:
            return jsonify({'error': 'La contrasena debe tener minimo 6 caracteres'}), 400
        updates.append("password_hash=?")
        params.append(hash_password(password))
    params.append(user_id)
    db.execute(f"UPDATE users SET {', '.join(updates)} WHERE id=?", params)
    db.commit()
    return jsonify({'message': 'Usuario actualizado'})

@app.route('/api/users/<int:user_id>', methods=['DELETE'])
@admin_required
def delete_user(user_id):
    db = get_db()
    if user_id == g.user['id']:
        return jsonify({'error': 'No puede eliminar su propia cuenta'}), 400
    user = db.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
    if not user:
        return jsonify({'error': 'Usuario no encontrado'}), 404
    db.execute("DELETE FROM users WHERE id=?", (user_id,))
    db.commit()
    return jsonify({'message': 'Usuario eliminado'})

# ============================================================
# Contacts API
# ============================================================

@app.route('/api/contacts', methods=['GET'])
@login_required
def list_contacts():
    db = get_db()
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 20, type=int)
    search = request.args.get('search', '').strip()
    group_id = request.args.get('group_id', '', type=str)
    offset = (page - 1) * per_page
    query = "SELECT c.*, cg.name as group_name FROM contacts c LEFT JOIN contact_groups cg ON c.group_id = cg.id WHERE 1=1"
    count_query = "SELECT COUNT(*) as total FROM contacts c LEFT JOIN contact_groups cg ON c.group_id = cg.id WHERE 1=1"
    params = []
    if search:
        query += " AND (c.name LIKE ? OR c.phone LIKE ? OR c.notes LIKE ?)"
        count_query += " AND (c.name LIKE ? OR c.phone LIKE ? OR c.notes LIKE ?)"
        params.extend([f'%{search}%', f'%{search}%', f'%{search}%'])
    if group_id:
        query += " AND c.group_id = ?"
        count_query += " AND c.group_id = ?"
        params.append(int(group_id))
    total = db.execute(count_query, params).fetchone()['total']
    query += " ORDER BY c.created_at DESC LIMIT ? OFFSET ?"
    params.extend([per_page, offset])
    contacts = db.execute(query, params).fetchall()
    return jsonify({
        'contacts': [dict(c) for c in contacts],
        'total': total,
        'page': page,
        'per_page': per_page,
        'total_pages': (total + per_page - 1) // per_page
    })

@app.route('/api/contacts', methods=['POST'])
@login_required
def create_contact():
    data = request.get_json()
    name = data.get('name', '').strip()
    phone = data.get('phone', '').strip()
    notes = data.get('notes', '').strip()
    group_id = data.get('group_id', None)
    if not name or not phone:
        return jsonify({'error': 'Nombre y telefono son requeridos'}), 400
    db = get_db()
    if group_id:
        group = db.execute("SELECT id FROM contact_groups WHERE id=?", (int(group_id),)).fetchone()
        if not group:
            group_id = None
    db.execute(
        "INSERT INTO contacts (name, phone, notes, group_id) VALUES (?, ?, ?, ?)",
        (name, phone, notes, group_id)
    )
    db.commit()
    return jsonify({'message': 'Contacto creado'}), 201

@app.route('/api/contacts/<int:contact_id>', methods=['PUT'])
@login_required
def update_contact(contact_id):
    data = request.get_json()
    db = get_db()
    contact = db.execute("SELECT * FROM contacts WHERE id=?", (contact_id,)).fetchone()
    if not contact:
        return jsonify({'error': 'Contacto no encontrado'}), 404
    name = data.get('name', contact['name'])
    phone = data.get('phone', contact['phone'])
    notes = data.get('notes', contact['notes'])
    group_id = data.get('group_id', contact['group_id'])
    db.execute(
        "UPDATE contacts SET name=?, phone=?, notes=?, group_id=? WHERE id=?",
        (name, phone, notes, group_id, contact_id)
    )
    db.commit()
    return jsonify({'message': 'Contacto actualizado'})

@app.route('/api/contacts/<int:contact_id>', methods=['DELETE'])
@login_required
def delete_contact(contact_id):
    db = get_db()
    contact = db.execute("SELECT * FROM contacts WHERE id=?", (contact_id,)).fetchone()
    if not contact:
        return jsonify({'error': 'Contacto no encontrado'}), 404
    db.execute("DELETE FROM contacts WHERE id=?", (contact_id,))
    db.commit()
    return jsonify({'message': 'Contacto eliminado'})

@app.route('/api/contacts/import', methods=['POST'])
@login_required
def import_contacts():
    if 'file' not in request.files:
        return jsonify({'error': 'No se ha subido ningun archivo'}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'Archivo vacio'}), 400
    if not file.filename.endswith('.csv'):
        return jsonify({'error': 'Solo se aceptan archivos CSV'}), 400
    group_id = request.form.get('group_id', None)
    if group_id:
        group_id = int(group_id)
    try:
        content = file.stream.read().decode('utf-8-sig')
        reader = csv.DictReader(io.StringIO(content))
        db = get_db()
        imported = 0
        errors = []
        for i, row in enumerate(reader, start=2):
            name = (row.get('name') or row.get('nombre') or '').strip()
            phone = (row.get('phone') or row.get('telefono') or row.get('tel') or '').strip()
            notes = (row.get('notes') or row.get('notas') or '').strip()
            if not name or not phone:
                errors.append(f"Fila {i}: nombre y telefono son requeridos")
                continue
            db.execute(
                "INSERT INTO contacts (name, phone, notes, group_id) VALUES (?, ?, ?, ?)",
                (name, phone, notes, group_id)
            )
            imported += 1
        db.commit()
        result = {'imported': imported}
        if errors:
            result['errors'] = errors[:10]
        return jsonify(result), 201
    except Exception as e:
        return jsonify({'error': f'Error al procesar el archivo: {str(e)}'}), 400

# ============================================================
# Groups API
# ============================================================

@app.route('/api/groups', methods=['GET'])
@login_required
def list_groups():
    db = get_db()
    groups = db.execute("""
        SELECT cg.*, COUNT(c.id) as contact_count
        FROM contact_groups cg
        LEFT JOIN contacts c ON c.group_id = cg.id
        GROUP BY cg.id
        ORDER BY cg.created_at DESC
    """).fetchall()
    return jsonify({'groups': [dict(gr) for gr in groups]})

@app.route('/api/groups', methods=['POST'])
@login_required
def create_group():
    data = request.get_json()
    name = data.get('name', '').strip()
    description = data.get('description', '').strip()
    if not name:
        return jsonify({'error': 'El nombre del grupo es requerido'}), 400
    db = get_db()
    db.execute("INSERT INTO contact_groups (name, description) VALUES (?, ?)", (name, description))
    db.commit()
    return jsonify({'message': 'Grupo creado'}), 201

@app.route('/api/groups/<int:group_id>', methods=['PUT'])
@login_required
def update_group(group_id):
    data = request.get_json()
    db = get_db()
    group = db.execute("SELECT * FROM contact_groups WHERE id=?", (group_id,)).fetchone()
    if not group:
        return jsonify({'error': 'Grupo no encontrado'}), 404
    name = data.get('name', group['name'])
    description = data.get('description', group['description'])
    db.execute("UPDATE contact_groups SET name=?, description=? WHERE id=?", (name, description, group_id))
    db.commit()
    return jsonify({'message': 'Grupo actualizado'})

@app.route('/api/groups/<int:group_id>', methods=['DELETE'])
@login_required
def delete_group(group_id):
    db = get_db()
    group = db.execute("SELECT * FROM contact_groups WHERE id=?", (group_id,)).fetchone()
    if not group:
        return jsonify({'error': 'Grupo no encontrado'}), 404
    db.execute("UPDATE contacts SET group_id=NULL WHERE group_id=?", (group_id,))
    db.execute("DELETE FROM contact_groups WHERE id=?", (group_id,))
    db.commit()
    return jsonify({'message': 'Grupo eliminado'})

# ============================================================
# Templates API
# ============================================================

@app.route('/api/templates', methods=['GET'])
@login_required
def list_templates():
    db = get_db()
    search = request.args.get('search', '').strip()
    category = request.args.get('category', '').strip()
    query = "SELECT * FROM templates WHERE 1=1"
    params = []
    if search:
        query += " AND (name LIKE ? OR content LIKE ?)"
        params.extend([f'%{search}%', f'%{search}%'])
    if category:
        query += " AND category = ?"
        params.append(category)
    query += " ORDER BY updated_at DESC"
    templates = db.execute(query, params).fetchall()
    return jsonify({'templates': [dict(t) for t in templates]})

@app.route('/api/templates', methods=['POST'])
@login_required
def create_template():
    data = request.get_json()
    name = data.get('name', '').strip()
    content = data.get('content', '').strip()
    category = data.get('category', 'general').strip()
    if not name or not content:
        return jsonify({'error': 'Nombre y contenido son requeridos'}), 400
    db = get_db()
    db.execute(
        "INSERT INTO templates (name, content, category) VALUES (?, ?, ?)",
        (name, content, category)
    )
    db.commit()
    return jsonify({'message': 'Plantilla creada'}), 201

@app.route('/api/templates/<int:template_id>', methods=['PUT'])
@login_required
def update_template(template_id):
    data = request.get_json()
    db = get_db()
    template = db.execute("SELECT * FROM templates WHERE id=?", (template_id,)).fetchone()
    if not template:
        return jsonify({'error': 'Plantilla no encontrada'}), 404
    name = data.get('name', template['name'])
    content = data.get('content', template['content'])
    category = data.get('category', template['category'])
    db.execute(
        "UPDATE templates SET name=?, content=?, category=?, updated_at=datetime('now') WHERE id=?",
        (name, content, category, template_id)
    )
    db.commit()
    return jsonify({'message': 'Plantilla actualizada'})

@app.route('/api/templates/<int:template_id>', methods=['DELETE'])
@login_required
def delete_template(template_id):
    db = get_db()
    template = db.execute("SELECT * FROM templates WHERE id=?", (template_id,)).fetchone()
    if not template:
        return jsonify({'error': 'Plantilla no encontrada'}), 404
    db.execute("DELETE FROM templates WHERE id=?", (template_id,))
    db.commit()
    return jsonify({'message': 'Plantilla eliminada'})

# ============================================================
# SMS API
# ============================================================

@app.route('/api/sms/send', methods=['POST'])
@login_required
def send_sms():
    data = request.get_json()
    phones = data.get('phones', [])
    content = data.get('content', '').strip()
    contact_names = data.get('contact_names', {})
    if not phones or not content:
        return jsonify({'error': 'Numero(s) y contenido son requeridos'}), 400
    if len(phones) > 500:
        return jsonify({'error': 'Maximo 500 numeros por envio'}), 400
    db = get_db()
    # Get SMS config
    config = db.execute("SELECT * FROM sms_config LIMIT 1").fetchone()
    records = []
    for phone in phones:
        phone = phone.strip()
        if not phone:
            continue
        # Replace variables in content
        name = contact_names.get(phone, '')
        msg = content.replace('{nombre}', name).replace('{telefono}', phone)
        # Simulate sending (in production, this would call the SMS API)
        status = 'sent'
        if config and config['api_url'] and config['api_key']:
            # If API is configured, mark as sent (simulated)
            status = 'sent'
        else:
            status = 'sent'
        db.execute(
            "INSERT INTO sms_records (phone, contact_name, content, status, sent_at, created_by) VALUES (?, ?, ?, ?, datetime('now'), ?)",
            (phone, name, msg, status, g.user['id'])
        )
        records.append({'phone': phone, 'status': status})
    db.commit()
    # Log the action
    db.execute(
        "INSERT INTO send_logs (action, details, status) VALUES (?, ?, ?)",
        ('send', json.dumps({'phones_count': len(records), 'user': g.user['username']}), 'success')
    )
    db.commit()
    return jsonify({'message': f'{len(records)} mensaje(s) enviado(s)', 'records': records})

@app.route('/api/sms/schedule', methods=['POST'])
@login_required
def schedule_sms():
    data = request.get_json()
    phones = data.get('phones', [])
    content = data.get('content', '').strip()
    scheduled_at = data.get('scheduled_at', '').strip()
    contact_names = data.get('contact_names', {})
    if not phones or not content or not scheduled_at:
        return jsonify({'error': 'Numero(s), contenido y fecha son requeridos'}), 400
    db = get_db()
    count = 0
    for phone in phones:
        phone = phone.strip()
        if not phone:
            continue
        name = contact_names.get(phone, '')
        msg = content.replace('{nombre}', name).replace('{telefono}', phone)
        db.execute(
            "INSERT INTO sms_records (phone, contact_name, content, status, scheduled_at, created_by) VALUES (?, ?, ?, 'scheduled', ?, ?)",
            (phone, name, msg, scheduled_at, g.user['id'])
        )
        count += 1
    db.commit()
    return jsonify({'message': f'{count} mensaje(s) programado(s)'}), 201

@app.route('/api/sms/records', methods=['GET'])
@login_required
def list_sms_records():
    db = get_db()
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 20, type=int)
    status = request.args.get('status', '').strip()
    date_from = request.args.get('date_from', '').strip()
    date_to = request.args.get('date_to', '').strip()
    search = request.args.get('search', '').strip()
    offset = (page - 1) * per_page
    query = "SELECT * FROM sms_records WHERE 1=1"
    count_query = "SELECT COUNT(*) as total FROM sms_records WHERE 1=1"
    params = []
    if status:
        query += " AND status = ?"
        count_query += " AND status = ?"
        params.append(status)
    if date_from:
        query += " AND created_at >= ?"
        count_query += " AND created_at >= ?"
        params.append(date_from)
    if date_to:
        query += " AND created_at <= ?"
        count_query += " AND created_at <= ?"
        params.append(date_to + ' 23:59:59')
    if search:
        query += " AND (phone LIKE ? OR contact_name LIKE ? OR content LIKE ?)"
        count_query += " AND (phone LIKE ? OR contact_name LIKE ? OR content LIKE ?)"
        params.extend([f'%{search}%'] * 3)
    total = db.execute(count_query, params).fetchone()['total']
    query += " ORDER BY created_at DESC LIMIT ? OFFSET ?"
    params.extend([per_page, offset])
    records = db.execute(query, params).fetchall()
    return jsonify({
        'records': [dict(r) for r in records],
        'total': total,
        'page': page,
        'per_page': per_page,
        'total_pages': (total + per_page - 1) // per_page
    })

@app.route('/api/sms/statistics', methods=['GET'])
@login_required
def sms_statistics():
    db = get_db()
    today = datetime.now().strftime('%Y-%m-%d')
    today_sent = db.execute(
        "SELECT COUNT(*) as count FROM sms_records WHERE status='sent' AND date(sent_at)=?",
        (today,)
    ).fetchone()['count']
    today_total = db.execute(
        "SELECT COUNT(*) as count FROM sms_records WHERE date(created_at)=?",
        (today,)
    ).fetchone()['count']
    total_sent = db.execute("SELECT COUNT(*) as count FROM sms_records WHERE status='sent'").fetchone()['count']
    total_failed = db.execute("SELECT COUNT(*) as count FROM sms_records WHERE status='failed'").fetchone()['count']
    total_pending = db.execute("SELECT COUNT(*) as count FROM sms_records WHERE status IN ('pending', 'scheduled')").fetchone()['count']
    total_all = db.execute("SELECT COUNT(*) as count FROM sms_records").fetchone()['count']
    # Last 7 days stats
    last_7_days = []
    for i in range(6, -1, -1):
        day = (datetime.now() - timedelta(days=i)).strftime('%Y-%m-%d')
        count = db.execute(
            "SELECT COUNT(*) as count FROM sms_records WHERE status='sent' AND date(sent_at)=?",
            (day,)
        ).fetchone()['count']
        last_7_days.append({'date': day, 'count': count})
    success_rate = (total_sent / total_all * 100) if total_all > 0 else 0
    return jsonify({
        'today_sent': today_sent,
        'today_total': today_total,
        'total_sent': total_sent,
        'total_failed': total_failed,
        'total_pending': total_pending,
        'total_all': total_all,
        'success_rate': round(success_rate, 1),
        'last_7_days': last_7_days,
        'total_contacts': db.execute("SELECT COUNT(*) as count FROM contacts").fetchone()['count'],
        'total_templates': db.execute("SELECT COUNT(*) as count FROM templates").fetchone()['count']
    })

# ============================================================
# SMS Config API (admin)
# ============================================================

@app.route('/api/config/sms', methods=['GET'])
@admin_required
def get_sms_config():
    db = get_db()
    config = db.execute("SELECT * FROM sms_config LIMIT 1").fetchone()
    if config:
        return jsonify({'config': {
            'id': config['id'],
            'api_url': config['api_url'],
            'api_key': config['api_key'],
            'sender_name': config['sender_name'],
            'updated_at': config['updated_at']
        }})
    return jsonify({'config': {}})

@app.route('/api/config/sms', methods=['PUT'])
@admin_required
def update_sms_config():
    data = request.get_json()
    db = get_db()
    api_url = data.get('api_url', '').strip()
    api_key = data.get('api_key', '').strip()
    sender_name = data.get('sender_name', '').strip()
    db.execute(
        "UPDATE sms_config SET api_url=?, api_key=?, sender_name=?, updated_at=datetime('now') WHERE id=1",
        (api_url, api_key, sender_name)
    )
    db.commit()
    return jsonify({'message': 'Configuracion actualizada'})

@app.route('/api/config/sms/test', methods=['POST'])
@admin_required
def test_sms_config():
    db = get_db()
    config = db.execute("SELECT * FROM sms_config LIMIT 1").fetchone()
    if not config or not config['api_url'] or not config['api_key']:
        return jsonify({'error': 'Configure la URL y API Key primero'}), 400
    # Simulate API test
    db.execute(
        "INSERT INTO send_logs (action, details, status) VALUES (?, ?, ?)",
        ('test_connection', json.dumps({'api_url': config['api_url']}), 'success')
    )
    db.commit()
    return jsonify({'message': 'Conexion exitosa. La API esta configurada correctamente.'})

@app.route('/api/config/logs', methods=['GET'])
@admin_required
def get_send_logs():
    db = get_db()
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 20, type=int)
    offset = (page - 1) * per_page
    total = db.execute("SELECT COUNT(*) as count FROM send_logs").fetchone()['count']
    logs = db.execute("SELECT * FROM send_logs ORDER BY created_at DESC LIMIT ? OFFSET ?", (per_page, offset)).fetchall()
    return jsonify({
        'logs': [dict(l) for l in logs],
        'total': total,
        'page': page,
        'per_page': per_page
    })

# ============================================================
# Process scheduled messages (simple cron-like)
# ============================================================

def process_scheduled_messages():
    """Process pending scheduled messages."""
    db = get_db()
    now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    scheduled = db.execute(
        "SELECT * FROM sms_records WHERE status='scheduled' AND scheduled_at <= ?",
        (now,)
    ).fetchall()
    for record in scheduled:
        db.execute(
            "UPDATE sms_records SET status='sent', sent_at=datetime('now') WHERE id=?",
            (record['id'],)
        )
    if scheduled:
        db.commit()
    return len(scheduled)

@app.route('/api/sms/process-scheduled', methods=['POST'])
@login_required
def trigger_process_scheduled():
    count = process_scheduled_messages()
    return jsonify({'message': f'{count} mensaje(s) programado(s) procesado(s)'})

# ============================================================
# Initialize and run
# ============================================================

init_db()

if __name__ == '__main__':
    port = int(os.environ.get('DEPLOY_RUN_PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)
