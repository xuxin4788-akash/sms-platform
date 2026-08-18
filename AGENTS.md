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
| GET | /api/user-categories | User | List employee categories + retention days (counts for managers) |
| POST/PUT/DELETE | /api/user-categories[/<id>] | Admin/TeamAdmin | CRUD employee categories (default category cannot be deleted; categories are shared across teams) |
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
| POST | /api/voice/hangup | User | Hang up an active Infinity call on the record's extension |
| GET | /api/voice/records | User | List voice call records (team scoped) |
| GET | /api/voice/statistics | User | Voice call dashboard stats |
| POST | /api/voice/query-status | User | Refresh a call's live status from provider |
| POST | /api/voice/cdr | Public | Infinity CDR push callback; correlates by customuuid, updates status/duration/hangupcause/recording |
| GET | /api/voice/recording?id= | User | Resolve a short-lived Infinity recording download URL for a voice record |
| GET/POST | /api/config/voice | Admin | List all per-country voice configs / create one (country unique) |
| PUT/DELETE | /api/config/voice/<id> | Admin | Update/delete a per-country voice config (AccessKey write-only) |
| POST | /api/config/voice/test | Admin | Test Infinity credentials (body `{config_id}` or `{country}`) |
| GET/POST | /api/extensions | Admin | List/add SIP extensions per country (?country=); bulk-upload comma/newline separated |
| DELETE | /api/extensions/<id> | Admin | Delete a single extension (only when free/unassigned) |
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
- Feature flag: voice_configs.provider ∈ `simulation` | `infin8linx`. The UI exposes only these two; Infinity (infin8linx) is the only real provider.
- Simulation is the default on new installs — no external calls, deterministic pseudo-outcomes for demos/tests.
- Infinity (infin8linx) is configured **per country**, using the same multi-row pattern as `sms_api_configs`: one `voice_configs` row per country (Mexico/Colombia/Peru) with columns `id, name, country UNIQUE, provider, api_domain, voice_appid, voice_accesskey, from_number, dest_prefix, voice_scheme, voice_token, voice_token_expiry BIGINT, is_active, updated_at`. Full CRUD: `GET /api/config/voice` returns `{configs:[...]}`, `POST` creates a row (country must be unique, 409 on conflict), `PUT /api/config/voice/<id>` updates it, `DELETE /api/config/voice/<id>` removes it. AccessKey is write-only (GET returns `has_accesskey`); an empty secret on PUT preserves the stored one. The provider is auto-detected on save: when `api_domain` + `voice_appid` + `voice_accesskey` are all present it becomes `infin8linx`, otherwise `simulation` (mirroring the SMS "no credentials → simulation" behavior). Changing AppID/AccessKey invalidates that config's cached token. The 12h token is cached per config id in DB and in-process; HTTP 600 forces a refresh. `resolve_voice_config(country)` selects the row for the agent's country (fallback: first active row). `POST /api/config/voice/test` accepts `{config_id}` or `{country}`. `dest_prefix` is a digits-only outbound dial-plan prefix prepended to each `destnumber` (the config's own country code is stripped first to avoid doubling); e.g. Mexico mobile uses `521`, landline/trunk uses `52`/empty. Use it when Infinity rejects calls with "destnumber no coincide". `voice_scheme` records whether the endpoint answered over plain http or https (auto-detected/probed, persisted).
- Infinity is SIP/extension click-to-call: form-data POST to the row's `api_domain` with `service=App.Sip_Auth.Login` + `appid` + `accesskey` to obtain a 12h `token`, then `service=App.Sip_Call.MakeCall` with `token`, `extnumber`, `destnumber`, optional `disnumber`. Returns a command ack only (no provider call id); a local `INF...` reference is generated. Live status is not exposed by this endpoint (CDR/callback only). When a call is placed, the agent's `users.country` (or the team default) selects which Infinity config/credentials to use.
- Infinity is SIP/extension click-to-call: form-data POST to the country's `api_domain` with `service=App.Sip_Auth.Login` + `appid` + `accesskey` to obtain a 12h `token`, then `service=App.Sip_Call.MakeCall` with `token`, `extnumber`, `destnumber`, optional `disnumber`. Returns a command ack only (no provider call id); a local `INF...` reference is generated. Live status is not exposed by this endpoint (CDR/callback only). When a call is placed, the agent's `users.country` (or the team default) selects which Infinity config/credentials and extension pool to use.
- Per-user fixed extension: the `users.extnumber` column holds an optional fixed SIP extension/phone for an agent, and `users.country` tags the agent as `mx` (Mexico), `co` (Colombia), `pe` (Peru), or empty (general). Extensions are **never entered manually**: they are managed in the authoritative `extensions` table (extnumber+country unique, `assigned_to` FK to users) via the standalone Extensiones page (`GET/POST/DELETE /api/extensions`, bulk-upload comma/newline separated). When `assign_extension=true` is passed on user create/edit (or `assign_extensions=true` on bulk import/text), the system auto-picks a free one from that agent's country pool and assigns it permanently. Users without a country use Mexico's pool by default (resolution order: agent country → team default country → mx). Changing a user's country does NOT reassign their current extension (release it first, then assign again). If no free extension exists for that country, the operation fails with HTTP 409 and an "ask the system admin to add more extensions" message. Bulk creation honors a per-row `pais` column as well as a default `country`; each country's free set is consumed first-come-first-served and duplicates are rejected. An assigned extension can be released via `release_extension=true` (returns to the pool). The agent's own `extnumber` is always used for Infinity calls; users without one are blocked (HTTP 403) when Infinity is configured (simulation mode still works). The extension actually used is recorded in `voice_records.extnumber`.
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

Tables: users (with `category_id` FK to user_categories, `extnumber` for per-agent fixed SIP extension and `country` mx/co/pe), user_categories (id/name UNIQUE/retention_days/is_default/created_at/updated_at — classifies employees and defines how many days their contacts are kept; 0 = forever; seeded with a "General" default), contacts (with `app_name`, `amount`, `discount_amount`, `payment_link`), contact_groups, templates, sms_records (with msgid, api_code, api_msg for API tracking), sms_config (domain, spid, api_pwd, sender_name for infin8linx API), sms_api_configs (multi-country SMS configs, one row per country), team_config, voice_config (legacy single-row table retained for migration/backward compatibility), voice_configs (multi-country Infinity voice configs, one row per country — mirrors sms_api_configs; columns id/name/country/provider/api_domain/voice_appid/voice_accesskey/from_number/dest_prefix/voice_scheme/voice_token/voice_token_expiry/is_active/updated_at), voice_records (phone/script/status/call_sid/extnumber/duration/price), extensions (extnumber+country unique, assigned_to FK users; the authoritative extension catalog managed from the Extensiones page, seeded once from legacy ext_pool_* strings), send_logs.

### Contact retention (replaces the old full daily wipe)
- Employees are classified via `user_categories`; each category has `retention_days` (0 = keep forever).
- The daily background job (`run_auto_clear_contacts`, scheduled at `auto_clear_time`, default 03:00) deletes ONLY contacts whose owning user belongs to a category with a finite window AND whose `created_at` is older than `now - retention_days`. Contacts without a creator or whose creator has no category are never deleted, and groups are never deleted. This replaces the previous behavior that deleted ALL contacts and groups every day.
- The same rule runs on-demand via POST /api/config/auto-clear/run-now and is configured on the "Retencion de Contactos" admin page.
- `users.category_id` is set on create/update (admin-managed); if omitted it defaults to the default category. Users without a category retain contacts permanently.
- Employee categories are **shared across all teams** (not per-team): both system admins and team admins can create/edit/delete them (POST/PUT/DELETE `/api/user-categories` use `@manager_required`). The daily auto-clear schedule (`/api/config/auto-clear`, run-now) remains system-admin only; team admins see the Retención page without the scheduler card.


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
