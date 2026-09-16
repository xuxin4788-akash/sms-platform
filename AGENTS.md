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
| GET | /api/sms/records | User | List send records (team: all, member: own) |
| GET | /api/sms/records/export | User | Download current filter as UTF-8-BOM CSV (same role scope + status/date/search filters; streamed in batches via a dedicated DB connection because the generator runs after request teardown; capped at SMS_EXPORT_MAX_ROWS=100000, X-Total-Rows/X-Exported-Rows/X-Export-Truncated headers) |
| GET | /api/sms/statistics | User | Dashboard stats (team: all, member: own) |
| POST | /api/sms/query-status | User | Query delivery status via API |
| POST | /api/sms/check-charset | User | Check charset/billing for content |
| POST | /api/sms/recompute-billing | Admin | Re-rate historical billed_segments under current language rule (chunked, idempotent) |
| GET | /l/<code> | Public | Short-link 302 redirect to the original payment/collection URL |
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
| GET | /api/config/email/providers | User | SMTP provider presets (Microsoft 365, Gmail, Amazon SES, Mailgun, SendGrid, Tencent, Aliyun, custom) |
| GET/POST | /api/config/email | Admin | SMTP config get/save (provider/host/port/use_ssl/use_tls/username/password/from_email/from_name; password write-only, empty on save preserves it) |
| POST | /api/config/email/test | Admin | Send a test email through SMTP (to `{to}` or the from address) |
| GET/POST | /api/config/email/senders | Admin | List per-APP sender mappings (+global default from_email) / create one (app_name unique, case-insensitive) |
| PUT/DELETE | /api/config/email/senders/<id> | Admin | Update/delete an APP→sender mapping |
| POST | /api/email/send | User | Enqueue a bulk email job to selected contacts or a group (only contacts with an email; same template vars as SMS; one `email_records` row per recipient with `job_id`; skips suppression list; simulates when SMTP is unconfigured). Returns `job_id` immediately |
| GET | /api/email/jobs/&lt;job_id&gt; | User | Bulk send job progress (owner/team/admin scoped; total/sent/failed/suppressed/progress/status) |
| GET | /api/email/records | User | List email records (team scoped; search/status[sent/simulated/failed/pending/suppressed]/date/pagination) |
| GET | /api/email/statistics | User | Email stats (total/sent/failed/pending/suppressed/success_rate/last_7_days/configured) |
| GET/POST | /api/email/suppressions | Admin | List/search or add a suppressed email (bounce/complaint/manual) |
| DELETE | /api/email/suppressions/&lt;id&gt; | Admin | Remove an address from the suppression list |
| POST | /api/email/inbound/sns | Public | SES Email-receiving SNS webhook (raw RFC-822 in `content`; auto base64-decodes when the SNS action uses Encoding=Base64; SubscriptionConfirmation + Notification); parses From/Subject/plain-or-HTML body, correlates to most recent outbound record by sender for owner scope, idempotent by Message-ID |
| GET | /api/email/replies | User | List inbound replies (role scope; search/sender/subject/body; `unread_only`; pagination; rows alias `received_at`/`body_text`) |
| POST | /api/email/replies/&lt;id&gt;/read | User | Mark a reply read (body `{read:true}`), same role scope enforced |
| POST | /api/email/sns/callback | Public | Amazon SES SNS webhook: subscription confirmation + Bounce/Complaint → suppression list + mark in-flight record failed |
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

