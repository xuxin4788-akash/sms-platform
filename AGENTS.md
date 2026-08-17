# AGENTS.md - SMS Marketing Platform

## Project Overview
A team-oriented SMS marketing management platform with Spanish (es) UI. Built with Python Flask + PostgreSQL/SQLite + vanilla HTML/CSS/JS SPA. Supports large team deployment (20+ users, >10,000 SMS/day).

## Tech Stack
- **Backend**: Python 3.12, Flask 3.x
- **Database**: PostgreSQL (production) / SQLite (development), auto-detected via DATABASE_URL
- **WSGI Server**: Gunicorn (multi-worker, production)
- **Reverse Proxy**: Nginx (static files, gzip, security headers)
- **Frontend**: Vanilla HTML/CSS/JS (SPA with hash routing)
- **Styling**: Custom CSS with Inter font, blue-white theme
- **Deployment**: Docker + docker-compose (PostgreSQL + Gunicorn + Nginx)

## Directory Structure
```
.
├── app.py                 # Main Flask application (all routes + DB abstraction)
├── requirements.txt       # Python dependencies
├── gunicorn.conf.py       # Gunicorn production config (multi-worker)
├── .coze                  # Sandbox configuration
├── .env.example           # Environment variables template
├── DESIGN.md              # Design tokens and guidelines
├── AGENTS.md              # This file
├── Dockerfile             # Docker image definition (Python + Gunicorn)
├── docker-compose.yml     # Docker compose (PostgreSQL + App + Nginx)
├── nginx/
│   └── nginx.conf         # Nginx reverse proxy config
├── static/
│   ├── css/style.css      # Application styles
│   └── js/
│       ├── app.js         # SPA frontend logic
│       └── mobile.js      # Capacitor/Web Contact Picker native bridge
├── templates/
│   └── index.html         # Main HTML template
├── mobile/                # Capacitor Android project
│   ├── capacitor.config.ts
│   ├── package.json
│   ├── scripts/sync-web.js
│   ├── scripts/patch-android.py
│   └── www/               # Generated web assets (not committed)
└── instance/              # SQLite database directory (dev mode only)
    └── sms_platform.db    # Database file (auto-created)
```

## Key Commands
- **Install deps**: `pip install -r requirements.txt`
- **Run dev (SQLite)**: `python app.py` (reads DEPLOY_RUN_PORT env var)
- **Run production (Gunicorn)**: `gunicorn -c gunicorn.conf.py app:app`
- **Docker build**: `docker build -t sms-platform .`
- **Docker run (full stack)**: `docker-compose up -d` (PostgreSQL + Gunicorn + Nginx)
- **Sync Android web assets**: `cd mobile && pnpm install && pnpm run sync:web`
- **Build Android APK**: set `SMS_SERVER_URL`, then `pnpm --dir mobile exec cap sync android && cd mobile/android && ./gradlew assembleDebug`

## API Endpoints
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /api/auth/login | Public | Login |
| POST | /api/auth/logout | Public | Logout |
| GET | /api/auth/me | User | Current user info |
| GET/POST | /api/users | Admin/TeamAdmin | List/Create users (role-based scope) |
| PUT/DELETE | /api/users/<id> | Admin/TeamAdmin | Update/Delete user (role-based scope) |
| GET/POST | /api/contacts | User | List/Create contacts (team: all, member: own) |
| PUT/DELETE | /api/contacts/<id> | User | Update/Delete contact (team: all, member: own) |
| POST | /api/contacts/import | User | Import CSV contacts |
| POST | /api/contacts/import-device | User | Batch-import contacts selected from Android address book |
| GET/POST | /api/groups | User | List/Create groups (team: all, member: own) |
| PUT/DELETE | /api/groups/<id> | User | Update/Delete group (team: all, member: own) |
| GET/POST | /api/templates | User | List/Create templates (shared across all users) |
| PUT/DELETE | /api/templates/<id> | User | Update/Delete template |
| POST | /api/sms/send | User | Send SMS (real API or simulation) |
| POST | /api/sms/schedule | User | Schedule SMS |
| GET | /api/sms/records | User | List send records (team: all, member: own) |
| GET | /api/sms/statistics | User | Dashboard stats (team: all, member: own) |
| POST | /api/sms/query-status | User | Query delivery status via API |
| POST | /api/sms/check-charset | User | Check charset/billing for content |
| POST | /api/sms/process-scheduled | User | Process scheduled messages |
| POST | /api/voice/call | User | Place outbound TTS voice call (电呼) |
| GET | /api/voice/records | User | List voice call records (team scoped) |
| GET | /api/voice/statistics | User | Voice call dashboard stats |
| POST | /api/voice/query-status | User | Refresh a call's live status from provider |
| GET/PUT | /api/config/voice | Admin | Voice config (provider simulation/infin8linx; per-country Infinity via ?country=) |
| POST | /api/config/voice/test | Admin | Test voice API credentials |
| GET | /api/admin/user-usage | Admin/TeamAdmin | Per-user usage statistics |
| GET/PUT | /api/config/sms | Admin | SMS API config (domain, spid, api_pwd, sender_name) |
| POST | /api/config/sms/test | Admin | Test API connection (charset check) |
| GET | /api/config/logs | Admin | Activity logs |

