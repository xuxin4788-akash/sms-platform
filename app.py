import os
import sqlite3
import hashlib
import secrets
import string
import csv
import io
import json
import time
import requests as http_requests
from datetime import datetime, timedelta
from functools import wraps
from flask import Flask, request, jsonify, render_template, session, g, send_from_directory
from flask_cors import CORS
from flask_compress import Compress
from werkzeug.utils import secure_filename

app = Flask(__name__)
app.secret_key = os.environ.get('FLASK_SECRET_KEY', secrets.token_hex(32))
app.config['DATABASE'] = os.path.join(app.instance_path, 'sms_platform.db')
app.config['DATABASE_URL'] = os.environ.get('DATABASE_URL', '')
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max upload

# Enable Gzip compression
Compress(app)
app.config['COMPRESS_MIMETYPES'] = ['text/html', 'text/css', 'text/xml', 'application/json', 'application/javascript', 'text/javascript']
app.config['COMPRESS_LEVEL'] = 6
app.config['COMPRESS_MIN_SIZE'] = 500

CORS(app, supports_credentials=True)

# Ensure instance folder exists
os.makedirs(app.instance_path, exist_ok=True)

# ============================================================
# Database abstraction (SQLite + PostgreSQL)
# ============================================================

def get_db_type():
    """Return 'postgres' or 'sqlite' based on DATABASE_URL."""
    url = app.config.get('DATABASE_URL', '')
    if url and url.startswith(('postgresql://', 'postgres://')):
        return 'postgres'
    return 'sqlite'

class DBWrapper:
    """Unified database wrapper that works with both SQLite and PostgreSQL."""
    def __init__(self, conn, db_type):
        self.conn = conn
        self.db_type = db_type

    def execute(self, query, params=None):
        if params is None:
            params = ()
        if self.db_type == 'postgres':
            # Convert SQLite placeholders to PostgreSQL
            pg_query = query.replace('?', '%s')
            pg_query = pg_query.replace("datetime('now')", "NOW()")
            # PostgreSQL BOOLEAN columns: SQLite uses 1/0 integers, PG needs TRUE/FALSE
            import re
            pg_query = re.sub(r'\bis_active\s*=\s*1\b', 'is_active = TRUE', pg_query, flags=re.IGNORECASE)
            pg_query = re.sub(r'\bis_active\s*=\s*0\b', 'is_active = FALSE', pg_query, flags=re.IGNORECASE)
            # Convert params: if query touches is_active via placeholder, coerce int to bool
            if isinstance(params, (list, tuple)):
                params = list(params)
                # Detect is_active=? in the ORIGINAL query to map corresponding param
                for m in re.finditer(r'is_active\s*=\s*\?', query, flags=re.IGNORECASE):
                    # The '?' is at m.end()-1. Count '?' before it = zero-based param index.
                    qmark_pos = m.end() - 1
                    p_idx = query[:qmark_pos].count('?')
                    if p_idx < len(params):
                        v = params[p_idx]
                        if isinstance(v, int) and not isinstance(v, bool):
                            params[p_idx] = bool(v)
                params = tuple(params)
            # Always use RealDictCursor so rows behave like sqlite3.Row
            import psycopg2.extras
            cur = self.conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cur.execute(pg_query, params)
            return CursorWrapper(cur, self.db_type)
        else:
            cur = self.conn.execute(query, params)
            return CursorWrapper(cur, self.db_type)

    def executescript(self, script):
        if self.db_type == 'postgres':
            # PostgreSQL doesn't have executescript, execute as single statement
            self.conn.cursor().execute(script)
        else:
            self.conn.executescript(script)

    def commit(self):
        self.conn.commit()

    def close(self):
        self.conn.close()

class CursorWrapper:
    """Unified cursor wrapper that returns dict-like rows for both backends."""
    def __init__(self, cursor, db_type):
        self.cursor = cursor
        self.db_type = db_type

    @property
    def lastrowid(self):
        if self.db_type == 'postgres':
            # RETURNING id was not added; query for the last inserted OID fallback
            try:
                self.cursor.execute("SELECT LASTVAL()")
                row = self.cursor.fetchone()
                return row['lastval'] if isinstance(row, dict) else row[0]
            except Exception:
                return None
        return self.cursor.lastrowid

    def fetchone(self):
        row = self.cursor.fetchone()
        if row is None:
            return None
        # RealDictRow is already dict-like; sqlite3.Row supports both indexing and keys
        return row

    def fetchall(self):
        rows = self.cursor.fetchall()
        return rows

def get_db():
    if 'db' not in g:
        db_type = get_db_type()
        if db_type == 'postgres':
            import psycopg2
            import psycopg2.extras
            conn = psycopg2.connect(app.config['DATABASE_URL'])
            conn.autocommit = False
            g.db = DBWrapper(conn, db_type)
        else:
            conn = sqlite3.connect(app.config['DATABASE'])
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA foreign_keys=ON")
            g.db = DBWrapper(conn, db_type)
    return g.db

@app.teardown_appcontext
def close_db(exception):
    db = g.pop('db', None)
    if db is not None:
        db.close()