## Email Integration (SMTP)
- Single-row `email_config`; provider presets (`EMAIL_PROVIDER_PRESETS`) prefill host/port/security: Microsoft 365 (smtp.office365.com:587 STARTTLS), Google Workspace (smtp.gmail.com:465 SSL), Amazon SES, Mailgun, SendGrid, Tencent Exmail, Aliyun Enterprise, and custom.
- Sending uses the Python stdlib `smtplib` + `EmailMessage`: `SMTP_SSL` for SSL (465), `SMTP`+`starttls()` for STARTTLS (587), plain SMTP otherwise. Messages are multipart (plain + simple styled HTML, newlines preserved). Password is write-only; an empty password on save keeps the stored secret.
- `is_email_configured()` requires host + username + password + from_email. When unconfigured, `POST /api/email/send` runs in simulation mode and writes `status='simulated'` (mirrors SMS/voice), returning `simulated:true`.
- Targets come from contacts or a group, restricted to rows with a syntactically valid unique email (`EMAIL_RE`), and obey the normal contact visibility scope. Subject and body resolve the same per-contact template variables as SMS (`{nombre}`, `{telefono}`, `{app_name}`, `{amount}`, `{discount}`, `{payment_link}`); links are NOT shortened in email (only SMS shortens).
- Records live in `email_records` with role scope identical to SMS (admin all / team_admin team / member own). The send/records/statistics endpoints use `@login_required` (NOT admin): `_email_scope_where(user)` applies the same admin/team/own visibility as SMS; only `/api/config/email*` stays `@admin_required`. `records` accepts a `status` filter (sent/simulated/failed/pending). Frontend pages: `#/email` (compose + stats), `#/email-records`, `#/email-config` (admin). The `email` and `email-records` pages are auto-granted to every non-admin role via `AUTO_GRANT_PAGES` in `/api/auth/me` (merged on top of any stored explicit permission set, so existing teams get the feature without an admin re-saving roles) and are included in `DEFAULT_ROLE_PERMISSIONS` and the JS no-permission fallback; `email-config` is never auto-granted. The statistics query aliases `email_records` AS `r` because the scope WHERE references `r.created_by` (using it without the alias raised "no such column: r.created_by" for team/member roles).
- Contacts carry an `email` column (create/update/CSV template/import with `email`/`correo`/`e-mail` headers).

### Per-APP sender addresses (remitente por APP)
- Different contacts belong to different APPs (`contacts.app_name`). An admin maps each APP name to its own mailbox in `email_app_senders` (id, app_name UNIQUE case-insensitive, from_email, from_name, is_active, timestamps), managed from a card on `#/email-config` via `GET/POST/PUT/DELETE /api/config/email/senders` (admin only; duplicate APP → 409, invalid email → 400).
- At enqueue, `resolve_app_sender(app_name, cfg)` picks the active mapping (trim/lower match) for the contact's APP; with no mapping (or an inactive/empty one) it falls back to the global `email_config.from_email/from_name`. Each `email_records` row stores the resolved `from_email` plus a snapshot of `app_name`, so the record/audit trail shows which mailbox sent it. Mapping is applied even in simulation mode so simulated rows preview the real mailbox.
- The queue worker sends each record through its stored `from_email`; the From **display name** is re-resolved from the current active mapping at drain time (`sender_names`), otherwise the global `from_name` (or none). `_build_email_message(cfg,to,subject,html,from_email=None,from_name=None)` accepts per-record overrides. `GET /api/email/records` (`r.*`) returns both new columns; the records page shows APP and Remitente columns.
- **Reply correlation** (`_store_email_reply`): the inbound reply's To (the mailbox the customer wrote back to) is matched against `email_records.from_email` **plus** the customer's From against `recipient_email`, so each reply pins the exact outbound record — and therefore the exact account (`created_by`) and APP mailbox that sent it. A recipient-only fallback keeps legacy/single-sender rows working. `GET /api/email/replies` LEFT JOINs `email_records` and `users` to surface `original_from_email`, `original_app_name` and `sent_by_username`.
- **SES requirement**: every APP mailbox (e.g. `cobranza@<app>.pagoserve.com`) must be a verified sender identity/address on the verified domain `pagoserve.com`, and inbound replies still arrive per the SES receiving rule; the SMTP credentials stay the same single SES SMTP user.