## Permission System (Three-Tier Roles)
| Role | Value | Can Create | Can Manage | Scope |
|------|-------|-----------|-----------|-------|
| Administrador del Sistema | `admin` | Team Admins only | All users, SMS config, logs | Full system |
| Administrador de Equipo | `team_admin` | Team Members only | Own team members | Team data (contacts, groups, SMS records) |
| Miembro de Equipo | `team_member` | None | Self only | Own data only |

### Key Rules
- System Admin creates Team Admin accounts (NOT Team Members)
- Team Admin creates Team Member accounts under their management (`team_creator_id`)
- Team Admin cannot create same-level or higher accounts
- Team Admin sees all team data; Team Member sees only their own data
- Templates are shared across all users regardless of role

## Voice Call Integration (电呼)
- Feature flag: voice_config.provider ∈ `simulation` | `infin8linx`. The UI exposes only these two; Infinity (infin8linx) is the only real provider (legacy twilio/custom values are still tolerated by the backend for stored rows but cannot be selected).
- Simulation is the default on new installs — no external calls, deterministic pseudo-outcomes for demos/tests.
- Infinity (infin8linx) is configured **per country**. Mexico, Colombia and Peru each have their own credentials and extension pool: `api_domain_mx/appid_mx/accesskey_mx/from_number_mx/ext_pool_mx/token_mx/token_mx_expiry` (`_co`, `_pe` analogues). The config UI uses a country dropdown and sends base keys (`api_domain`, `voice_appid`, `voice_accesskey`, `from_number`, `ext_pool`) plus `country=mx|co|pe`; `GET /api/config/voice?country=xx` maps that country's columns back onto the same base keys. AccessKey is write-only (GET returns `has_accesskey`); an empty secret on save preserves the stored one, and changing AppID/AccessKey invalidates that country's cached token. The 12h token is cached per country in DB and in-process; HTTP 600 forces a refresh.
- Infinity is SIP/extension click-to-call: form-data POST to the country's `api_domain` with `service=App.Sip_Auth.Login` + `appid` + `accesskey` to obtain a 12h `token`, then `service=App.Sip_Call.MakeCall` with `token`, `extnumber`, `destnumber`, optional `disnumber`. Returns a command ack only (no provider call id); a local `INF...` reference is generated. Live status is not exposed by this endpoint (CDR/callback only). When a call is placed, the agent's `users.country` (or the team default) selects which Infinity config/credentials and extension pool to use.
- Per-user fixed extension: the `users.extnumber` column holds an optional fixed SIP extension/phone for an agent, and `users.country` tags the agent as `mx` (Mexico), `co` (Colombia), `pe` (Peru), or empty (general). Extensions are **never entered manually**: when `assign_extension=true` is passed on user create/edit (or `assign_extensions=true` on bulk import/text), the system auto-picks a free one from that agent's country pool — `voice_config.ext_pool_mx` / `ext_pool_co` / `ext_pool_pe` (comma-separated) — and assigns it permanently. Users without a country use Mexico's pool by default (resolution order: agent country → team default country → mx). Changing a user's country does NOT reassign their current extension (release it first, then assign again). If no free extension exists for that country, the operation fails with HTTP 409 and an "ask the system admin to add more extensions" message. Bulk creation honors a per-row `pais` column as well as a default `country`; each country's free set is consumed first-come-first-served and duplicates are rejected. An assigned extension can be released via `release_extension=true` (returns to the pool). The agent's own `extnumber` is always used for Infinity calls; users without one are blocked (HTTP 403) when Infinity is configured (simulation mode still works). The extension actually used is recorded in `voice_records.extnumber`.
- Role scope mirrors SMS: team_member sees own calls, team_admin sees team calls, admin sees all.