def init_db():
    """Initialize database schema. Supports both SQLite and PostgreSQL."""
    db_type = get_db_type()

    if db_type == 'postgres':
        import psycopg2
        conn = psycopg2.connect(app.config['DATABASE_URL'])
        conn.autocommit = True
        cur = conn.cursor()
        # Full schema matching SQLite version
        cur.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(255) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                full_name VARCHAR(255) NOT NULL DEFAULT '',
                role VARCHAR(20) NOT NULL DEFAULT 'team_member',
                team_creator_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                daily_limit INTEGER DEFAULT 0,
                permissions TEXT DEFAULT '',
                created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMP NOT NULL DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS contact_groups (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                description TEXT DEFAULT '',
                created_at TIMESTAMP NOT NULL DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS contacts (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                phone VARCHAR(50) NOT NULL,
                notes TEXT DEFAULT '',
                remark TEXT DEFAULT '',
                group_id INTEGER REFERENCES contact_groups(id) ON DELETE SET NULL,
                created_at TIMESTAMP NOT NULL DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS templates (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                content TEXT NOT NULL,
                category VARCHAR(50) DEFAULT 'general',
                created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMP NOT NULL DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS sms_records (
                id SERIAL PRIMARY KEY,
                phone VARCHAR(50) NOT NULL,
                contact_name VARCHAR(255) DEFAULT '',
                content TEXT NOT NULL,
                status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'sent', 'failed', 'scheduled')),
                msgid VARCHAR(255) DEFAULT '',
                api_code INTEGER DEFAULT 0,
                api_msg TEXT DEFAULT '',
                scheduled_at TIMESTAMP,
                sent_at TIMESTAMP,
                created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
                created_at TIMESTAMP NOT NULL DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS sms_api_configs (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL UNIQUE,
                country VARCHAR(10) NOT NULL DEFAULT '',
                domain VARCHAR(500) DEFAULT '',
                spid VARCHAR(255) DEFAULT '',
                api_pwd VARCHAR(255) DEFAULT '',
                sender_name VARCHAR(255) DEFAULT '',
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMP NOT NULL DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS sms_config (
                id SERIAL PRIMARY KEY,
                domain VARCHAR(500) DEFAULT '',
                spid VARCHAR(255) DEFAULT '',
                api_pwd VARCHAR(255) DEFAULT '',
                sender_name VARCHAR(255) DEFAULT '',
                updated_at TIMESTAMP NOT NULL DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS send_logs (
                id SERIAL PRIMARY KEY,
                action VARCHAR(100) NOT NULL,
                details TEXT DEFAULT '',
                status VARCHAR(20) NOT NULL DEFAULT 'info',
                created_at TIMESTAMP NOT NULL DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS role_permissions (
                role VARCHAR(20) PRIMARY KEY,
                permissions TEXT NOT NULL DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS team_config (
                id SERIAL PRIMARY KEY,
                team_admin_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
                daily_sms_limit INTEGER DEFAULT 100,
                api_config_id INTEGER REFERENCES sms_api_configs(id) ON DELETE SET NULL
            );
        """)

        # Migrations for existing databases - add missing columns
        def pg_column_exists(table, column):
            cur.execute("SELECT 1 FROM information_schema.columns WHERE table_name=%s AND column_name=%s", (table, column))
            return cur.fetchone() is not None

        def pg_table_exists(table):
            cur.execute("SELECT 1 FROM information_schema.tables WHERE table_name=%s", (table,))
            return cur.fetchone() is not None

        # users migrations
        if not pg_column_exists('users', 'team_creator_id'):
            cur.execute("ALTER TABLE users ADD COLUMN team_creator_id INTEGER REFERENCES users(id) ON DELETE SET NULL")
        if not pg_column_exists('users', 'daily_limit'):
            cur.execute("ALTER TABLE users ADD COLUMN daily_limit INTEGER DEFAULT 0")
        if not pg_column_exists('users', 'permissions'):
            cur.execute("ALTER TABLE users ADD COLUMN permissions TEXT DEFAULT ''")
        if not pg_column_exists('users', 'last_login_ip'):
            cur.execute("ALTER TABLE users ADD COLUMN last_login_ip TEXT DEFAULT ''")
        if not pg_column_exists('users', 'last_login_at'):
            cur.execute("ALTER TABLE users ADD COLUMN last_login_at TEXT DEFAULT NULL")
        # Update role check constraint - drop old constraint, add new one
        try:
            cur.execute("ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check")
            cur.execute("ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'team_admin', 'team_member'))")
            cur.execute("UPDATE users SET role='team_member' WHERE role='employee'")
        except Exception:
            pass

        # contacts migrations
        if not pg_column_exists('contacts', 'remark'):
            cur.execute("ALTER TABLE contacts ADD COLUMN remark TEXT DEFAULT ''")

        # sms_records migrations
        if not pg_column_exists('sms_records', 'msgid'):
            cur.execute("ALTER TABLE sms_records ADD COLUMN msgid VARCHAR(255) DEFAULT ''")
        if not pg_column_exists('sms_records', 'api_code'):
            cur.execute("ALTER TABLE sms_records ADD COLUMN api_code INTEGER DEFAULT 0")
        if not pg_column_exists('sms_records', 'api_msg'):
            cur.execute("ALTER TABLE sms_records ADD COLUMN api_msg TEXT DEFAULT ''")

        # Create default admin
        cur.execute("SELECT id FROM users WHERE username='admin'")
        if cur.fetchone() is None:
            pw_hash = hashlib.sha256('admin123'.encode()).hexdigest()
            cur.execute(
                "INSERT INTO users (username, password_hash, full_name, role) VALUES (%s, %s, %s, %s)",
                ('admin', pw_hash, 'Administrador', 'admin')
            )
        # Create default sms_config
        cur.execute("SELECT id FROM sms_config LIMIT 1")
        if cur.fetchone() is None:
            cur.execute("INSERT INTO sms_config (domain, spid, api_pwd, sender_name) VALUES ('', '', '', '')")
        # Create default sms_api_configs
        cur.execute("SELECT id FROM sms_api_configs LIMIT 1")
        if cur.fetchone() is None:
            # Try to migrate from sms_config
            cur.execute("SELECT domain, spid, api_pwd, sender_name FROM sms_config LIMIT 1")
            old = cur.fetchone()
            if old:
                cur.execute("INSERT INTO sms_api_configs (name, country, domain, spid, api_pwd, sender_name) VALUES ('Mexico', 'MX', %s, %s, %s, %s)",
                            (old[0] or '', old[1] or '', old[2] or '', old[3] or ''))
            else:
                cur.execute("INSERT INTO sms_api_configs (name, country, domain, spid, api_pwd, sender_name) VALUES ('Mexico', 'MX', '', '', '', '')")
            cur.execute("INSERT INTO sms_api_configs (name, country, domain, spid, api_pwd, sender_name) VALUES ('Colombia', 'CO', '', '', '', '')")
        # Create default role_permissions
        cur.execute("SELECT role FROM role_permissions LIMIT 1")
        if cur.fetchone() is None:
            cur.execute("INSERT INTO role_permissions (role, permissions) VALUES ('admin', '')")
            cur.execute("INSERT INTO role_permissions (role, permissions) VALUES ('team_admin', '')")
            cur.execute("INSERT INTO role_permissions (role, permissions) VALUES ('team_member', '')")

        cur.close()
        conn.close()
    else:
        # SQLite
        db = sqlite3.connect(app.config['DATABASE'])
        db.executescript('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                full_name TEXT NOT NULL DEFAULT '',
                role TEXT NOT NULL DEFAULT 'team_member' CHECK(role IN ('admin', 'team_admin', 'team_member')),
                team_creator_id INTEGER,
                is_active INTEGER NOT NULL DEFAULT 1,
                daily_limit INTEGER DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (team_creator_id) REFERENCES users(id) ON DELETE SET NULL
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
                remark TEXT DEFAULT '',
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
                msgid TEXT DEFAULT '',
                api_code INTEGER DEFAULT 0,
                api_msg TEXT DEFAULT '',
                scheduled_at TEXT,
                sent_at TEXT,
                created_by INTEGER,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS sms_api_configs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                country TEXT NOT NULL DEFAULT '',
                domain TEXT DEFAULT '',
                spid TEXT DEFAULT '',
                api_pwd TEXT DEFAULT '',
                sender_name TEXT DEFAULT '',
                is_active INTEGER DEFAULT 1,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS send_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                action TEXT NOT NULL,
                details TEXT DEFAULT '',
                status TEXT NOT NULL DEFAULT 'info',
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS role_permissions (
                role TEXT PRIMARY KEY,
                permissions TEXT NOT NULL DEFAULT ''
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
        # Create default sms_api_configs if not exists
        cursor = db.execute("SELECT id FROM sms_api_configs LIMIT 1")
        if cursor.fetchone() is None:
            db.execute("INSERT INTO sms_api_configs (name, country, domain, spid, api_pwd, sender_name) VALUES ('Mexico', 'MX', '', '', '', '')")
            db.execute("INSERT INTO sms_api_configs (name, country, domain, spid, api_pwd, sender_name) VALUES ('Colombia', 'CO', '', '', '', '')")
        # Create default role_permissions
        cursor = db.execute("SELECT role FROM role_permissions LIMIT 1")
        if cursor.fetchone() is None:
            db.execute("INSERT INTO role_permissions (role, permissions) VALUES ('admin', '')")
            db.execute("INSERT INTO role_permissions (role, permissions) VALUES ('team_admin', '')")
            db.execute("INSERT INTO role_permissions (role, permissions) VALUES ('team_member', '')")
            db.commit()
        # Migration: add new columns if they don't exist
        try:
            db.execute("ALTER TABLE sms_config ADD COLUMN domain TEXT DEFAULT ''")
        except Exception:
            pass
        try:
            db.execute("ALTER TABLE sms_config ADD COLUMN spid TEXT DEFAULT ''")
        except Exception:
            pass
        try:
            db.execute("ALTER TABLE sms_config ADD COLUMN api_pwd TEXT DEFAULT ''")
        except Exception:
            pass
        try:
            db.execute("ALTER TABLE sms_records ADD COLUMN msgid TEXT DEFAULT ''")
        except Exception:
            pass
        try:
            db.execute("ALTER TABLE sms_records ADD COLUMN api_code INTEGER DEFAULT 0")
        except Exception:
            pass
        try:
            db.execute("ALTER TABLE sms_records ADD COLUMN api_msg TEXT DEFAULT ''")
        except Exception:
            pass
        db.commit()
        # Migration: add remark column to contacts if not exists
        try:
            db.execute("ALTER TABLE contacts ADD COLUMN remark TEXT DEFAULT ''")
            db.commit()
        except Exception:
            pass
        # Migration: add team_creator_id to users if not exists
        try:
            db.execute("ALTER TABLE users ADD COLUMN team_creator_id INTEGER")
            db.commit()
        except Exception:
            pass
        # Migration: update old 'employee' role to 'team_member'
        try:
            db.execute("UPDATE users SET role='team_member' WHERE role='employee'")
            db.commit()
        except Exception:
            pass
        # Migration: add daily_limit to users if not exists
        try:
            db.execute("ALTER TABLE users ADD COLUMN daily_limit INTEGER DEFAULT 0")
            db.commit()
        except Exception:
            pass
        # Migration: add permissions column to users if not exists
        try:
            db.execute("ALTER TABLE users ADD COLUMN permissions TEXT DEFAULT ''")
            db.commit()
        except Exception:
            pass
        # Migration: recreate users table with new role CHECK constraint
        try:
            cursor = db.execute("SELECT sql FROM sqlite_master WHERE name='users'")
            schema_sql = cursor.fetchone()[0]
            if "'admin', 'employee'" in schema_sql:
                db.execute("PRAGMA foreign_keys=OFF")
                db.execute("DROP TABLE IF EXISTS users_old")
                db.execute("ALTER TABLE users RENAME TO users_old")
                db.execute("""CREATE TABLE users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT UNIQUE NOT NULL,
                    password_hash TEXT NOT NULL,
                    full_name TEXT NOT NULL DEFAULT '',
                    role TEXT NOT NULL DEFAULT 'team_member' CHECK(role IN ('admin', 'team_admin', 'team_member')),
                    is_active INTEGER NOT NULL DEFAULT 1,
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                    team_creator_id INTEGER,
                    permissions TEXT DEFAULT ''
                )""")
                db.execute("INSERT INTO users (id, username, password_hash, full_name, role, is_active, created_at, updated_at, team_creator_id) SELECT id, username, password_hash, full_name, CASE WHEN role='employee' THEN 'team_member' ELSE role END, is_active, created_at, updated_at, team_creator_id FROM users_old")
                db.execute("DROP TABLE users_old")
                db.execute("PRAGMA foreign_keys=ON")
                db.commit()
        except Exception as e:
            print(f"Migration users table error: {e}")
            db.execute("PRAGMA foreign_keys=ON")
        except Exception:
            pass
        # Migration: create team_config table
        try:
            db.execute("""
                CREATE TABLE IF NOT EXISTS team_config (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    team_admin_id INTEGER NOT NULL UNIQUE,
                    daily_sms_limit INTEGER DEFAULT 100,
                    api_config_id INTEGER DEFAULT NULL,
                    FOREIGN KEY (team_admin_id) REFERENCES users(id),
                    FOREIGN KEY (api_config_id) REFERENCES sms_api_configs(id) ON DELETE SET NULL
                )
            """)
            db.commit()
        except Exception:
            pass

        # Migration: create sms_api_configs table and migrate from sms_config
        try:
            cursor = db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='sms_api_configs'")
            if cursor.fetchone() is None:
                db.execute('''CREATE TABLE sms_api_configs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL UNIQUE,
                    country TEXT NOT NULL DEFAULT '',
                    domain TEXT DEFAULT '',
                    spid TEXT DEFAULT '',
                    api_pwd TEXT DEFAULT '',
                    sender_name TEXT DEFAULT '',
                    is_active INTEGER DEFAULT 1,
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
                )''')
                # Migrate existing sms_config data
                old_cursor = db.execute("SELECT * FROM sms_config LIMIT 1")
                old_config = old_cursor.fetchone()
                if old_config:
                    db.execute("INSERT INTO sms_api_configs (name, country, domain, spid, api_pwd, sender_name) VALUES ('Mexico', 'MX', ?, ?, ?, ?)",
                        (old_config['domain'] or '', old_config['spid'] or '', old_config['api_pwd'] or '', old_config['sender_name'] or ''))
                    db.execute("INSERT INTO sms_api_configs (name, country, domain, spid, api_pwd, sender_name) VALUES ('Colombia', 'CO', '', '', '', '')")
                else:
                    db.execute("INSERT INTO sms_api_configs (name, country, domain, spid, api_pwd, sender_name) VALUES ('Mexico', 'MX', '', '', '', '')")
                    db.execute("INSERT INTO sms_api_configs (name, country, domain, spid, api_pwd, sender_name) VALUES ('Colombia', 'CO', '', '', '', '')")
                db.commit()
        except Exception:
            pass

        # Migration: add api_config_id to team_config
        try:
            cursor = db.execute("PRAGMA table_info(team_config)")
            cols = [row[1] for row in cursor.fetchall()]
            if 'api_config_id' not in cols:
                db.execute("ALTER TABLE team_config ADD COLUMN api_config_id INTEGER DEFAULT NULL REFERENCES sms_api_configs(id) ON DELETE SET NULL")
                db.commit()
        except Exception:
            pass

        # Migration: add last_login_ip and last_login_at to users
        try:
            if db_type == 'postgresql':
                cursor = db.execute("SELECT column_name FROM information_schema.columns WHERE table_name = 'users'")
                cols = [row[0] for row in cursor.fetchall()]
                if 'last_login_ip' not in cols:
                    db.execute("ALTER TABLE users ADD COLUMN last_login_ip TEXT DEFAULT ''")
                if 'last_login_at' not in cols:
                    db.execute("ALTER TABLE users ADD COLUMN last_login_at TEXT DEFAULT NULL")
            else:
                cursor = db.execute("PRAGMA table_info(users)")
                cols = [row[1] for row in cursor.fetchall()]
                if 'last_login_ip' not in cols:
                    db.execute("ALTER TABLE users ADD COLUMN last_login_ip TEXT DEFAULT ''")
                if 'last_login_at' not in cols:
                    db.execute("ALTER TABLE users ADD COLUMN last_login_at TEXT DEFAULT NULL")
            db.commit()
        except Exception as e:
            print(f"Migration error: {e}")

        db.close()

# ============================================================
# Auth helpers
# ============================================================

def hash_password(password):
    return hashlib.sha256(password.encode()).hexdigest()

def generate_password(length=10):
    alphabet = string.ascii_letters + string.digits
    while True:
        pwd = ''.join(secrets.choice(alphabet) for _ in range(length))
        # Asegurar que contenga al menos una mayuscula, una minuscula y un digito
        if (any(c.islower() for c in pwd) and any(c.isupper() for c in pwd)
                and any(c.isdigit() for c in pwd)):
            return pwd

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

def manager_required(f):
    """Require admin or team_admin role."""
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'user_id' not in session:
            return jsonify({'error': 'No autorizado'}), 401
        user = get_db().execute("SELECT * FROM users WHERE id=? AND is_active=1", (session['user_id'],)).fetchone()
        if not user:
            session.clear()
            return jsonify({'error': 'Sesion expirada'}), 401
        if user['role'] not in ('admin', 'team_admin'):
            return jsonify({'error': 'Permisos insuficientes'}), 403
        g.user = dict(user)
        return f(*args, **kwargs)
    return decorated

# ============================================================
# SMS API Integration (infin8linx)
# ============================================================

# Status code mapping from API docs
SMS_STATUS_CODES = {
    0: 'Exito',
    10: 'Parametros requeridos faltantes',
    11: 'Parametros invalidos',
    12: 'Cuenta/contrasena incorrectos',
    13: 'Saldo insuficiente',
    14: 'IP no en lista blanca',
    15: 'Limite de frecuencia excedido',
    16: 'Problema con el contenido',
    17: 'Error de codificacion',
    18: 'Problema con la firma',
    19: 'Error de plantilla',
    20: 'SMS no encontrado',
    21: 'Error del sistema',
    22: 'Numero invalido',
    23: 'Contenido sensible',
    24: 'Numero en lista negra',
}

def str_to_hex(s):
    """Convert a string to hex encoding (UTF-8)."""
    return s.encode('utf-8').hex()

def generate_api_pwd(spid, api_pwd, timestamp):
    """Generate encrypted password: MD5(spid + '00000000' + pwd + timestamp), lowercase."""
    raw = f"{spid}00000000{api_pwd}{timestamp}"
    return hashlib.md5(raw.encode('utf-8')).hexdigest()

def get_sms_api_config(config_id=None):
    """Get SMS API configuration from database. If config_id given, get that config; otherwise get first active config."""
    db = get_db()
    if config_id:
        config = db.execute("SELECT * FROM sms_api_configs WHERE id = ?", (config_id,)).fetchone()
    else:
        # Prefer a fully-configured active record (domain/spid/api_pwd all present)
        config = db.execute(
            "SELECT * FROM sms_api_configs WHERE is_active = 1 "
            "AND domain IS NOT NULL AND domain != '' "
            "AND spid IS NOT NULL AND spid != '' "
            "AND api_pwd IS NOT NULL AND api_pwd != '' "
            "ORDER BY id LIMIT 1"
        ).fetchone()
        # Fallback: if no fully-configured record, return the first active one
        if not config:
            config = db.execute(
                "SELECT * FROM sms_api_configs WHERE is_active = 1 ORDER BY id LIMIT 1"
            ).fetchone()
    if not config:
        return None
    return {
        'id': config['id'],
        'name': config['name'] or '',
        'country': config['country'] or '',
        'domain': config['domain'] or '',
        'spid': config['spid'] or '',
        'api_pwd': config['api_pwd'] or '',
        'sender_name': config['sender_name'] or '',
    }

def get_team_sms_config(user_id):
    """Get SMS API config for a user based on their team."""
    db = get_db()
    # Find user's team admin
    user = db.execute("SELECT id, role, team_creator_id FROM users WHERE id = ?", (user_id,)).fetchone()
    if not user:
        return get_sms_api_config()
    if user['role'] == 'admin':
        return get_sms_api_config()
    # Find team admin's config
    team_admin_id = user['team_creator_id']
    if not team_admin_id:
        return get_sms_api_config()
    tc = db.execute("SELECT api_config_id FROM team_config WHERE team_admin_id = ?", (team_admin_id,)).fetchone()
    if tc and tc['api_config_id']:
        return get_sms_api_config(tc['api_config_id'])
    return get_sms_api_config()

def is_sms_api_configured(user_id=None):
    """Check if SMS API is properly configured."""
    if user_id:
        config = get_team_sms_config(user_id)
    else:
        config = get_sms_api_config()
    if not config:
        return False
    return bool(config['domain'] and config['spid'] and config['api_pwd'])

def sms_api_send_single(phone, content, config=None):
    """Send a single SMS via the API.
    GET /sms/send?spid=xx&pwd=xx&das=xx&timestamp=xx&sm=xx
    Returns: dict with code, msg, data (msgid, parts, state)
    """
    if config is None:
        config = get_sms_api_config()
    if not config or not (config.get('domain') and config.get('spid') and config.get('api_pwd')):
        return {'code': -1, 'msg': 'API SMS no configurada', 'data': None}

    timestamp = str(int(time.time()))
    pwd = generate_api_pwd(config['spid'], config['api_pwd'], timestamp)
    sm_hex = str_to_hex(content)

    # Convert phone format: +52... -> 0052...
    das = phone.replace('+', '00') if phone.startswith('+') else phone

    params = {
        'spid': config['spid'],
        'pwd': pwd,
        'timestamp': timestamp,
        'das': das,
        'sm': sm_hex,
    }
    if config['sender_name']:
        params['senderid'] = config['sender_name']

    # Build full URL with query string
    from urllib.parse import urlencode
    url = f"https://{config['domain']}/sms/send?{urlencode(params)}"

    try:
        resp = http_requests.get(url, timeout=15)
        result = resp.json()
        return result
    except http_requests.exceptions.Timeout:
        return {'code': -2, 'msg': 'Tiempo de espera agotado', 'data': None}
    except http_requests.exceptions.ConnectionError:
        return {'code': -3, 'msg': 'Error de conexion con el proveedor', 'data': None}
    except Exception as e:
        return {'code': -4, 'msg': f'Error: {str(e)}', 'data': None}

def sms_api_send_batch(phone_content_pairs, config=None):
    """Send multiple SMS via the API (max 200 per request).
    POST /sms/rsend Content-Type: application/x-www-form-urlencoded
    phone_content_pairs: list of (phone, content) tuples
    Returns: dict with code, msg, data (list of {das, msgid, parts, state})
    """
    if config is None:
        config = get_sms_api_config()
    if not config or not (config.get('domain') and config.get('spid') and config.get('api_pwd')):
        return {'code': -1, 'msg': 'API SMS no configurada', 'data': None}

    timestamp = str(int(time.time()))
    pwd = generate_api_pwd(config['spid'], config['api_pwd'], timestamp)

    # Build dasm: phone,hex_content/phone,hex_content...
    parts = []
    for phone, content in phone_content_pairs:
        hex_content = str_to_hex(content)
        # Convert phone format: +52... -> 0052...
        das = phone.replace('+', '00') if phone.startswith('+') else phone
        parts.append(f"{das},{hex_content}")
    dasm = '/'.join(parts)

    payload = {
        'spid': config['spid'],
        'pwd': pwd,
        'timestamp': timestamp,
        'dasm': dasm,
    }
    if config['sender_name']:
        payload['senderid'] = config['sender_name']

    url = f"https://{config['domain']}/sms/rsend"

    try:
        resp = http_requests.post(url, data=payload, timeout=30)
        result = resp.json()
        return result
    except http_requests.exceptions.Timeout:
        return {'code': -2, 'msg': 'Tiempo de espera agotado', 'data': None}
    except http_requests.exceptions.ConnectionError:
        return {'code': -3, 'msg': 'Error de conexion con el proveedor', 'data': None}
    except Exception as e:
        return {'code': -4, 'msg': f'Error: {str(e)}', 'data': None}

def sms_api_query_status(msgids, config=None):
    """Query SMS delivery status.
    GET /sms/state?spid=xx&pwd=xx&timestamp=xx&msgid=xx
    msgids: list of msgid strings (max 100)
    Returns: dict with code, msg, data (list of {msgid, state})
    state: 0=no receipt, 1=success, 2=failed
    """
    if config is None:
        config = get_sms_api_config()
    if not config or not (config.get('domain') and config.get('spid') and config.get('api_pwd')):
        return {'code': -1, 'msg': 'API SMS no configurada', 'data': None}

    timestamp = str(int(time.time()))
    pwd = generate_api_pwd(config['spid'], config['api_pwd'], timestamp)
    msgid_str = ','.join(msgids[:100])

    url = f"https://{config['domain']}/sms/state"
    params = {
        'spid': config['spid'],
        'pwd': pwd,
        'timestamp': timestamp,
        'msgid': msgid_str,
    }

    try:
        resp = http_requests.get(url, params=params, timeout=15)
        result = resp.json()
        return result
    except http_requests.exceptions.Timeout:
        return {'code': -2, 'msg': 'Tiempo de espera agotado', 'data': None}
    except http_requests.exceptions.ConnectionError:
        return {'code': -3, 'msg': 'Error de conexion con el proveedor', 'data': None}
    except Exception as e:
        return {'code': -4, 'msg': f'Error: {str(e)}', 'data': None}

def sms_api_check_charset(content, config=None):
    """Check SMS content charset and billing parts.
    GET /sms/charset?spid=xx&pwd=xx&sm=xx&timestamp=xx
    Returns: dict with code, msg, data (charset, parts, single, detail)
    """
    if config is None:
        config = get_sms_api_config()
    if not config or not (config.get('domain') and config.get('spid') and config.get('api_pwd')):
        return {'code': -1, 'msg': 'API SMS no configurada', 'data': None}

    timestamp = str(int(time.time()))
    pwd = generate_api_pwd(config['spid'], config['api_pwd'], timestamp)
    sm_hex = str_to_hex(content)

    url = f"https://{config['domain']}/sms/charset"
    params = {
        'spid': config['spid'],
        'pwd': pwd,
        'timestamp': timestamp,
        'sm': sm_hex,
    }

    try:
        resp = http_requests.get(url, params=params, timeout=15)
        result = resp.json()
        return result
    except http_requests.exceptions.Timeout:
        return {'code': -2, 'msg': 'Tiempo de espera agotado', 'data': None}
    except http_requests.exceptions.ConnectionError:
        return {'code': -3, 'msg': 'Error de conexion con el proveedor', 'data': None}
    except Exception as e:
        return {'code': -4, 'msg': f'Error: {str(e)}', 'data': None}

# ============================================================
# Frontend route
# ============================================================

@app.after_request
def add_cache_headers(response):
    """Add cache headers for static files"""
    if request.path.startswith('/static/'):
        response.headers['Cache-Control'] = 'public, max-age=86400'  # 1 day
    return response

@app.route('/')
def index():
    return render_template('index.html')

# ============================================================
# Auth API
# ============================================================

ROLE_LABELS = {
    'admin': 'Administrador del Sistema',
    'team_admin': 'Administrador de Equipo',
    'team_member': 'Miembro de Equipo'
}

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
    # Record login IP
    login_ip = request.headers.get('X-Forwarded-For', request.remote_addr or '').split(',')[0].strip()
    db.execute(
        "UPDATE users SET last_login_ip=?, last_login_at=datetime('now') WHERE id=?",
        (login_ip, user['id'])
    )
    db.commit()
    return jsonify({
        'user': {
            'id': user['id'],
            'username': user['username'],
            'full_name': user['full_name'],
            'role': user['role'],
            'role_label': ROLE_LABELS.get(user['role'], user['role'])
        }
    })

@app.route('/api/auth/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({'message': 'Sesion cerrada'})

@app.route('/api/auth/me', methods=['GET'])
@login_required
def get_me():
    db = get_db()
    # Get permissions from role_permissions table
    permissions = []
    try:
        role = g.user['role']
        if role == 'admin':
            # Admin always has all permissions
            permissions = ['dashboard', 'contacts', 'groups', 'templates', 'send', 'records', 'content-search', 'users', 'my-account', 'my-team', 'all-teams', 'config', 'role-permissions']
        else:
            # Get permissions from role_permissions table
            row = db.execute("SELECT permissions FROM role_permissions WHERE role = %s" if db.db_type == 'postgresql' else "SELECT permissions FROM role_permissions WHERE role = ?", (role,)).fetchone()
            if row:
                perms_raw = row['permissions']
                if isinstance(perms_raw, (list, dict)):
                    # PostgreSQL JSON/JSONB column already parsed by psycopg2
                    permissions = perms_raw if isinstance(perms_raw, list) else []
                else:
                    perms_raw = perms_raw or ''
                    import json as _json
                    permissions = _json.loads(perms_raw) if perms_raw else []
    except Exception as e:
        import traceback
        app.logger.error(f"Error loading permissions for role {g.user.get('role')}: {e}\n{traceback.format_exc()}")
        permissions = []

    # Get team country code
    team_country = ''
    try:
        if g.user['role'] == 'admin':
            # Admin: get first active config country
            cfg = db.execute("SELECT country FROM sms_api_configs WHERE is_active = 1 LIMIT 1").fetchone()
            if cfg:
                team_country = cfg['country'] or ''
        else:
            team_admin_id = g.user.get('team_creator_id')
            if team_admin_id:
                tc = db.execute("SELECT api_config_id FROM team_config WHERE team_admin_id = ?", (team_admin_id,)).fetchone()
                if tc and tc['api_config_id']:
                    cfg = db.execute("SELECT country FROM sms_api_configs WHERE id = ?", (tc['api_config_id'],)).fetchone()
                    if cfg:
                        team_country = cfg['country'] or ''
    except Exception as e:
        app.logger.error(f"Error loading team country: {e}")

    country_codes = {'MX': '+52', 'CO': '+57', 'US': '+1', 'BR': '+55'}
    team_country_code = country_codes.get(team_country, '+52')

    return jsonify({
        'user': {
            'id': g.user['id'],
            'username': g.user['username'],
            'full_name': g.user['full_name'],
            'role': g.user['role'],
            'role_label': ROLE_LABELS.get(g.user['role'], g.user['role']),
            'permissions': permissions,
            'team_country_code': team_country_code
        }
    })

# ============================================================
# Users API (role-based access control)
# ============================================================

@app.route('/api/users', methods=['GET'])
@manager_required
def list_users():
    db = get_db()
    current = g.user
    role_filter = request.args.get('role', '').strip()
    search = request.args.get('search', '').strip()

    # Base query with team creator name
    base_select = """
        SELECT u.id, u.username, u.full_name, u.role, u.team_creator_id,
               u.is_active, u.created_at, u.updated_at,
               u.last_login_ip, u.last_login_at,
               tc.username AS team_creator_name, tc.full_name AS team_creator_fullname
        FROM users u
        LEFT JOIN users tc ON u.team_creator_id = tc.id
    """

    if current['role'] == 'admin':
        where_clauses = ["u.id != ?"]
        params = [current['id']]
        if role_filter:
            where_clauses.append("u.role = ?")
            params.append(role_filter)
        if search:
            where_clauses.append("(u.username LIKE ? OR u.full_name LIKE ?)")
            params.extend([f'%{search}%', f'%{search}%'])
        where_sql = " WHERE " + " AND ".join(where_clauses) if where_clauses else ""
        users = db.execute(base_select + where_sql + " ORDER BY u.created_at DESC", params).fetchall()
    else:
        # Team admin sees all team members (team_creator_id = current['id'] OR same team)
        where_clauses = ["(u.team_creator_id = ? OR (u.team_creator_id IN (SELECT team_creator_id FROM users WHERE id = ?) AND u.team_creator_id IS NOT NULL))"]
        params = [current['id'], current['id']]
        if role_filter:
            where_clauses.append("u.role = ?")
            params.append(role_filter)
        if search:
            where_clauses.append("(u.username LIKE ? OR u.full_name LIKE ?)")
            params.extend([f'%{search}%', f'%{search}%'])
        where_sql = " AND ".join(where_clauses)
        users = db.execute(base_select + " WHERE " + where_sql + " ORDER BY u.created_at DESC", params).fetchall()

    result = []
    for u in users:
        ud = dict(u)
        ud['role_label'] = ROLE_LABELS.get(ud['role'], ud['role'])
        # Parse permissions
        import json as _json
        perms_raw = ud.get('permissions', '') or ''
        try:
            ud['permissions'] = _json.loads(perms_raw) if perms_raw else []
        except Exception:
            ud['permissions'] = []
        # Admin always has all permissions
        if ud['role'] == 'admin':
            ud['permissions'] = ['dashboard', 'contacts', 'groups', 'templates', 'send', 'records', 'content-search', 'users', 'my-account', 'my-team', 'all-teams', 'config']
        # Team affiliation: show team creator name for team members
        if ud['team_creator_name']:
            ud['team_affiliation'] = ud['team_creator_fullname'] or ud['team_creator_name']
        else:
            ud['team_affiliation'] = None
        result.append(ud)
    return jsonify({'users': result})

@app.route('/api/users', methods=['POST'])
@manager_required
def create_user():
    data = request.get_json()
    current = g.user
    username = data.get('username', '').strip()
    password = (data.get('password') or '').strip()
    full_name = (data.get('full_name') or '').strip()
    role = data.get('role', 'team_member')
    if not username:
        return jsonify({'error': 'El usuario es requerido'}), 400
    generated_password = None
    if not password:
        # Auto-generate a 10-character alphanumeric password if not provided
        password = generate_password(10)
        generated_password = password
    if len(password) < 6:
        return jsonify({'error': 'La contrasena debe tener minimo 6 caracteres'}), 400
    # Role assignment rules
    if current['role'] == 'admin':
        # System admin can only create team_admin
        if role != 'team_admin':
            return jsonify({'error': 'El Administrador del Sistema solo puede crear Administradores de Equipo'}), 400
        team_creator_id = None
    elif current['role'] == 'team_admin':
        # Team admin can only create team_member
        if role != 'team_member':
            return jsonify({'error': 'Solo puede crear Miembros de Equipo'}), 400
        team_creator_id = current['id']
    else:
        return jsonify({'error': 'Permisos insuficientes'}), 403
    db = get_db()
    existing = db.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
    if existing:
        return jsonify({'error': 'El nombre de usuario ya existe'}), 409
    api_config_id = data.get('api_config_id')
    db.execute(
        "INSERT INTO users (username, password_hash, full_name, role, team_creator_id) VALUES (?, ?, ?, ?, ?)",
        (username, hash_password(password), full_name, role, team_creator_id)
    )
    # If creating a team_admin, create team_config with api_config_id
    if role == 'team_admin':
        new_user_row = db.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
        new_user_id = new_user_row['id']
        db.execute(
            "INSERT INTO team_config (team_admin_id, api_config_id, daily_sms_limit) VALUES (?, ?, 100)",
            (new_user_id, api_config_id if api_config_id else None)
        )
    db.commit()
    response = {'message': 'Usuario creado exitosamente'}
    if generated_password:
        response['generated_password'] = generated_password
    return jsonify(response), 201

@app.route('/api/users/<int:user_id>', methods=['PUT'])
@manager_required
def update_user(user_id):
    data = request.get_json()
    current = g.user
    db = get_db()
    user = db.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
    if not user:
        return jsonify({'error': 'Usuario no encontrado'}), 404
    # Permission checks
    if current['role'] == 'admin':
        # System admin can edit anyone except changing their own role
        pass
    elif current['role'] == 'team_admin':
        # Team admin can only edit their own team members
        if user['team_creator_id'] != current['id']:
            return jsonify({'error': 'Solo puede editar miembros de su propio equipo'}), 403
        # Cannot change role
        if 'role' in data and data['role'] != user['role']:
            return jsonify({'error': 'No puede cambiar el rol de un usuario'}), 403
    else:
        return jsonify({'error': 'Permisos insuficientes'}), 403
    full_name = data.get('full_name', user['full_name'])
    is_active = data.get('is_active', user['is_active'])
    password = data.get('password', None)
    updates = ["updated_at=datetime('now')"]
    params = []
    if full_name is not None:
        updates.append("full_name=?")
        params.append(full_name)
    # Only system admin can change roles
    if current['role'] == 'admin' and 'role' in data:
        new_role = data['role']
        if new_role in ('admin', 'team_admin', 'team_member'):
            updates.append("role=?")
            params.append(new_role)
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
@manager_required
def delete_user(user_id):
    current = g.user
    db = get_db()
    if user_id == current['id']:
        return jsonify({'error': 'No puede eliminar su propia cuenta'}), 400
    user = db.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
    if not user:
        return jsonify({'error': 'Usuario no encontrado'}), 404
    # Permission checks
    if current['role'] == 'admin':
        # System admin can delete team_admins (but not other system admins)
        if user['role'] == 'admin':
            return jsonify({'error': 'No puede eliminar a otro Administrador del Sistema'}), 403
    elif current['role'] == 'team_admin':
        # Team admin can only delete their own team members
        if user['team_creator_id'] != current['id']:
            return jsonify({'error': 'Solo puede eliminar miembros de su propio equipo'}), 403
        if user['role'] != 'team_member':
            return jsonify({'error': 'Solo puede eliminar Miembros de Equipo'}), 403
    else:
        return jsonify({'error': 'Permisos insuficientes'}), 403
    # Protection: cannot delete a team_admin who still has members under them
    if user['role'] == 'team_admin':
        member_count = db.execute(
            "SELECT COUNT(*) as cnt FROM users WHERE team_creator_id=?",
            (user_id,)
        ).fetchone()
        if member_count and member_count['cnt'] > 0:
            return jsonify({
                'error': f"Este Administrador de Equipo tiene {member_count['cnt']} miembro(s) a cargo. Elimine o reasigne los miembros primero."
            }), 400
    db.execute("DELETE FROM users WHERE id=?", (user_id,))
    db.commit()
    return jsonify({'message': 'Usuario eliminado'})

def _bulk_create_users_core(current_user, users, default_api_config_id, default_password=None):
    """Core bulk-creation logic shared by JSON and Excel upload.

    Returns (created, errors). Each created item includes the plain-text
    password used (for the password-list export); existing/hashed passwords
    are never returned elsewhere.
    """
    db = get_db()

    if current_user['role'] == 'admin':
        role = 'team_admin'
        team_creator_id = None
    elif current_user['role'] == 'team_admin':
        role = 'team_member'
        team_creator_id = current_user['id']
    else:
        return None, None

    created = []
    errors = []
    existing_rows = db.execute("SELECT username FROM users").fetchall()
    existing_users = set(r['username'].lower() for r in existing_rows)
    seen_usernames = set()

    for idx, u in enumerate(users):
        if not isinstance(u, dict):
            errors.append({'index': idx, 'username': '', 'error': 'Formato invalido'})
            continue
        username = (u.get('username') or '').strip()
        full_name = (u.get('full_name') or '').strip()
        api_config_id = u.get('api_config_id') or default_api_config_id

        if not username:
            errors.append({'index': idx, 'username': username, 'error': 'Usuario requerido'})
            continue

        # Solo el usuario es obligatorio. Si no hay contrasena (ni por fila ni por defecto),
        # se genera una combinacion irregular de 10 caracteres alfanumericos.
        password = (u.get('password') or '').strip() or (default_password or '').strip()
        generated_password = False
        if not password:
            password = generate_password(10)
            generated_password = True
        elif len(password) < 6:
            errors.append({'index': idx, 'username': username, 'error': 'Contrasena minimo 6 caracteres'})
            continue

        uname_lower = username.lower()
        if uname_lower in existing_users or uname_lower in seen_usernames:
            errors.append({'index': idx, 'username': username, 'error': 'El nombre de usuario ya existe'})
            continue

        try:
            db.execute(
                "INSERT INTO users (username, password_hash, full_name, role, team_creator_id) VALUES (?, ?, ?, ?, ?)",
                (username, hash_password(password), full_name, role, team_creator_id)
            )
            new_user_row = db.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
            new_user_id = new_user_row['id']
            if role == 'team_admin':
                if not api_config_id:
                    errors.append({'index': idx, 'username': username, 'error': 'Configuracion API (pais) requerida'})
                    db.execute("DELETE FROM users WHERE id=?", (new_user_id,))
                    continue
                db.execute(
                    "INSERT INTO team_config (team_admin_id, api_config_id, daily_sms_limit) VALUES (?, ?, 100)",
                    (new_user_id, api_config_id)
                )
            created.append({
                'id': new_user_id,
                'username': username,
                'full_name': full_name,
                'role': role,
                'password': password,
                'generated': generated_password
            })
            seen_usernames.add(uname_lower)
        except Exception as e:
            errors.append({'index': idx, 'username': username, 'error': 'Error al crear: ' + str(e)})

    db.commit()
    return created, errors, role


@app.route('/api/users/bulk', methods=['POST'])
@manager_required
def bulk_create_users():
    """Bulk create users.
    Admin -> creates team_admins (each needs api_config_id).
    Team_admin -> creates team_members under their management.
    Payload: { "users": [ {"username":..,"password":..,"full_name":..,"api_config_id":..}, ... ], "api_config_id": <optional default>, "default_password": <optional> }
    """
    data = request.get_json() or {}
    users = data.get('users', [])
    if not isinstance(users, list) or not users:
        return jsonify({'error': 'Debe proporcionar una lista de usuarios'}), 400
    if len(users) > 500:
        return jsonify({'error': 'No se pueden crear mas de 500 usuarios a la vez'}), 400

    default_api_config_id = data.get('api_config_id')
    default_password = data.get('default_password')
    result = _bulk_create_users_core(g.user, users, default_api_config_id, default_password)
    if result[0] is None:
        return jsonify({'error': 'Permisos insuficientes'}), 403
    created, errors, role = result
    return jsonify({
        'message': 'Creacion masiva completada',
        'created_count': len(created),
        'error_count': len(errors),
        'created': created,
        'errors': errors
    }), 200


def _parse_excel_users(file_storage):
    """Parse an uploaded Excel file into a list of user dicts.

    Accepts columns (case/space/accent insensitive, first row as header):
    usuario/username, contrasena/password, nombre/full_name/nombre completo.
    Also accepts a 3-column sheet without header (username, password, full_name).
    """
    from openpyxl import load_workbook
    wb = load_workbook(filename=file_storage.stream, read_only=True, data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        return []

    def normalize(s):
        if s is None:
            return ''
        return str(s).strip().lower().replace('á', 'a').replace('é', 'e').replace('í', 'i').replace('ó', 'o').replace('ú', 'u').replace('ü', 'u')

    header_map = {
        'usuario': 'username', 'username': 'username', 'user': 'username', 'cuenta': 'username',
        'contrasena': 'password', 'password': 'password', 'clave': 'password', 'pass': 'password',
        'nombre': 'full_name', 'nombre completo': 'full_name', 'nombre_completo': 'full_name', 'fullname': 'full_name', 'name': 'full_name', 'full name': 'full_name'
    }
    first = rows[0]
    first_norm = [normalize(c) for c in first]
    has_header = any(h in header_map for h in first_norm)

    users = []
    if has_header:
        col_index = {}
        for ci, h in enumerate(first_norm):
            if h in header_map:
                col_index[header_map[h]] = ci
        for row in rows[1:]:
            if row is None or all(c is None or str(c).strip() == '' for c in row):
                continue
            def get(key):
                ci = col_index.get(key)
                if ci is None or ci >= len(row):
                    return ''
                return '' if row[ci] is None else str(row[ci])
            users.append({
                'username': get('username'),
                'password': get('password'),
                'full_name': get('full_name')
            })
    else:
        # No header: treat columns as username, password, full_name in order
        for row in rows:
            if row is None or all(c is None or str(c).strip() == '' for c in row):
                continue
            users.append({
                'username': '' if row[0] is None else str(row[0]),
                'password': '' if len(row) < 2 or row[1] is None else str(row[1]),
                'full_name': '' if len(row) < 3 or row[2] is None else str(row[2])
            })
    wb.close()
    return users


@app.route('/api/users/bulk-import', methods=['POST'])
@manager_required
def bulk_import_users():
    """Bulk create users from an uploaded Excel file (.xlsx/.xls).

    Form fields: api_config_id (required for admin), default_password (optional).
    """
    if 'file' not in request.files:
        return jsonify({'error': 'No se ha enviado ningun archivo'}), 400
    file = request.files['file']
    if not file.filename:
        return jsonify({'error': 'Archivo invalido'}), 400
    if not file.filename.lower().endswith(('.xlsx', '.xls')):
        return jsonify({'error': 'El archivo debe ser Excel (.xlsx o .xls)'}), 400

    try:
        users = _parse_excel_users(file)
    except Exception as e:
        return jsonify({'error': 'No se pudo leer el archivo Excel: ' + str(e)}), 400

    if not users:
        return jsonify({'error': 'El archivo no contiene usuarios validos'}), 400
    if len(users) > 500:
        return jsonify({'error': 'No se pueden crear mas de 500 usuarios a la vez'}), 400

    default_api_config_id = request.form.get('api_config_id')
    if default_api_config_id:
        try:
            default_api_config_id = int(default_api_config_id)
        except (TypeError, ValueError):
            default_api_config_id = None
    default_password = request.form.get('default_password')

    result = _bulk_create_users_core(g.user, users, default_api_config_id, default_password)
    if result[0] is None:
        return jsonify({'error': 'Permisos insuficientes'}), 403
    created, errors, role = result
    return jsonify({
        'message': 'Importacion completada',
        'created_count': len(created),
        'error_count': len(errors),
        'created': created,
        'errors': errors
    }), 200


@app.route('/api/users/bulk-password', methods=['POST'])
@manager_required
def bulk_update_passwords():
    """Bulk reset passwords for users, generating a random password per user.

    Admin can reset team_admins/team_members (not other admins).
    Team_admin can reset only their own team_members.
    Payload: { "ids": [1, 2, 3] } (each gets a unique random 10-char password).
    Cannot change own password here.
    """
    data = request.get_json() or {}
    ids = data.get('ids')
    # Backwards compatibility: accept { "items": [{"id":1}, ...] } as well
    if ids is None:
        items = data.get('items', [])
        if isinstance(items, list):
            ids = [it.get('id') for it in items if isinstance(it, dict)]
    if not isinstance(ids, list) or not ids:
        return jsonify({'error': 'Debe proporcionar una lista de usuarios'}), 400
    if len(ids) > 500:
        return jsonify({'error': 'No se pueden actualizar mas de 500 usuarios a la vez'}), 400

    db = get_db()
    current = g.user
    updated = []
    errors = []

    for idx, uid in enumerate(ids):
        if not uid:
            errors.append({'index': idx, 'error': 'ID de usuario requerido'})
            continue
        new_password = generate_password(10)

        row = db.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
        if not row:
            errors.append({'index': idx, 'id': uid, 'error': 'Usuario no encontrado'})
            continue
        if int(uid) == int(current['id']):
            errors.append({'index': idx, 'id': uid, 'username': row['username'], 'error': 'Use "Mi Cuenta" para cambiar su propia contrasena'})
            continue
        if current['role'] == 'team_admin':
            if row['role'] != 'team_member' or (row['team_creator_id'] is not None and int(row['team_creator_id']) != int(current['id'])):
                errors.append({'index': idx, 'id': uid, 'username': row['username'], 'error': 'Solo puede restablecer miembros de su equipo'})
                continue
        elif current['role'] == 'admin':
            if row['role'] == 'admin':
                errors.append({'index': idx, 'id': uid, 'username': row['username'], 'error': 'No puede modificar a otro administrador del sistema'})
                continue

        try:
            db.execute("UPDATE users SET password_hash=? WHERE id=?", (hash_password(new_password), uid))
            updated.append({'id': uid, 'username': row['username'], 'password': new_password})
        except Exception as e:
            errors.append({'index': idx, 'id': uid, 'username': row['username'], 'error': 'Error al actualizar: ' + str(e)})

    db.commit()
    return jsonify({
        'message': 'Contrasenas actualizadas',
        'updated_count': len(updated),
        'error_count': len(errors),
        'updated': updated,
        'errors': errors
    }), 200


def _users_for_export(current_user):
    """Return the list of users visible to the current user, with joined fields."""
    db = get_db()
    if current_user['role'] == 'admin':
        rows = db.execute("""
            SELECT u.id, u.username, u.full_name, u.role, u.is_active, u.created_at,
                   u.team_creator_id, u.last_login_ip, u.last_login_at,
                   c.username as creator_username,
                   tc.api_config_id, sac.name as config_name, sac.country as config_country
            FROM users u
            LEFT JOIN users c ON u.team_creator_id = c.id
            LEFT JOIN team_config tc ON u.id = tc.team_admin_id
            LEFT JOIN sms_api_configs sac ON tc.api_config_id = sac.id
            ORDER BY u.id
        """).fetchall()
    elif current_user['role'] == 'team_admin':
        rows = db.execute("""
            SELECT u.id, u.username, u.full_name, u.role, u.is_active, u.created_at,
                   u.team_creator_id, u.last_login_ip, u.last_login_at
            FROM users u
            WHERE u.id=? OR u.team_creator_id=?
            ORDER BY u.id
        """, (current_user['id'], current_user['id'])).fetchall()
    else:
        rows = db.execute("""
            SELECT u.id, u.username, u.full_name, u.role, u.is_active, u.created_at,
                   u.last_login_ip, u.last_login_at
            FROM users u WHERE u.id=?
        """, (current_user['id'],)).fetchall()
    return rows


def _build_users_workbook(rows, include_passwords=False, password_map=None, viewer_role='admin'):
    """Build an openpyxl Workbook for user export.

    include_passwords=True adds a 'Contrasena' column using password_map {id: plain},
    intended only for freshly created/reset passwords. Existing accounts show
    'Configurada (no visible)'.
    """
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment
    wb = Workbook()
    ws = wb.active
    ws.title = 'Usuarios'

    role_labels = {
        'admin': 'Administrador del Sistema',
        'team_admin': 'Administrador de Equipo',
        'team_member': 'Miembro de Equipo'
    }
    rows = [dict(r) for r in rows]

    headers = ['ID', 'Usuario', 'Nombre Completo', 'Rol', 'Equipo/Admin', 'Pais/Config API', 'Estado', 'Creado', 'Ultimo Login IP', 'Ultimo Login']
    if include_passwords:
        headers.append('Contrasena')

    header_font = Font(bold=True, color='FFFFFF')
    header_fill = PatternFill(start_color='2563EB', end_color='2563EB', fill_type='solid')
    for ci, h in enumerate(headers, start=1):
        cell = ws.cell(row=1, column=ci, value=h)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal='center')

    password_map = password_map or {}
    for ri, r in enumerate(rows, start=2):
        creator = r['creator_username'] if viewer_role == 'admin' else None
        config_name = r['config_name'] if viewer_role == 'admin' else None
        config_country = r['config_country'] if viewer_role == 'admin' else None
        team_field = creator if creator else ('Si' if r['role'] == 'team_admin' else '-')
        config_field = ''
        if config_name:
            config_field = f"{config_name} ({config_country})" if config_country else config_name
        elif r['role'] == 'team_admin':
            config_field = '-'
        is_active = r['is_active']
        if hasattr(is_active, 'real'):
            is_active = bool(is_active)
        values = [
            r['id'],
            r['username'],
            r['full_name'] or '',
            role_labels.get(r['role'], r['role']),
            team_field,
            config_field,
            'Activo' if is_active else 'Inactivo',
            str(r['created_at']) if r['created_at'] else '',
            r['last_login_ip'] or '',
            str(r['last_login_at']) if r['last_login_at'] else ''
        ]
        if include_passwords:
            values.append(password_map.get(r['id'], 'Configurada (no visible)'))
        for ci, v in enumerate(values, start=1):
            ws.cell(row=ri, column=ci, value=v)

    # Auto-ish column widths
    widths = [6, 18, 24, 26, 18, 20, 10, 22, 18, 22]
    if include_passwords:
        widths.append(18)
    for ci, w in enumerate(widths, start=1):
        ws.column_dimensions[chr(64 + ci) if ci <= 26 else 'A' + chr(64 + ci - 26)].width = w

    return wb


@app.route('/api/users/template', methods=['GET'])
@login_required
def download_user_template():
    """Download an Excel template for bulk user creation."""
    from io import BytesIO
    from flask import send_file
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill
    from openpyxl.comments import Comment

    wb = Workbook()
    ws = wb.active
    ws.title = 'Usuarios'

    headers = ['usuario', 'contrasena', 'nombre_completo']
    header_fill = PatternFill(start_color='2563EB', end_color='2563EB', fill_type='solid')
    header_font = Font(bold=True, color='FFFFFF')

    for col, name in enumerate(headers, start=1):
        cell = ws.cell(row=1, column=col, value=name)
        cell.fill = header_fill
        cell.font = header_font

    # Usage hints as comments on the header cells
    ws.cell(row=1, column=1).comment = Comment(
        'OBLIGATORIO. Nombre de usuario (unico, sin espacios).', 'SMS Platform'
    )
    ws.cell(row=1, column=2).comment = Comment(
        'OPCIONAL. Minimo 6 caracteres. Si se deja vacio, el sistema generara automaticamente una clave de 10 caracteres (letras y numeros).',
        'SMS Platform'
    )
    ws.cell(row=1, column=3).comment = Comment(
        'OPCIONAL. Nombre completo del usuario.', 'SMS Platform'
    )

    # Example rows
    examples = [
        ['juan.perez', 'Clave1234', 'Juan Perez'],
        ['maria.lopez', '', 'Maria Lopez'],
        ['carlos.ruiz', '', ''],
    ]
    for row in examples:
        ws.append(row)

    ws.column_dimensions['A'].width = 22
    ws.column_dimensions['B'].width = 18
    ws.column_dimensions['C'].width = 28

    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)
    return send_file(
        buf,
        as_attachment=True,
        download_name='plantilla_usuarios.xlsx',
        mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )


@app.route('/api/users/export', methods=['GET'])
@login_required
def export_users():
    """Export the visible user list as an .xlsx file (no password column)."""
    from io import BytesIO
    from flask import send_file
    rows = _users_for_export(g.user)
    wb = _build_users_workbook(rows, include_passwords=False, viewer_role=g.user['role'])
    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)
    return send_file(
        buf,
        as_attachment=True,
        download_name='usuarios.xlsx',
        mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )


@app.route('/api/users/export-passwords', methods=['POST'])
@manager_required
def export_passwords():
    """Export an .xlsx that includes plain-text passwords for the given ids.

    Only ids present in `ids` AND freshly known via `passwords` map (created/reset
    in the same operation) get their plain text. Others are marked as not visible.
    Payload: { "ids": [1,2], "passwords": {"1": "plain123"} }
    """
    from io import BytesIO
    from flask import send_file
    data = request.get_json() or {}
    ids = data.get('ids') or []
    passwords = data.get('passwords') or {}
    # Normalize keys to int
    try:
        id_set = set(int(i) for i in ids)
    except (TypeError, ValueError):
        return jsonify({'error': 'Lista de IDs invalida'}), 400
    password_map = {}
    for k, v in passwords.items():
        try:
            password_map[int(k)] = v
        except (TypeError, ValueError):
            continue

    rows = _users_for_export(g.user)
    # If ids provided, restrict to those; otherwise export all visible with known pw
    if id_set:
        rows = [r for r in rows if r['id'] in id_set]
    wb = _build_users_workbook(rows, include_passwords=True, password_map=password_map, viewer_role=g.user['role'])
    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)
    return send_file(
        buf,
        as_attachment=True,
        download_name='contrasenas_usuarios.xlsx',
        mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )


@app.route('/api/users/bulk-delete', methods=['POST'])
@manager_required
def bulk_delete_users():
    """Bulk delete users. Payload: { "ids": [1,2,3] }
    Enforces the same permission rules as single delete.
    """
    data = request.get_json() or {}
    ids = data.get('ids', [])
    if not isinstance(ids, list) or not ids:
        return jsonify({'error': 'Debe proporcionar una lista de IDs'}), 400
    if len(ids) > 500:
        return jsonify({'error': 'No se pueden eliminar mas de 500 usuarios a la vez'}), 400

    current = g.user
    db = get_db()

    deleted = []
    errors = []
    for uid in ids:
        try:
            uid = int(uid)
        except (TypeError, ValueError):
            errors.append({'id': uid, 'error': 'ID invalido'})
            continue
        if uid == current['id']:
            errors.append({'id': uid, 'error': 'No puede eliminar su propia cuenta'})
            continue
        user = db.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
        if not user:
            errors.append({'id': uid, 'error': 'Usuario no encontrado'})
            continue
        # Permission checks (same rules as single delete)
        if current['role'] == 'admin':
            if user['role'] == 'admin':
                errors.append({'id': uid, 'username': user['username'], 'error': 'No puede eliminar a otro Administrador del Sistema'})
                continue
        elif current['role'] == 'team_admin':
            if user['team_creator_id'] != current['id']:
                errors.append({'id': uid, 'username': user['username'], 'error': 'No es miembro de su equipo'})
                continue
            if user['role'] != 'team_member':
                errors.append({'id': uid, 'username': user['username'], 'error': 'Solo puede eliminar Miembros de Equipo'})
                continue
        else:
            errors.append({'id': uid, 'error': 'Permisos insuficientes'})
            continue
        # Protection: cannot delete a team_admin who still has members under them
        if user['role'] == 'team_admin':
            member_count = db.execute(
                "SELECT COUNT(*) as cnt FROM users WHERE team_creator_id=?",
                (uid,)
            ).fetchone()
            if member_count and member_count['cnt'] > 0:
                errors.append({
                    'id': uid,
                    'username': user['username'],
                    'error': f"Tiene {member_count['cnt']} miembro(s) a cargo. Elimínelos o reasígnelos primero."
                })
                continue
        db.execute("DELETE FROM users WHERE id=?", (uid,))
        deleted.append({'id': uid, 'username': user['username']})

    db.commit()
    return jsonify({
        'message': 'Eliminacion masiva completada',
        'deleted_count': len(deleted),
        'error_count': len(errors),
        'deleted': deleted,
        'errors': errors
    }), 200

# ============================================================
# Permissions API (admin manages menu access for each user)
# ============================================================

# Available menu pages that can be assigned
AVAILABLE_PAGES = [
    {'id': 'dashboard', 'label': 'Panel Principal', 'icon': 'grid'},
    {'id': 'contacts', 'label': 'Contactos', 'icon': 'users'},
    {'id': 'groups', 'label': 'Grupos', 'icon': 'folder'},
    {'id': 'templates', 'label': 'Plantillas', 'icon': 'file-text'},
    {'id': 'send', 'label': 'Enviar SMS', 'icon': 'send'},
    {'id': 'records', 'label': 'Registros', 'icon': 'activity'},
    {'id': 'content-search', 'label': 'Buscar Contenido', 'icon': 'search'},
    {'id': 'users', 'label': 'Usuarios', 'icon': 'user-plus'},
    {'id': 'my-account', 'label': 'Mi Cuenta', 'icon': 'user'},
    {'id': 'my-team', 'label': 'Mi Equipo', 'icon': 'users'},
    {'id': 'all-teams', 'label': 'Todos los Equipos', 'icon': 'bar-chart'},
    {'id': 'config', 'label': 'Configuracion API', 'icon': 'settings'},
]

@app.route('/api/role-permissions', methods=['GET'])
@admin_required
def get_role_permissions():
    """Get permissions for all roles"""
    import json as _json
    db = get_db()

    # Get all roles and their permissions
    roles = db.execute("""
        SELECT role, permissions FROM role_permissions
        ORDER BY role
    """).fetchall()

    role_perms = []
    for r in roles:
        perms_raw = r['permissions'] or ''
        try:
            perms = _json.loads(perms_raw) if perms_raw else []
        except Exception:
            perms = []
        role_perms.append({
            'role': r['role'],
            'role_label': ROLE_LABELS.get(r['role'], r['role']),
            'permissions': perms
        })

    return jsonify({
        'available_pages': AVAILABLE_PAGES,
        'roles': role_perms
    })

@app.route('/api/role-permissions/<role>', methods=['PUT'])
@admin_required
def update_role_permissions(role):
    """Update permissions for a specific role"""
    import json as _json
    db = get_db()

    data = request.get_json()
    permissions = data.get('permissions', [])

    # Validate permissions
    valid_ids = [p['id'] for p in AVAILABLE_PAGES]
    for p in permissions:
        if p not in valid_ids:
            return jsonify({'error': 'Invalid permission: ' + p}), 400

    # Admin role always has all permissions
    if role == 'admin':
        permissions = [p['id'] for p in AVAILABLE_PAGES] + ['role-permissions']

    perms_json = _json.dumps(permissions)

    # Update or insert
    existing = db.execute("SELECT role FROM role_permissions WHERE role = %s" if db.db_type == 'postgresql' else "SELECT role FROM role_permissions WHERE role = ?", (role,)).fetchone()
    if existing:
        db.execute("UPDATE role_permissions SET permissions = %s WHERE role = %s" if db.db_type == 'postgresql' else "UPDATE role_permissions SET permissions = ? WHERE role = ?", (perms_json, role))
    else:
        db.execute("INSERT INTO role_permissions (role, permissions) VALUES (%s, %s)" if db.db_type == 'postgresql' else "INSERT INTO role_permissions (role, permissions) VALUES (?, ?)", (role, perms_json))
    db.commit()

    return jsonify({'success': True, 'role': role, 'permissions': permissions})

@app.route('/api/permissions', methods=['GET'])
@admin_required
def get_permissions():
    """Get all available pages and current permissions for all users"""
    import json as _json
    db = get_db()
    users = db.execute("""
        SELECT id, username, full_name, role, permissions
        FROM users
        ORDER BY role, username
    """).fetchall()

    user_perms = []
    for u in users:
        perms_raw = u['permissions'] or ''
        try:
            perms = _json.loads(perms_raw) if perms_raw else []
        except Exception:
            perms = []
        # Admin always has all permissions
        if u['role'] == 'admin':
            perms = [p['id'] for p in AVAILABLE_PAGES]
        user_perms.append({
            'id': u['id'],
            'username': u['username'],
            'full_name': u['full_name'],
            'role': u['role'],
            'role_label': ROLE_LABELS.get(u['role'], u['role']),
            'permissions': perms
        })

    return jsonify({
        'available_pages': AVAILABLE_PAGES,
        'users': user_perms
    })

@app.route('/api/permissions/<int:user_id>', methods=['PUT'])
@admin_required
def update_permissions(user_id):
    """Update permissions for a specific user"""
    import json as _json
    db = get_db()

    # Cannot modify admin permissions
    target = db.execute("SELECT id, role FROM users WHERE id=?", (user_id,)).fetchone()
    if not target:
        return jsonify({'error': 'Usuario no encontrado'}), 404
    if target['role'] == 'admin':
        return jsonify({'error': 'No se pueden modificar los permisos del administrador'}), 403

    data = request.get_json()
    permissions = data.get('permissions', [])

    # Validate permissions
    valid_ids = [p['id'] for p in AVAILABLE_PAGES]
    permissions = [p for p in permissions if p in valid_ids]

    db.execute("UPDATE users SET permissions=?, updated_at=datetime('now') WHERE id=?",
               (_json.dumps(permissions), user_id))
    db.commit()

    return jsonify({'message': 'Permisos actualizados', 'permissions': permissions})

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
    remark = request.args.get('remark', '').strip()
    if remark:
        query += " AND c.remark = ?"
        count_query += " AND c.remark = ?"
        params.append(remark)
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
    remark = data.get('remark', '').strip()
    group_id = data.get('group_id', None)
    if not name or not phone:
        return jsonify({'error': 'Nombre y telefono son requeridos'}), 400
    db = get_db()
    if group_id:
        group = db.execute("SELECT id FROM contact_groups WHERE id=?", (int(group_id),)).fetchone()
        if not group:
            group_id = None
    db.execute(
        "INSERT INTO contacts (name, phone, notes, remark, group_id) VALUES (?, ?, ?, ?, ?)",
        (name, phone, notes, remark, group_id)
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
    remark = data.get('remark', contact['remark'])
    group_id = data.get('group_id', contact['group_id'])
    db.execute(
        "UPDATE contacts SET name=?, phone=?, notes=?, remark=?, group_id=? WHERE id=?",
        (name, phone, notes, remark, group_id, contact_id)
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
            notes = (row.get('notes') or row.get('notas') or row.get('observaciones') or '').strip()
            remark = (row.get('remark') or row.get('nota') or '').strip()
            if not name or not phone:
                errors.append(f"Fila {i}: nombre y telefono son requeridos")
                continue
            db.execute(
                "INSERT INTO contacts (name, phone, notes, remark, group_id) VALUES (?, ?, ?, ?, ?)",
                (name, phone, notes, remark, group_id)
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

    # Check daily limit for team members
    if g.user['role'] == 'team_member':
        db = get_db()
        team_cfg = db.execute(
            "SELECT daily_sms_limit FROM team_config WHERE team_admin_id=?",
            (g.user['team_creator_id'],)
        ).fetchone()
        daily_limit = team_cfg['daily_sms_limit'] if team_cfg and team_cfg['daily_sms_limit'] else 0
        if daily_limit > 0:
            today_count = db.execute(
                "SELECT COUNT(*) as cnt FROM sms_records WHERE created_by=? AND date(created_at)=date('now') AND status IN ('sent','pending')",
                (g.user['id'],)
            ).fetchone()
            cnt = today_count['cnt'] if today_count else 0
            if cnt >= daily_limit:
                return jsonify({'error': f'Has alcanzado tu limite diario de {daily_limit} SMS. Intenta manana.'}), 429
    content = data.get('content', '').strip()
    contact_names = data.get('contact_names', {})
    if not phones or not content:
        return jsonify({'error': 'Numero(s) y contenido son requeridos'}), 400
    if len(phones) > 500:
        return jsonify({'error': 'Maximo 500 numeros por envio'}), 400
    db = get_db()
    api_configured = is_sms_api_configured(g.user['id'])
    sms_config = get_team_sms_config(g.user['id'])
    records = []
    errors = []

    if api_configured and len(phones) == 1:
        # Single SMS - use /sms/send endpoint
        phone = phones[0].strip()
        name = contact_names.get(phone, '')
        msg = content.replace('{nombre}', name).replace('{telefono}', phone)
        result = sms_api_send_single(phone, msg)
        api_code = result.get('code', -1)
        api_msg = result.get('msg', '')
        if api_code == 0:
            msgid = ''
            if result.get('data'):
                msgid = result['data'].get('msgid', '')
            db.execute(
                "INSERT INTO sms_records (phone, contact_name, content, status, msgid, api_code, api_msg, sent_at, created_by) VALUES (?, ?, ?, 'sent', ?, ?, ?, datetime('now'), ?)",
                (phone, name, msg, msgid, api_code, api_msg, g.user['id'])
            )
            records.append({'phone': phone, 'status': 'sent', 'msgid': msgid})
        else:
            status_text = SMS_STATUS_CODES.get(api_code, api_msg)
            db.execute(
                "INSERT INTO sms_records (phone, contact_name, content, status, api_code, api_msg, sent_at, created_by) VALUES (?, ?, ?, 'failed', ?, ?, datetime('now'), ?)",
                (phone, name, msg, api_code, f"Code {api_code}: {status_text}", g.user['id'])
            )
            records.append({'phone': phone, 'status': 'failed', 'error': status_text})
            errors.append(f"{phone}: {status_text}")

    elif api_configured and len(phones) > 1:
        # Multiple SMS - use /sms/rsend endpoint (max 200 per batch)
        phone_content_pairs = []
        phone_name_map = {}
        for phone in phones:
            phone = phone.strip()
            if not phone:
                continue
            name = contact_names.get(phone, '')
            msg = content.replace('{nombre}', name).replace('{telefono}', phone)
            phone_content_pairs.append((phone, msg))
            phone_name_map[phone] = (name, msg)

        # Split into batches of 200
        for batch_start in range(0, len(phone_content_pairs), 200):
            batch = phone_content_pairs[batch_start:batch_start + 200]
            result = sms_api_send_batch(batch)
            api_code = result.get('code', -1)
            api_msg = result.get('msg', '')

            if api_code == 0 and result.get('data'):
                # Map results back to phones
                result_map = {}
                for item in result['data']:
                    result_map[item.get('das', '')] = item

                for phone, msg in batch:
                    name = phone_name_map[phone][0]
                    item = result_map.get(phone, {})
                    item_code = item.get('state', 0)
                    msgid = item.get('msgid', '')
                    if item_code == 0:
                        status = 'sent'
                    else:
                        status = 'failed'
                    db.execute(
                        "INSERT INTO sms_records (phone, contact_name, content, status, msgid, api_code, api_msg, sent_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)",
                        (phone, name, msg, status, msgid, item_code, api_msg, g.user['id'])
                    )
                    records.append({'phone': phone, 'status': status, 'msgid': msgid})
                    if status == 'failed':
                        errors.append(f"{phone}: {SMS_STATUS_CODES.get(item_code, 'Error desconocido')}")
            else:
                # Entire batch failed
                status_text = SMS_STATUS_CODES.get(api_code, api_msg)
                for phone, msg in batch:
                    name = phone_name_map[phone][0]
                    db.execute(
                        "INSERT INTO sms_records (phone, contact_name, content, status, api_code, api_msg, sent_at, created_by) VALUES (?, ?, ?, 'failed', ?, ?, datetime('now'), ?)",
                        (phone, name, msg, api_code, f"Code {api_code}: {status_text}", g.user['id'])
                    )
                    records.append({'phone': phone, 'status': 'failed', 'error': status_text})
                    errors.append(f"{phone}: {status_text}")
    else:
        # API not configured - simulate sending (for testing)
        for phone in phones:
            phone = phone.strip()
            if not phone:
                continue
            name = contact_names.get(phone, '')
            msg = content.replace('{nombre}', name).replace('{telefono}', phone)
            db.execute(
                "INSERT INTO sms_records (phone, contact_name, content, status, api_msg, sent_at, created_by) VALUES (?, ?, ?, 'sent', ?, datetime('now'), ?)",
                (phone, name, msg, 'API no configurada - envio simulado', g.user['id'])
            )
            records.append({'phone': phone, 'status': 'sent', 'simulated': True})

    db.commit()
    # Log the action
    log_status = 'success' if not errors else ('partial' if records else 'error')
    db.execute(
        "INSERT INTO send_logs (action, details, status) VALUES (?, ?, ?)",
        ('send', json.dumps({'phones_count': len(records), 'user': g.user['username'], 'api_configured': api_configured, 'errors': errors[:5]}), log_status)
    )
    db.commit()

    sent_count = sum(1 for r in records if r['status'] == 'sent')
    failed_count = sum(1 for r in records if r['status'] == 'failed')
    result_msg = f'{sent_count} mensaje(s) enviado(s)'
    if failed_count > 0:
        result_msg += f', {failed_count} fallido(s)'
    if not api_configured:
        result_msg += ' (modo simulacion - API no configurada)'

    return jsonify({'message': result_msg, 'records': records, 'errors': errors[:10]})

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
    # Role-based scope filtering
    if g.user['role'] == 'team_member':
        query += " AND created_by = ?"
        count_query += " AND created_by = ?"
        params.append(g.user['id'])
    elif g.user['role'] == 'team_admin':
        query += " AND created_by IN (SELECT id FROM users WHERE id=? OR team_creator_id=?)"
        count_query += " AND created_by IN (SELECT id FROM users WHERE id=? OR team_creator_id=?)"
        params.extend([g.user['id'], g.user['id']])
    # admin sees all
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
    # Build scope filter based on role
    scope_filter = ''
    scope_params = []
    if g.user['role'] == 'team_member':
        scope_filter = ' AND created_by = ?'
        scope_params = [g.user['id']]
    elif g.user['role'] == 'team_admin':
        scope_filter = ' AND created_by IN (SELECT id FROM users WHERE id=? OR team_creator_id=?)'
        scope_params = [g.user['id'], g.user['id']]
    today = datetime.now().strftime('%Y-%m-%d')
    today_sent = db.execute(
        f"SELECT COUNT(*) as count FROM sms_records WHERE status='sent' AND date(sent_at)=? {scope_filter}",
        [today] + scope_params
    ).fetchone()['count']
    today_total = db.execute(
        f"SELECT COUNT(*) as count FROM sms_records WHERE date(created_at)=? {scope_filter}",
        [today] + scope_params
    ).fetchone()['count']
    total_sent = db.execute(
        f"SELECT COUNT(*) as count FROM sms_records WHERE status='sent' {scope_filter}",
        scope_params
    ).fetchone()['count']
    total_failed = db.execute(
        f"SELECT COUNT(*) as count FROM sms_records WHERE status='failed' {scope_filter}",
        scope_params
    ).fetchone()['count']
    total_pending = db.execute(
        f"SELECT COUNT(*) as count FROM sms_records WHERE status IN ('pending', 'scheduled') {scope_filter}",
        scope_params
    ).fetchone()['count']
    total_all = db.execute(
        f"SELECT COUNT(*) as count FROM sms_records WHERE 1=1 {scope_filter}",
        scope_params
    ).fetchone()['count']
    # Last 7 days stats
    last_7_days = []
    for i in range(6, -1, -1):
        day = (datetime.now() - timedelta(days=i)).strftime('%Y-%m-%d')
        count = db.execute(
            f"SELECT COUNT(*) as count FROM sms_records WHERE status='sent' AND date(sent_at)=? {scope_filter}",
            [day] + scope_params
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
def get_sms_configs():
    db = get_db()
    configs = db.execute("SELECT * FROM sms_api_configs ORDER BY id").fetchall()
    config_list = []
    for c in configs:
        config_list.append({
            'id': c['id'],
            'name': c['name'] or '',
            'country': c['country'] or '',
            'domain': c['domain'] or '',
            'spid': c['spid'] or '',
            'api_pwd': c['api_pwd'] or '',
            'sender_name': c['sender_name'] or '',
            'is_active': bool(c['is_active']),
            'updated_at': c['updated_at']
        })
    return jsonify({'configs': config_list})

@app.route('/api/config/sms', methods=['POST'])
@admin_required
def create_sms_config():
    data = request.get_json()
    db = get_db()
    name = data.get('name', '').strip()
    country = data.get('country', '').strip()
    domain = data.get('domain', '').strip()
    spid = data.get('spid', '').strip()
    api_pwd = data.get('api_pwd', '').strip()
    sender_name = data.get('sender_name', '').strip()
    if not name:
        return jsonify({'error': 'Nombre es requerido'}), 400
    try:
        cursor = db.execute(
            "INSERT INTO sms_api_configs (name, country, domain, spid, api_pwd, sender_name) VALUES (?, ?, ?, ?, ?, ?)",
            (name, country, domain, spid, api_pwd, sender_name)
        )
        db.commit()
        return jsonify({'message': 'Configuracion creada', 'id': cursor.lastrowid})
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@app.route('/api/config/sms/<int:config_id>', methods=['PUT'])
@admin_required
def update_sms_config(config_id):
    data = request.get_json()
    db = get_db()
    name = data.get('name', '').strip()
    country = data.get('country', '').strip()
    domain = data.get('domain', '').strip()
    spid = data.get('spid', '').strip()
    api_pwd = data.get('api_pwd', '').strip()
    sender_name = data.get('sender_name', '').strip()
    is_active = data.get('is_active', True)
    db.execute(
        "UPDATE sms_api_configs SET name=?, country=?, domain=?, spid=?, api_pwd=?, sender_name=?, is_active=?, updated_at=datetime('now') WHERE id=?",
        (name, country, domain, spid, api_pwd, sender_name, 1 if is_active else 0, config_id)
    )
    db.commit()
    return jsonify({'message': 'Configuracion actualizada'})

@app.route('/api/config/sms/<int:config_id>', methods=['DELETE'])
@admin_required
def delete_sms_config(config_id):
    db = get_db()
    db.execute("DELETE FROM sms_api_configs WHERE id=?", (config_id,))
    db.commit()
    return jsonify({'message': 'Configuracion eliminada'})

@app.route('/api/config/sms/test', methods=['POST'])
@admin_required
def test_sms_config():
    data = request.get_json()
    config_id = data.get('config_id')
    db = get_db()
    config = get_sms_api_config(config_id)
    if not config or not (config.get('domain') and config.get('spid') and config.get('api_pwd')):
        return jsonify({'error': 'Configure el Dominio, SPID y Contrasena API primero'}), 400

    # Test connection by calling charset check with a simple text
    result = sms_api_check_charset("Test", config)
    api_code = result.get('code', -1)

    if api_code == 0:
        charset_info = result.get('data', {})
        db.execute(
            "INSERT INTO send_logs (action, details, status) VALUES (?, ?, ?)",
            ('test_connection', json.dumps({
                'domain': config['domain'],
                'spid': config['spid'],
                'charset': charset_info.get('charset', 'N/A'),
                'result': 'success'
            }), 'success')
        )
        db.commit()
        return jsonify({
            'message': f'Conexion exitosa. Codificacion detectada: {charset_info.get("charset", "N/A")}. '
                       f'Longitud por SMS: {charset_info.get("single", "N/A")} caracteres.'
        })
    else:
        error_msg = SMS_STATUS_CODES.get(api_code, result.get('msg', 'Error desconocido'))
        db.execute(
            "INSERT INTO send_logs (action, details, status) VALUES (?, ?, ?)",
            ('test_connection', json.dumps({
                'domain': config['domain'],
                'spid': config['spid'],
                'error_code': api_code,
                'error_msg': error_msg,
                'result': 'failed'
            }), 'error')
        )
        db.commit()
        return jsonify({'error': f'Error de conexion (codigo {api_code}): {error_msg}'}), 400

@app.route('/api/admin/user-usage', methods=['GET'])
@manager_required
def get_user_usage():
    """Get per-user SMS Usage statistics. System admin sees all; team admin sees own team."""
    db = get_db()
    date_from = request.args.get('date_from', '')
    date_to = request.args.get('date_to', '')
    # Build date filter
    date_filter = ''
    params = []
    if date_from:
        date_filter += ' AND date(r.created_at) >= ?'
        params.append(date_from)
    if date_to:
        date_filter += ' AND date(r.created_at) <= ?'
        params.append(date_to)
    # Build user filter
    user_filter = ''
    if g.user['role'] == 'team_admin':
        user_filter = ' AND (u.id = ? OR u.team_creator_id = ?)'
        params = [g.user['id'], g.user['id']] + params
    query = f"""
        SELECT
            u.id as user_id,
            u.username,
            u.full_name,
            u.role,
            u.is_active,
            u.team_creator_id,
            COALESCE(SUM(CASE WHEN r.status='sent' THEN 1 ELSE 0 END), 0) as sent,
            COALESCE(SUM(CASE WHEN r.status='failed' THEN 1 ELSE 0 END), 0) as failed,
            COALESCE(SUM(CASE WHEN r.status IN ('pending','scheduled') THEN 1 ELSE 0 END), 0) as pending,
            COALESCE(COUNT(r.id), 0) as total,
            MAX(r.created_at) as last_activity
        FROM users u
        LEFT JOIN sms_records r ON u.id = r.created_by {date_filter}
        WHERE 1=1 {user_filter}
        GROUP BY u.id
        ORDER BY total DESC
    """
    # Build user lookup for team affiliation
    user_map = {}
    all_users = db.execute('SELECT id, username, full_name FROM users').fetchall()
    for u in all_users:
        user_map[u['id']] = {'username': u['username'], 'full_name': u['full_name']}

    rows = db.execute(query, params).fetchall()
    users = []
    for row in rows:
        total = row['total']
        sent = row['sent']
        rate = round((sent / total * 100), 1) if total > 0 else 0
        # Team affiliation
        team_affiliation = '-'
        if row['role'] == 'team_member' and row['team_creator_id']:
            creator = user_map.get(row['team_creator_id'])
            if creator:
                team_affiliation = creator['full_name'] or creator['username']
        users.append({
            'user_id': row['user_id'],
            'username': row['username'],
            'full_name': row['full_name'],
            'role': row['role'],
            'role_label': ROLE_LABELS.get(row['role'], row['role']),
            'is_active': bool(row['is_active']),
            'team_affiliation': team_affiliation,
            'sent': sent,
            'failed': row['failed'],
            'pending': row['pending'],
            'total': total,
            'success_rate': rate,
            'last_activity': row['last_activity'] or ''
        })
    # Overall summary - only use date params (not user_filter params)
    date_params = []
    if date_from:
        date_params.append(date_from)
    if date_to:
        date_params.append(date_to)
    summary_filter = ''
    summary_params = list(date_params)
    if g.user['role'] == 'team_admin':
        summary_filter = ' AND created_by IN (SELECT id FROM users WHERE id=? OR team_creator_id=?)'
        summary_params.extend([g.user['id'], g.user['id']])
    summary = db.execute(f"""
        SELECT
            COUNT(*) as total_users,
            COALESCE(SUM(CASE WHEN status='sent' THEN 1 ELSE 0 END), 0) as total_sent,
            COALESCE(SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END), 0) as total_failed,
            COALESCE(COUNT(id), 0) as total_all
        FROM sms_records WHERE 1=1 {date_filter} {summary_filter}
    """, summary_params).fetchone()

    # Team summary: aggregate by team (team_admin's team)
    team_summary = []
    if g.user['role'] == 'admin':
        # For system admin: show all teams
        team_rows = db.execute(f"""
            SELECT
                ta.id as team_admin_id,
                ta.username as team_admin_username,
                ta.full_name as team_admin_name,
                COUNT(DISTINCT m.id) + 1 as member_count,
                COALESCE(SUM(CASE WHEN r.status='sent' THEN 1 ELSE 0 END), 0) as team_sent,
                COALESCE(SUM(CASE WHEN r.status='failed' THEN 1 ELSE 0 END), 0) as team_failed,
                COALESCE(COUNT(r.id), 0) as team_total
            FROM users ta
            LEFT JOIN users m ON m.team_creator_id = ta.id
            LEFT JOIN sms_records r ON (r.created_by = ta.id OR r.created_by = m.id) {('AND date(r.created_at) >= ? AND date(r.created_at) <= ?' if date_from and date_to else '')}
            WHERE ta.role = 'team_admin'
            GROUP BY ta.id
            ORDER BY team_total DESC
        """, ([date_from, date_to] if date_from and date_to else [])).fetchall()
        for tr in team_rows:
            team_total = tr['team_total'] or 0
            team_sent = tr['team_sent'] or 0
            team_failed = tr['team_failed'] or 0
            team_rate = round((team_sent / team_total * 100), 1) if team_total > 0 else 0
            team_summary.append({
                'team_name': tr['team_admin_name'] or tr['team_admin_username'],
                'team_admin': tr['team_admin_username'],
                'member_count': tr['member_count'],
                'total': team_total,
                'sent': team_sent,
                'failed': team_failed,
                'rate': team_rate
            })
    elif g.user['role'] == 'team_admin':
        # For team admin: show own team only
        member_ids = [u['id'] for u in db.execute(
            "SELECT id FROM users WHERE team_creator_id = ?", (g.user['id'],)
        ).fetchall()]
        member_ids.append(g.user['id'])
        placeholders = ','.join('?' * len(member_ids))
        team_row = db.execute(f"""
            SELECT
                COUNT(DISTINCT u.id) as member_count,
                COALESCE(SUM(CASE WHEN r.status='sent' THEN 1 ELSE 0 END), 0) as team_sent,
                COALESCE(SUM(CASE WHEN r.status='failed' THEN 1 ELSE 0 END), 0) as team_failed,
                COALESCE(COUNT(r.id), 0) as team_total
            FROM users u
            LEFT JOIN sms_records r ON r.created_by = u.id {('AND date(r.created_at) >= ? AND date(r.created_at) <= ?' if date_from and date_to else '')}
            WHERE u.id IN ({placeholders})
        """, (member_ids + ([date_from, date_to] if date_from and date_to else []))).fetchone()
        team_total = team_row['team_total'] or 0
        team_sent = team_row['team_sent'] or 0
        team_failed = team_row['team_failed'] or 0
        team_rate = round((team_sent / team_total * 100), 1) if team_total > 0 else 0
        team_summary.append({
            'team_name': g.user['full_name'] or g.user['username'],
            'team_admin': g.user['username'],
            'member_count': team_row['member_count'],
            'total': team_total,
            'sent': team_sent,
            'failed': team_failed,
            'rate': team_rate
        })

    return jsonify({
        'users': users,
        'summary': {
            'total_users': summary['total_users'] if summary else 0,
            'total_sent': summary['total_sent'] if summary else 0,
            'total_failed': summary['total_failed'] if summary else 0,
            'total_all': summary['total_all'] if summary else 0
        },
        'team_summary': team_summary
    })

@app.route('/api/admin/unified-stats', methods=['GET'])
@login_required
def get_unified_stats():
    """Get unified statistics with 3 panels: my account, my team, all teams"""
    db = get_db()
    user_id = session['user_id']
    role = session['role']
    date_from = request.args.get('date_from', '')
    date_to = request.args.get('date_to', '')
    filter_user_id = request.args.get('user_id', '')  # Account filter

    # Build date filter
    date_filter = ''
    date_params = []
    if date_from:
        date_filter += ' AND date(created_at) >= ?'
        date_params.append(date_from)
    if date_to:
        date_filter += ' AND date(created_at) <= ?'
        date_params.append(date_to)

    # 1. My Account stats (with optional account filter)
    account_user_id = int(filter_user_id) if filter_user_id and filter_user_id.isdigit() else user_id
    my_account = db.execute(f"""
        SELECT
            COALESCE(SUM(CASE WHEN status='sent' THEN 1 ELSE 0 END), 0) as sent,
            COALESCE(SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END), 0) as failed,
            COALESCE(SUM(CASE WHEN status IN ('pending','scheduled') THEN 1 ELSE 0 END), 0) as pending,
            COALESCE(COUNT(id), 0) as total
        FROM sms_records WHERE created_by = ? {date_filter}
    """, [account_user_id] + date_params).fetchone()

    my_account_data = {
        'total': my_account['total'] if my_account else 0,
        'sent': my_account['sent'] if my_account else 0,
        'failed': my_account['failed'] if my_account else 0,
        'pending': my_account['pending'] if my_account else 0,
        'rate': round((my_account['sent'] / my_account['total'] * 100), 1) if my_account and my_account['total'] > 0 else 0
    }

    # 2. My Team stats
    my_team_data = None
    if role in ('admin', 'team_admin'):
        if role == 'team_admin':
            # Get team member IDs
            member_ids = [u['id'] for u in db.execute(
                "SELECT id FROM users WHERE team_creator_id = ?", (user_id,)
            ).fetchall()]
            member_ids.append(user_id)
            placeholders = ','.join('?' * len(member_ids))
            team_stats = db.execute(f"""
                SELECT
                    COUNT(DISTINCT u.id) as member_count,
                    COALESCE(SUM(CASE WHEN r.status='sent' THEN 1 ELSE 0 END), 0) as sent,
                    COALESCE(SUM(CASE WHEN r.status='failed' THEN 1 ELSE 0 END), 0) as failed,
                    COALESCE(SUM(CASE WHEN r.status IN ('pending','scheduled') THEN 1 ELSE 0 END), 0) as pending,
                    COALESCE(COUNT(r.id), 0) as total
                FROM users u
                LEFT JOIN sms_records r ON r.created_by = u.id {date_filter}
                WHERE u.id IN ({placeholders})
            """, member_ids + date_params).fetchone()
        else:
            # Admin: get all teams summary
            team_stats = db.execute(f"""
                SELECT
                    COUNT(DISTINCT u.id) as member_count,
                    COALESCE(SUM(CASE WHEN r.status='sent' THEN 1 ELSE 0 END), 0) as sent,
                    COALESCE(SUM(CASE WHEN r.status='failed' THEN 1 ELSE 0 END), 0) as failed,
                    COALESCE(SUM(CASE WHEN r.status IN ('pending','scheduled') THEN 1 ELSE 0 END), 0) as pending,
                    COALESCE(COUNT(r.id), 0) as total
                FROM users u
                LEFT JOIN sms_records r ON r.created_by = u.id {date_filter}
                WHERE u.role IN ('team_admin', 'team_member')
            """, date_params).fetchone()

        if team_stats:
            # Get team name (admin's username)
            team_name = 'Mi Equipo'
            daily_limit = 0
            if role == 'team_admin':
                admin_row = db.execute("SELECT username FROM users WHERE id = ?", (user_id,)).fetchone()
                if admin_row:
                    team_name = f"Equipo de {admin_row['username']}"
                # Get daily limit from team_config
                limit_row = db.execute("SELECT daily_limit FROM team_config WHERE admin_id = ?", (user_id,)).fetchone()
                if limit_row and limit_row['daily_limit']:
                    daily_limit = limit_row['daily_limit']
            elif role == 'admin':
                team_name = 'Todos los Equipos'

            # Today's SMS count
            today_filter_simple = "AND date(created_at) = date('now')" if db.db_type != 'postgres' else "AND date(created_at) = CURRENT_DATE"
            if role == 'team_admin':
                today_row = db.execute(f"""
                    SELECT COUNT(*) as cnt FROM sms_records
                    WHERE created_by IN ({placeholders}) {today_filter_simple}
                """, member_ids).fetchone()
            else:
                today_row = db.execute(f"""
                    SELECT COUNT(*) as cnt FROM sms_records
                    WHERE created_by IN (SELECT id FROM users WHERE role IN ('team_admin','team_member'))
                    {today_filter_simple}
                """).fetchone()
            today_count = today_row['cnt'] if today_row else 0

            # Last activity
            if role == 'team_admin':
                last_row = db.execute(f"""
                    SELECT MAX(created_at) as last_at FROM sms_records
                    WHERE created_by IN ({placeholders})
                """, member_ids).fetchone()
            else:
                last_row = db.execute("""
                    SELECT MAX(created_at) as last_at FROM sms_records
                    WHERE created_by IN (SELECT id FROM users WHERE role IN ('team_admin','team_member'))
                """).fetchone()
            last_activity = last_row['last_at'] if last_row and last_row['last_at'] else None

            my_team_data = {
                'team_name': team_name,
                'member_count': team_stats['member_count'],
                'total': team_stats['total'],
                'sent': team_stats['sent'],
                'failed': team_stats['failed'],
                'pending': team_stats['pending'],
                'today': today_count,
                'daily_limit': daily_limit,
                'last_activity': last_activity,
                'rate': round((team_stats['sent'] / team_stats['total'] * 100), 1) if team_stats['total'] > 0 else 0
            }

    # 3. All Teams stats (admin only)
    all_teams_data = None
    all_teams_list = []
    if role == 'admin':
        # Overall stats
        overall = db.execute(f"""
            SELECT
                COUNT(DISTINCT u.id) as member_count,
                COALESCE(SUM(CASE WHEN r.status='sent' THEN 1 ELSE 0 END), 0) as sent,
                COALESCE(SUM(CASE WHEN r.status='failed' THEN 1 ELSE 0 END), 0) as failed,
                COALESCE(COUNT(r.id), 0) as total
            FROM users u
            LEFT JOIN sms_records r ON r.created_by = u.id {date_filter}
        """, date_params).fetchone()

        # Today's total SMS
        today_total_row = db.execute("""
            SELECT COUNT(*) as cnt FROM sms_records
            WHERE date(created_at) = date('now')
        """).fetchone()
        today_total = today_total_row['cnt'] if today_total_row else 0

        if overall:
            all_teams_data = {
                'member_count': overall['member_count'],
                'total': overall['total'],
                'sent': overall['sent'],
                'failed': overall['failed'],
                'today': today_total,
                'rate': round((overall['sent'] / overall['total'] * 100), 1) if overall['total'] > 0 else 0
            }

        # Per-team breakdown
        team_rows = db.execute(f"""
            SELECT
                ta.id as team_admin_id,
                ta.username as team_admin_username,
                ta.full_name as team_admin_name,
                COUNT(DISTINCT m.id) + 1 as member_count,
                COALESCE(SUM(CASE WHEN r.status='sent' THEN 1 ELSE 0 END), 0) as sent,
                COALESCE(SUM(CASE WHEN r.status='failed' THEN 1 ELSE 0 END), 0) as failed,
                COALESCE(COUNT(r.id), 0) as total
            FROM users ta
            LEFT JOIN users m ON m.team_creator_id = ta.id
            LEFT JOIN sms_records r ON (r.created_by = ta.id OR r.created_by = m.id) {date_filter}
            WHERE ta.role = 'team_admin'
            GROUP BY ta.id
            ORDER BY total DESC
        """, date_params).fetchall()

        for tr in team_rows:
            team_total = tr['total'] or 0
            team_sent = tr['sent'] or 0
            team_failed = tr['failed'] or 0
            team_rate = round((team_sent / team_total * 100), 1) if team_total > 0 else 0
            # Get today's count for this team
            team_today_row = db.execute("""
                SELECT COUNT(*) as cnt FROM sms_records
                WHERE created_by IN (
                    SELECT id FROM users WHERE id = ? OR team_creator_id = ?
                ) AND date(created_at) = date('now')
            """, (tr['team_admin_id'], tr['team_admin_id'])).fetchone()
            team_today = team_today_row['cnt'] if team_today_row else 0
            all_teams_list.append({
                'team_name': tr['team_admin_name'] or tr['team_admin_username'],
                'team_admin': tr['team_admin_username'],
                'member_count': tr['member_count'],
                'total': team_total,
                'sent': team_sent,
                'failed': team_failed,
                'today': team_today,
                'rate': team_rate
            })

    # Get users list for filter dropdown
    users_list = []
    if role == 'admin':
        users_list = db.execute("SELECT id, username, full_name FROM users WHERE role IN ('team_admin','team_member') ORDER BY username").fetchall()
    elif role == 'team_admin':
        users_list = db.execute("SELECT id, username, full_name FROM users WHERE id = ? OR team_creator_id = ? ORDER BY username", (user_id, user_id)).fetchall()
    else:
        users_list = [{'id': user_id, 'username': session.get('username', ''), 'full_name': ''}]

    # Convert to dicts
    users_dicts = [{'id': u['id'], 'username': u['username'], 'full_name': u['full_name']} for u in users_list]

    return jsonify({
        'my_account': my_account_data,
        'my_team': my_team_data,
        'all_teams': all_teams_data,
        'all_teams_list': all_teams_list,
        'users': users_dicts
    })

@app.route('/api/admin/team-daily-stats', methods=['GET'])
@login_required
def get_team_daily_stats():
    """Get daily SMS statistics for the team (last 30 days)"""
    db = get_db()
    user_id = session['user_id']
    role = session['role']
    user = db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()

    if role == 'admin':
        date_filter = ""
        params = ()
    elif role == 'team_admin':
        member_ids = [u['id'] for u in db.execute(
            "SELECT id FROM users WHERE team_creator_id = ?", (user['id'],)
        ).fetchall()]
        member_ids.append(user['id'])
        placeholders = ','.join('?' * len(member_ids))
        date_filter = f" AND created_by IN ({placeholders})"
        params = tuple(member_ids)
    else:
        date_filter = " AND created_by = ?"
        params = (user['id'],)

    # Get last 30 days daily stats
    rows = db.execute(f"""
        SELECT
            DATE(created_at) as day,
            COUNT(*) as total,
            SUM(CASE WHEN status='sent' THEN 1 ELSE 0 END) as sent,
            SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) as failed
        FROM sms_records
        WHERE created_at >= date('now', '-30 days') {date_filter}
        GROUP BY DATE(created_at)
        ORDER BY day ASC
    """, params).fetchall()

    # Fill in missing days with zeros
    from datetime import datetime, timedelta
    stats = {}
    for row in rows:
        stats[row['day']] = {'total': row['total'], 'sent': row['sent'], 'failed': row['failed']}

    result = []
    for i in range(29, -1, -1):
        day = (datetime.now() - timedelta(days=i)).strftime('%Y-%m-%d')
        result.append({
            'day': day,
            'total': stats.get(day, {}).get('total', 0),
            'sent': stats.get(day, {}).get('sent', 0),
            'failed': stats.get(day, {}).get('failed', 0)
        })

    # Compute summary totals
    total_all = sum(r['total'] for r in result)
    sent_all = sum(r['sent'] for r in result)
    today_str = datetime.now().strftime('%Y-%m-%d')
    today_all = stats.get(today_str, {}).get('total', 0)

    return jsonify({'daily_stats': result, 'total': total_all, 'today': today_all, 'sent': sent_all})

# ==================== Estadisticas por Equipo (Admin) ====================

@app.route('/api/admin/team-stats', methods=['GET'])
@login_required
def get_team_stats():
    """Get aggregated SMS statistics grouped by team (for system admin only)"""
    if session['role'] != 'admin':
        return jsonify({'error': 'Acceso denegado'}), 403

    db = get_db()

    # Get all team admins with their team info
    team_admins = db.execute("""
        SELECT u.id, u.username, u.full_name, u.is_active, u.created_at,
               (SELECT COUNT(*) FROM users WHERE team_creator_id = u.id) as member_count,
               (SELECT daily_sms_limit FROM team_config WHERE team_admin_id = u.id) as daily_limit
        FROM users u
        WHERE u.role = 'team_admin'
        ORDER BY u.username ASC
    """).fetchall()

    teams = []
    for ta in team_admins:
        ta_id = ta['id']
        # Get member IDs (team admin + their members)
        member_ids = [u['id'] for u in db.execute(
            "SELECT id FROM users WHERE team_creator_id = ? UNION SELECT ? as id",
            (ta_id, ta_id)
        ).fetchall()]
        placeholders = ','.join('?' * len(member_ids))

        # Total SMS stats for this team
        total_row = db.execute(f"""
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN status='sent' THEN 1 ELSE 0 END) as sent,
                SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) as failed,
                SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) as pending
            FROM sms_records
            WHERE created_by IN ({placeholders})
        """, member_ids).fetchone()

        # Today's SMS count
        today_row = db.execute(f"""
            SELECT COUNT(*) as cnt
            FROM sms_records
            WHERE created_by IN ({placeholders})
              AND DATE(created_at) = DATE('now')
        """, member_ids).fetchone()

        # Last 30 days daily breakdown for chart
        daily_rows = db.execute(f"""
            SELECT
                DATE(created_at) as day,
                COUNT(*) as total,
                SUM(CASE WHEN status='sent' THEN 1 ELSE 0 END) as sent
            FROM sms_records
            WHERE created_by IN ({placeholders})
              AND created_at >= date('now', '-30 days')
            GROUP BY DATE(created_at)
            ORDER BY day ASC
        """, member_ids).fetchall()

        daily_stats = {}
        for dr in daily_rows:
            daily_stats[dr['day']] = {'total': dr['total'], 'sent': dr['sent']}

        from datetime import datetime, timedelta
        chart_data = []
        for i in range(29, -1, -1):
            day = (datetime.now() - timedelta(days=i)).strftime('%Y-%m-%d')
            chart_data.append({
                'day': day,
                'total': daily_stats.get(day, {}).get('total', 0),
                'sent': daily_stats.get(day, {}).get('sent', 0)
            })

        total_sms = total_row['total'] if total_row and total_row['total'] else 0
        sent_sms = total_row['sent'] if total_row and total_row['sent'] else 0
        success_rate = round(sent_sms / total_sms * 100, 1) if total_sms > 0 else 0

        teams.append({
            'team_admin_id': ta_id,
            'team_name': ta['full_name'] or ta['username'],
            'username': ta['username'],
            'is_active': ta['is_active'],
            'member_count': ta['member_count'],
            'daily_limit': ta['daily_limit'] if ta['daily_limit'] else 0,
            'total_sms': total_sms,
            'sent_sms': sent_sms,
            'failed_sms': total_row['failed'] if total_row and total_row['failed'] else 0,
            'pending_sms': total_row['pending'] if total_row and total_row['pending'] else 0,
            'today_sms': today_row['cnt'] if today_row else 0,
            'success_rate': success_rate,
            'daily_chart': chart_data
        })

    # Grand totals
    grand_total = sum(t['total_sms'] for t in teams)
    grand_sent = sum(t['sent_sms'] for t in teams)
    grand_today = sum(t['today_sms'] for t in teams)
    grand_members = sum(t['member_count'] for t in teams) + len(teams)

    return jsonify({
        'teams': teams,
        'summary': {
            'total_teams': len(teams),
            'total_members': grand_members,
            'total_sms': grand_total,
            'today_sms': grand_today,
            'sent_sms': grand_sent,
            'success_rate': round(grand_sent / grand_total * 100, 1) if grand_total > 0 else 0
        }
    })

# ==================== Configuracion de limite diario ====================

@app.route('/api/config/daily-limit', methods=['GET'])
@manager_required
def get_daily_limit():
    """Obtener el limite diario de SMS del equipo actual"""
    db = get_db()
    user = g.user
    if user['role'] == 'admin':
        # Admin: ver limite global (primer registro sin team_admin_id especifico)
        row = db.execute(
            "SELECT daily_sms_limit FROM team_config WHERE team_admin_id=0"
        ).fetchone()
        return jsonify({'daily_limit': row['daily_sms_limit'] if row else 100})
    else:
        # Team admin: ver limite de su equipo
        row = db.execute(
            "SELECT daily_sms_limit FROM team_config WHERE team_admin_id=?",
            (user['id'],)
        ).fetchone()
        return jsonify({'daily_limit': row['daily_sms_limit'] if row else 100})

@app.route('/api/config/daily-limit', methods=['POST'])
@manager_required
def set_daily_limit():
    """Establecer el limite diario de SMS"""
    db = get_db()
    user = g.user
    data = request.get_json()
    limit = data.get('limit')

    if limit is None or not isinstance(limit, int) or limit < 0:
        return jsonify({'error': 'Proporcione un valor valido (entero no negativo)'}), 400

    if user['role'] == 'admin':
        team_admin_id = 0  # global config
    else:
        team_admin_id = user['id']

    existing = db.execute(
        "SELECT id FROM team_config WHERE team_admin_id=?",
        (team_admin_id,)
    ).fetchone()
    if existing:
        db.execute(
            "UPDATE team_config SET daily_sms_limit=? WHERE team_admin_id=?",
            (limit, team_admin_id)
        )
    else:
        db.execute(
            "INSERT INTO team_config (team_admin_id, daily_sms_limit) VALUES (?, ?)",
            (team_admin_id, limit)
        )
    db.commit()
    return jsonify({'message': 'Limite diario actualizado', 'daily_limit': limit})

@app.route('/api/config/team-api-config', methods=['GET'])
@admin_required
def get_team_api_configs():
    """Get all teams with their API config assignments."""
    db = get_db()
    teams = db.execute('''
        SELECT tc.id, tc.team_admin_id, tc.api_config_id, tc.daily_sms_limit,
               u.username as team_admin_name, u.full_name as team_admin_full_name,
               sac.name as api_config_name, sac.country as api_config_country
        FROM team_config tc
        JOIN users u ON tc.team_admin_id = u.id
        LEFT JOIN sms_api_configs sac ON tc.api_config_id = sac.id
        ORDER BY u.username
    ''').fetchall()
    team_list = []
    for t in teams:
        team_list.append({
            'id': t['id'],
            'team_admin_id': t['team_admin_id'],
            'team_admin_name': t['team_admin_name'],
            'team_admin_full_name': t['team_admin_full_name'] or '',
            'api_config_id': t['api_config_id'],
            'api_config_name': t['api_config_name'] or 'Sin asignar',
            'api_config_country': t['api_config_country'] or '',
            'daily_sms_limit': t['daily_sms_limit']
        })
    configs = db.execute("SELECT id, name, country FROM sms_api_configs WHERE is_active=1 ORDER BY name").fetchall()
    config_list = [{'id': c['id'], 'name': c['name'], 'country': c['country']} for c in configs]
    return jsonify({'teams': team_list, 'configs': config_list})

@app.route('/api/config/team-api-config', methods=['PUT'])
@admin_required
def update_team_api_config():
    """Update team's API config assignment."""
    db = get_db()
    data = request.get_json()
    team_admin_id = data.get('team_admin_id')
    api_config_id = data.get('api_config_id')
    if not team_admin_id:
        return jsonify({'error': 'team_admin_id es requerido'}), 400
    existing = db.execute(
        "SELECT id FROM team_config WHERE team_admin_id=?",
        (team_admin_id,)
    ).fetchone()
    if existing:
        db.execute(
            "UPDATE team_config SET api_config_id=? WHERE team_admin_id=?",
            (api_config_id if api_config_id else None, team_admin_id)
        )
    else:
        db.execute(
            "INSERT INTO team_config (team_admin_id, api_config_id, daily_sms_limit) VALUES (?, ?, 100)",
            (team_admin_id, api_config_id if api_config_id else None)
        )
    db.commit()
    return jsonify({'message': 'Configuracion API actualizada'})

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
    """Process pending scheduled messages using the real SMS API."""
    db = get_db()
    now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    scheduled = db.execute(
        "SELECT * FROM sms_records WHERE status='scheduled' AND scheduled_at <= ?",
        (now,)
    ).fetchall()

    if not scheduled:
        return 0

    api_configured = is_sms_api_configured()
    processed = 0

    if api_configured:
        # Group into batches for efficient sending
        phone_content_pairs = [(r['phone'], r['content']) for r in scheduled]

        for batch_start in range(0, len(phone_content_pairs), 200):
            batch = phone_content_pairs[batch_start:batch_start + 200]
            batch_records = scheduled[batch_start:batch_start + 200]
            result = sms_api_send_batch(batch)
            api_code = result.get('code', -1)

            if api_code == 0 and result.get('data'):
                result_map = {}
                for item in result['data']:
                    result_map[item.get('das', '')] = item

                for record in batch_records:
                    item = result_map.get(record['phone'], {})
                    item_state = item.get('state', 0)
                    msgid = item.get('msgid', '')
                    if item_state == 0:
                        db.execute(
                            "UPDATE sms_records SET status='sent', msgid=?, api_code=?, sent_at=datetime('now') WHERE id=?",
                            (msgid, api_code, record['id'])
                        )
                    else:
                        db.execute(
                            "UPDATE sms_records SET status='failed', api_code=?, api_msg=? WHERE id=?",
                            (item_state, SMS_STATUS_CODES.get(item_state, 'Error'), record['id'])
                        )
                    processed += 1
            else:
                # Entire batch failed
                for record in batch_records:
                    db.execute(
                        "UPDATE sms_records SET status='failed', api_code=?, api_msg=? WHERE id=?",
                        (api_code, SMS_STATUS_CODES.get(api_code, result.get('msg', 'Error')), record['id'])
                    )
                    processed += 1
    else:
        # API not configured - simulate
        for record in scheduled:
            db.execute(
                "UPDATE sms_records SET status='sent', api_msg='API no configurada - envio simulado', sent_at=datetime('now') WHERE id=?",
                (record['id'],)
            )
            processed += 1

    if processed:
        db.commit()
    return processed