### Bulk email queue (Amazon SES scale, ~10k/day)
- Sending is **asynchronous**: `POST /api/email/send` only validates targets, applies the suppression list, writes one `email_records` row per recipient (`status='pending'`, `job_id`, `attempts`) and one `email_jobs` row, then returns `{job_id, queued, suppressed, total}` immediately. It never performs SMTP inside the HTTP request. Unconfigured SMTP still writes `status='simulated'` and a terminal job synchronously.
- Background drain: `email_queue_loop()` ticks every `EMAIL_QUEUE_POLL_SECONDS` (default 10) and calls `_process_email_queue_once()` (batches 200). A single Gunicorn worker drains at a time via PG advisory lock `EMAIL_QUEUE_LOCK_ID=73190452` (SQLite: a `maintenance_locks` row named `email_queue`, stale rows >10 min reclaimed). **The lock must always be released, including the early "SMTP not configured" return path** (an early `return 0` while holding the PG advisory lock permanently wedged the whole queue). It uses a `ThreadPoolExecutor` of `EMAIL_WORKERS` (default 4); each thread owns a `_PersistentSmtp` (one authenticated connection reused, transparent reconnect). Global pace is `EMAIL_RATE_PER_SEC` (default 12, within SES's ~14/s). Each message retries on transient errors up to `EMAIL_MAX_ATTEMPTS` (default 3, remains `pending` between tries), then `failed`; jobs roll up to `completed` / `completed_with_errors` / `processing`.
- **PostgreSQL row access in the queue/drain code MUST use column names (`rec['id']`, `agg['sent']`, `...fetchone()['n']`), never integer indexes**: PG uses `RealDictCursor` (dict-like rows, no positional index) whereas `sqlite3.Row` supports both, so `rec[0]`/`agg[0]` crashed only in production with `KeyError: 0`, leaving every message stuck at `pending`. Likewise build `IN (?,?,...)` with placeholders directly — never `"IN (%s)" % ','.join(['?']*n)`, because `DBWrapper` doubles literal `%` for PG. `email_jobs.status` is `VARCHAR(30)` because `completed_with_errors` is 21 chars (the old `VARCHAR(20)` truncated on PG). Email/SMS record JSON normalizes PG `datetime` columns to `YYYY-MM-DD HH:MM:SS` strings via `_row_with_dates()` so the SPA's `new Date(s.replace(' ','T'))` does not show "Invalid Date".
- New tables: `email_jobs` (job_id PK, status queued/processing/completed/completed_with_errors/failed, total/sent/failed/suppressed, simulated, created_by, timestamps) and `email_suppressions` (email UNIQUE, reason bounce/complaint/manual, detail, created_at). `email_records` gains `job_id` + `attempts` and the CHECK status widens to include `pending`/`suppressed` (PG: constraint drop/recreate in a DO block; SQLite: table rebuild migration). Indexes on `(job_id)`, `(status)`, `(created_by, created_at)`.
- Progress: `GET /api/email/jobs/<job_id>` (`@login_required`, owner/team/admin scoped) returns counters + `processed` + `progress` %. The SPA polls it every 4 s after enqueue and toasts live progress; `email-records` gained `Pendiente`/`Suprimido` filters/badges.
- SES delivery feedback: public `POST /api/email/sns/callback` handles SNS `SubscriptionConfirmation` (follows the HTTPS SubscribeURL) and Bounce/Complaint `Notification`s, upserting recipients into `email_suppressions` and flipping their in-flight `sent` record to `failed`. Addresses on the list are skipped (recorded `suppressed`, not failed) at enqueue. Admins manage the list via `GET/POST /api/email/suppressions` and `DELETE /api/email/suppressions/<id>` (`@admin_required`). Point an SES SNS topic (bounce + complaint) at `https://<host>/api/email/sns/callback`.
- SES sending identity: verify the **root domain `pagoserve.com`** in SES (no subdomain) and configure SPF/DKIM/DMARC on it; the mailbox/local-part is the APP name, so the from address is **`app@pagoserve.com`** (set it as `from_email` in the SMTP config; SES does not require a mailbox to actually exist, only a verified domain). SES SMTP endpoint already preset (`email-smtp.us-east-1.amazonaws.com:587 STARTTLS`); the SNS webhook URL stays `https://pagoserve.com/api/email/sns/callback`.


## SMS API Integration (infin8linx)
- Provider: infin8linx SMS API
- Endpoints: /sms/send (single), /sms/rsend (batch), /sms/state (status), /sms/charset (encoding check)
- Auth: spid + MD5(spid + pwd + timestamp) + timestamp
- Content encoding: UCS2 hex for non-GSM content; the web UI transliterates Spanish to plain ASCII so messages stay in the GSM charset on the wire.
- GSM-only enforcement is authoritative on the SERVER, not just the browser: `normalize_sms_text()` (NFC-compose, then `_SMS_ASCII_MAP` transliteration of accents/Spanish glyphs to ASCII, then drop any remaining non-ASCII) is applied in `send_sms` to the base content before the length check AND to each final per-recipient message via `build_sms_message()` (after `apply_template_vars`, since contact values like `{nombre}` can reintroduce accents). This closes the bypass where the mobile/Capacitor app, a direct API call, or a decomposed (NFD) accent could deliver accented/UCS-2 text. The front-end `normalizeSmsText()` mirrors the same map and also NFC-composes. **Billing class is rated on the ORIGINAL pre-normalization text** via `build_sms_message_raw(raw_content, ...)` per recipient at every INSERT (the normalized `msg` would otherwise never show Spanish marks), while the delivered wire text stays ASCII. `/api/sms/check-charset` reports the normalized GSM length but the original-text language class.
- Commercial billing rule (`sms_billing_class` / `sms_billing_segments`, mirrored in the JS `smsBillingClass` / `localSmsParts`): plain Latin / English / Indonesian / **ASCII-only Spanish** -> 160 chars/SMS (153 per concat part); Chinese (any CJK) -> 70; **Spanish ONLY when the original text contains Spanish-specific glyphs** — accented vowels (á é í ó ú), ü/ü, ñ/Ñ, or inverted ¿/¡ -> 70 chars/SMS (67 per concat part); Chinese+Latin mixed -> 70. Keyword-based Spanish detection was removed per product decision: words alone (cliente, pago, deuda, etc.) no longer trigger the 70 rate, so an all-ASCII 110-char collection SMS bills as 1 part, while the same text written with real accents bills under 70/67. Detection NFC-composes so decomposed (NFD) combining accents still count. This is the reseller billing view and intentionally differs from the carrier's raw GSM/UCS2 segment accounting. Each SMS's parts are stored in `sms_records.billed_segments` (computed once at send time via the INSERT paths from `build_sms_message_raw`, default 1, with a one-time historical backfill on migration), so dashboards aggregate with `SUM(billed_segments)` instead of re-running the language rule per request. A composite index `(created_by, billed_segments)` backs these sums. Historical rows follow the current rule too: `recompute_billed_segments_batch(max_records, last_id)` keyset-paginates over `sms_records`, re-rates the stored (already ASCII-normalized) content, and UPDATEs only rows whose segments change — idempotent. Admin-only `POST /api/sms/recompute-billing` body `{max_records (default 50000, clamp 1..100000), last_id}` returns `{scanned,changed,next_last_id,remaining,total_rows,done,...}`; the dashboard "Recalcular facturacion" button loops chunks until `done` and invalidates the stats cache each chunk.
- Billing is charged **per segment** (not per record): `sms_segments_for_scope()` / `sms_segment_breakdown()` / `sms_segment_breakdown_grouped()` re-rate every message with the rule above; `sms_cost_for_scope()` multiplies each account's segments by its country unit price. **All segment/cost aggregates exclude simulated sends** (`COALESCE(api_msg,'') NOT LIKE '%simulado%'`), so billing matches the carrier reconciliation panel; otherwise pre-configuration/test simulated sends would inflate billed segment and cost totals. Callers that pass an OR-bearing status condition must parenthesize it (`_scope_cost` wraps `status_filter` in `(...)`) and `sms_segments_for_scope` wraps the whole scope in `(...)`, otherwise `OR` would widen the predicate across the AND chain and leak rows. `/api/admin/unified-stats` (my account / my team / all teams) and `/api/admin/user-usage` expose `billed_segments` / `sent_segments` / `failed_segments` and segment-based `total_cost`; the Excel export has an "SMS facturados (segmentos)" column. The SMS count columns (`total`/`sent`/`failed`) remain record/row counts.
- Fallback: Simulation mode when API not configured
- Delivery reconciliation: send accept (api_code=0) writes status `sent` (=submitted/in-flight). A background worker (`sms_dr_loop`, every 5 min, cross-worker lease, 72h window, per-channel grouping) polls `/sms/state` and applies reports via `apply_delivery_reports()`: state 1 -> `delivered` (+delivered_at), state 2 -> `failed`, state 0 stays `sent`. Simulation is skipped. The provider's `/sms/state` accepts ≤100 msgids per call.
- Historical DR backfill (fixes the misleading 0.8% delivery rate): the windowed worker only touches records `sent_at >= now-72h`, so older still-`sent` rows never get a report and inflate `in_flight`, dragging `delivery_rate = delivered/submitted` down. Admin can drain the backlog with `POST /api/sms/dr-sync` body `{"backfill":true, "max_records":20000}` — it queries per-channel in ≤100-chunks ALL lingering `sent` rows (no window), applies their final states, and returns `{checked, delivered, failed, pending}`; repeat until `pending` hits 0 (dashboard button "Reconciliar historico"). `max_records` caps a single run (default 800, clamp 1..100000). Cache is invalidated after each run.
- Carrier-aligned stats: GET /api/sms/statistics returns a `reconciliation` block (submitted/delivered/in_flight/rejected/simulated, `billing_parts` using the commercial language rule, delivery_rate, by-day series), excluding simulated sends. The report day boundary follows `report_tz` (`carrier`=UTC+8 default matching the Rileci Excel, `local`=Mexico UTC-6, `utc`); sms_records carry api_config_id (channel).
- Single source of truth for the dashboard: the legacy top KPI cards (`today_sent`, `total_sent`, `total_pending`, `total_failed`, `success_rate`, `last_7_days`) are computed from the SAME reconciliation basis as the `reconciliation` panel via `_sms_reconciliation_block` + `_recon_scope_sql/_recon_scope_params` — accepted=api_code 0 non-simulated, in-flight=status sent, rejected=api_code<>0, rate=delivered/submitted. They must never use the old per-status COUNT formulas (which counted only status='sent', dropped delivered rows, and produced a contradictory in-flight/all "success" rate). No date filter ⇒ first card is accepted today in report TZ and totals are all-time; date/account filter ⇒ first card is accepted in that range. `total_contacts` is role-scoped (member: own, team_admin: team, admin: all); `total_templates` stays global. JS renders the cards as Aceptados Hoy / Tasa de Entrega / En Proceso / Rechazados to mirror the panel.

## Default Credentials
- System Admin: `admin` / `admin123`

## Database
Dual database support via `DBWrapper` abstraction layer:
- **Development**: SQLite with WAL mode (auto-created in `instance/`)
- **Production**: PostgreSQL 16 (via `DATABASE_URL` environment variable)
- Auto-detection: if `DATABASE_URL` starts with `postgresql://` → PostgreSQL, otherwise SQLite
- **Placeholder rule (CRITICAL)**: all SQL passed to `DBWrapper.execute` MUST use `?` placeholders (never raw `%s`) — the wrapper converts them to `%s` for psycopg2. Before conversion it doubles literal `%` to `%%`, so inline `LIKE '%word%'` or modulo are safe; this fixed a PG-only `IndexError: tuple index out of range` caused by `'%simulado%'` containing a `%s` sequence (SQLite ignores `%`, so it only surfaced in production). `CursorWrapper.rowcount` is exposed for bulk UPDATE counting. Raw migration cursors (`self.conn.cursor()`) still use native `%s` and bypass this translation.

Tables: users (with `category_id` FK to user_categories, `extnumber` for per-agent fixed SIP extension and `country` mx/co/pe), user_categories (id/name UNIQUE/retention_days/is_default/created_at/updated_at — classifies employees and defines how many days their contacts are kept; 0 = forever; seeded with a "General" default), contacts (with `app_name`, `amount`, `discount_amount`, `payment_link`, `email`), contact_groups, templates, sms_records (with msgid, api_code, api_msg for API tracking), sms_config (domain, spid, api_pwd, sender_name for infin8linx API), sms_api_configs (multi-country SMS configs, one row per country), team_config, email_config (single-row SMTP: provider/host/port/use_ssl/use_tls/username/password/from_email/from_name/is_active), email_app_senders (id/app_name UNIQUE/from_email/from_name/is_active — per-APP sender mailbox override, fallback to email_config.from_email), email_records (recipient_email/contact_name/subject/body/from_email/app_name/status[pending|sent|failed|simulated|suppressed]/error_msg/job_id/attempts/created_by/sent_at), voice_config (legacy single-row table retained for migration/backward compatibility), voice_configs (multi-country Infinity voice configs, one row per country — mirrors sms_api_configs; columns id/name/country/provider/api_domain/voice_appid/voice_accesskey/from_number/dest_prefix/voice_scheme/voice_token/voice_token_expiry/is_active/updated_at), voice_records (phone/script/status/call_sid/extnumber/duration/price), extensions (extnumber+country unique, assigned_to FK users; the authoritative extension catalog managed from the Extensiones page, seeded once from legacy ext_pool_* strings), send_logs.

### Contact retention (replaces the old full daily wipe)
- Employees are classified via `user_categories`; each category has `retention_days` (0 = keep forever).
- The daily background job (`run_auto_clear_contacts`, scheduled at `auto_clear_time`, default 03:00) deletes expired contacts. Rules: (a) owning user belongs to a category with `retention_days > 0` → delete when `created_at < now - retention_days`; (b) owning user has NO category (`category_id` NULL) → delete when older than `UNCATEGORIZED_RETENTION_DAYS` (= 1 day); (c) a category with `retention_days = 0` means keep forever; (d) contacts without a creator (`created_by` NULL) are never deleted. Groups are never deleted. Implemented in PG with two `EXISTS` deletes and in SQLite via an `id IN (SELECT ...)` subquery (SQLite forbids an alias on the DELETE target). This replaces the previous behavior that deleted ALL contacts and groups every day.
- The same rule runs on-demand via POST /api/config/auto-clear/run-now and is configured on the "Retencion de Contactos" admin page.
- `users.category_id` is set on create/update (admin-managed); if omitted it defaults to the default category. Users without a category retain contacts permanently.

### Stats panel caching (15 minutes)
- Read-only aggregate endpoints are cached for 15 minutes to save resources at scale: `/api/sms/statistics`, `/api/admin/unified-stats`, `/api/admin/user-usage`, `/api/voice/statistics`, `/api/email/statistics`.
- Cache lives in the `stats_cache` table (`cache_key` PK, `payload` JSON, `expires_at` epoch seconds) so it is shared across all Gunicorn workers. The decorator `@stats_cache_namespace('<name>')` wraps a view; key = namespace + user id + role + sorted query string, so per-user/role/filter results never leak. Payloads gain `cached` and `cache_ttl_minutes` markers.
- `?refresh=1` bypasses and repopulates a single key. `invalidate_stats_cache()` clears everything and is called after a forced DR sync and after changing the SMS unit price.
- List/CRUD endpoints (contacts, groups, templates, SMS/voice/email **records** management, imports, sends) are NOT cached and always return real-time data — only the Contactos panel requirement: contacts stay live.

- Employee categories are **shared across all teams** (not per-team): both system admins and team admins can create/edit/delete them (POST/PUT/DELETE `/api/user-categories` use `@manager_required`). The daily auto-clear schedule (`/api/config/auto-clear`, run-now) remains system-admin only; team admins see the Retención page without the scheduler card.


### Contact fields
The `contacts` table carries both basic CRM and payment/collection fields:
- `name`, `phone`, `email`, `notes`, `remark` (status tag), `group_id`, `created_by`, `created_at`
- `app_name` (VARCHAR/TEXT, APP the contact belongs to)
- `amount` (NUMERIC(14,2)/REAL, owed/transaction amount)
- `discount_amount` (NUMERIC(14,2)/REAL, discount offered)
- `payment_link` (TEXT, collection/payment URL)

These fields are available in create/update/list, CSV import/export (columns `app_name, amount, discount_amount, payment_link` — optional, also accept `app, monto, descuento, link_pago/url_pago`), and as SMS/voice template variables: `{app_name}`, `{amount}`, `{discount}`, `{payment_link}` (plus `{nombre}`, `{telefono}`). Variable values are resolved per-recipient at send time via `build_contact_template_cache()` + `apply_template_vars()`. Money values render with two decimals.

### Short links
The `{payment_link}` value sent in **SMS** is automatically shortened: the first time a given long http(s) URL is used, a row is created in `short_links` (code, original_url, hit_count, last_hit_at) and the message gets `<base>/l/<code>` (e.g. `http://host/l/xM57tNPp`); the same long URL always reuses its code. The public `GET /l/<code>` route 302-redirects to the original URL (http/https only) and increments the click counter. The base is `SHORT_LINK_BASE_URL` env var if set, else the request's host (`request.host_url`) — set the env var to a public HTTPS domain so recipients can open it. Voice/TTS messages are not shortened (they don't consume SMS characters). Existing stored `payment_link` values are untouched; shortening happens only at send time.

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