## SMS API Integration (infin8linx)
- Provider: infin8linx SMS API
- Endpoints: /sms/send (single), /sms/rsend (batch), /sms/state (status), /sms/charset (encoding check)
- Auth: spid + MD5(spid + pwd + timestamp) + timestamp
- Content encoding: UCS2 hex for Spanish (70 chars/SMS, 67 for long SMS parts)
- Fallback: Simulation mode when API not configured

## Default Credentials
- System Admin: `admin` / `admin123`

## Database
Dual database support via `DBWrapper` abstraction layer:
- **Development**: SQLite with WAL mode (auto-created in `instance/`)
- **Production**: PostgreSQL 16 (via `DATABASE_URL` environment variable)
- Auto-detection: if `DATABASE_URL` starts with `postgresql://` → PostgreSQL, otherwise SQLite

Tables: users (with `extnumber` for per-agent fixed SIP extension and `country` mx/co/pe), contacts (with `app_name`, `amount`, `discount_amount`, `payment_link`), contact_groups, templates, sms_records (with msgid, api_code, api_msg for API tracking), sms_config (domain, spid, api_pwd, sender_name for infin8linx API), sms_api_configs (multi-country SMS configs), team_config, voice_config (provider/account_sid/auth_token/from_number/voice_appid/voice_accesskey/voice_extnumber/ext_pool_mx/ext_pool_co/ext_pool_pe), voice_records (phone/script/status/call_sid/extnumber/duration/price), send_logs.

### Contact fields
The `contacts` table carries both basic CRM and payment/collection fields:
- `name`, `phone`, `notes`, `remark` (status tag), `group_id`, `created_by`, `created_at`
- `app_name` (VARCHAR/TEXT, APP the contact belongs to)
- `amount` (NUMERIC(14,2)/REAL, owed/transaction amount)
- `discount_amount` (NUMERIC(14,2)/REAL, discount offered)
- `payment_link` (TEXT, collection/payment URL)

These fields are available in create/update/list, CSV import/export (columns `app_name, amount, discount_amount, payment_link` — optional, also accept `app, monto, descuento, link_pago/url_pago`), and as SMS/voice template variables: `{app_name}`, `{amount}`, `{discount}`, `{payment_link}` (plus `{nombre}`, `{telefono}`). Variable values are resolved per-recipient at send time via `build_contact_template_cache()` + `apply_template_vars()`. Money values render with two decimals.

## Production Deployment
```bash
# 1. Copy and configure environment
cp .env.example .env
# Edit .env with secure passwords

# 2. Start all services
docker-compose up -d

# Architecture: Nginx (port 80) → Gunicorn (4+ workers) → Flask App → PostgreSQL
```

### Resource Allocation (Large Team)
| Service | CPU | Memory | Description |
|---------|-----|--------|-------------|
| PostgreSQL | 1 core | 1GB | Database with persistent volume |
| App (Gunicorn) | 2 cores | 2GB | 4+ workers, auto-scaled to CPU count |
| Nginx | 0.5 core | 256MB | Reverse proxy, static files, gzip |

## Frontend Architecture
- SPA with hash-based routing (#/dashboard, #/contacts, etc.)
- No build step required
- Session-based auth with cookies
- Responsive design (mobile + desktop)
- Mobile CSS: drawer sidebar, card-style tables under 640px, bottom-sheet modals under 480px
- Android packaging: Capacitor 6 loads the production site through `server.url`; `static/js/mobile.js` exposes `window.MobileNative.getContacts()` backed by `@capacitor-community/contacts`, with Web Contact Picker API fallback