@app.route('/api/sms/process-scheduled', methods=['POST'])
@login_required
def trigger_process_scheduled():
    count = process_scheduled_messages()
    return jsonify({'message': f'{count} mensaje(s) programado(s) procesado(s)'})

@app.route('/api/sms/query-status', methods=['POST'])
@login_required
def query_sms_status_endpoint():
    """Query delivery status for sent messages."""
    data = request.get_json()
    record_ids = data.get('record_ids', [])
    if not record_ids:
        return jsonify({'error': 'IDs de registros son requeridos'}), 400

    db = get_db()
    if not is_sms_api_configured():
        return jsonify({'error': 'API SMS no configurada'}), 400

    # Get msgids from records
    placeholders = ','.join(['?'] * len(record_ids))
    records = db.execute(
        f"SELECT id, msgid, phone FROM sms_records WHERE id IN ({placeholders}) AND msgid != ''",
        record_ids
    ).fetchall()

    if not records:
        return jsonify({'error': 'No se encontraron mensajes con ID de API'}), 404

    msgids = [r['msgid'] for r in records]
    result = sms_api_query_status(msgids)
    api_code = result.get('code', -1)

    if api_code == 0 and result.get('data'):
        # Update records with status
        state_map = {0: 'pending', 1: 'sent', 2: 'failed'}
        state_names = {0: 'Sin回执 (Enviado)', 1: 'Entregado', 2: 'Fallido'}
        updates = []
        for item in result['data']:
            msgid = item.get('msgid', '')
            state = item.get('state', 0)
            status = state_map.get(state, 'pending')
            db.execute(
                "UPDATE sms_records SET status=? WHERE msgid=?",
                (status, msgid)
            )
            updates.append({'msgid': msgid, 'state': state, 'state_name': state_names.get(state, 'Desconocido')})
        db.commit()
        return jsonify({'message': f'{len(updates)} estado(s) actualizado(s)', 'updates': updates})
    else:
        error_msg = SMS_STATUS_CODES.get(api_code, result.get('msg', 'Error'))
        return jsonify({'error': f'Error al consultar estado (codigo {api_code}): {error_msg}'}), 400

@app.route('/api/sms/check-charset', methods=['POST'])
@login_required
def check_sms_charset():
    """Check charset and billing info for SMS content."""
    data = request.get_json()
    content = data.get('content', '').strip()
    if not content:
        return jsonify({'error': 'Contenido es requerido'}), 400

    if not is_sms_api_configured():
        # Return local estimation
        # Spanish uses UCS2: 70 chars per SMS, 67 per long SMS part
        char_count = len(content)
        if char_count <= 70:
            parts = 1
            single = 70
        else:
            parts = (char_count + 66) // 67  # ceil division
            single = 67
        return jsonify({
            'charset': 'UCS2',
            'parts': parts,
            'single': single,
            'char_count': char_count,
            'detail': f'Contenido con {char_count} caracteres. Codificacion UCS2 (Espanol). Se factura como {parts} SMS.',
            'api_configured': False
        })

    result = sms_api_check_charset(content)
    api_code = result.get('code', -1)
    if api_code == 0:
        data = result.get('data', {})
        data['api_configured'] = True
        return jsonify(data)
    else:
        error_msg = SMS_STATUS_CODES.get(api_code, result.get('msg', 'Error'))
        return jsonify({'error': f'Error al verificar codificacion (codigo {api_code}): {error_msg}'}), 400

# ============================================================
# Initialize and run
# ============================================================

init_db()

if __name__ == '__main__':
    port = int(os.environ.get('DEPLOY_RUN_PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)
