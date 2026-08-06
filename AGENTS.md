# AGENTS.md - SMS Marketing Platform

## Project Overview
A team-oriented SMS marketing management platform with Spanish (es) UI. Built with Python Flask + SQLite + vanilla HTML/CSS/JS SPA.

## Tech Stack
- **Backend**: Python 3.12, Flask 3.x, SQLite
- **Frontend**: Vanilla HTML/CSS/JS (SPA with hash routing)
- **Styling**: Custom CSS with Inter font, blue-white theme
- **Deployment**: Docker + docker-compose

## Directory Structure
```
.
├── app.py                 # Main Flask application (all routes + DB)
├── requirements.txt       # Python dependencies
├── .coze                  # Sandbox configuration
├── DESIGN.md              # Design tokens and guidelines
├── AGENTS.md              # This file
├── Dockerfile             # Docker image definition
├── docker-compose.yml     # Docker compose for deployment
├── static/
│   ├── css/style.css      # Application styles
│   └── js/app.js          # SPA frontend logic
├── templates/
│   └── index.html         # Main HTML template
└── instance/              # SQLite database directory
    └── sms_platform.db    # Database file (auto-created)
```

## Key Commands
- **Install deps**: `pip install -r requirements.txt`
- **Run dev**: `python app.py` (reads DEPLOY_RUN_PORT env var)
- **Docker build**: `docker build -t sms-platform .`
- **Docker run**: `docker-compose up -d`

## API Endpoints
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /api/auth/login | Public | Login |
| POST | /api/auth/logout | Public | Logout |
| GET | /api/auth/me | User | Current user info |
| GET/POST | /api/users | Admin | List/Create users |
| PUT/DELETE | /api/users/<id> | Admin | Update/Delete user |
| GET/POST | /api/contacts | User | List/Create contacts |
| PUT/DELETE | /api/contacts/<id> | User | Update/Delete contact |
| POST | /api/contacts/import | User | Import CSV contacts |
| GET/POST | /api/groups | User | List/Create groups |
| PUT/DELETE | /api/groups/<id> | User | Update/Delete group |
| GET/POST | /api/templates | User | List/Create templates |
| PUT/DELETE | /api/templates/<id> | User | Update/Delete template |
| POST | /api/sms/send | User | Send SMS (real API or simulation) |
| POST | /api/sms/schedule | User | Schedule SMS |
| GET | /api/sms/records | User | List send records |
| GET | /api/sms/statistics | User | Dashboard stats |
| POST | /api/sms/query-status | User | Query delivery status via API |
| POST | /api/sms/check-charset | User | Check charset/billing for content |
| POST | /api/sms/process-scheduled | User | Process scheduled messages |
| GET/PUT | /api/config/sms | Admin | SMS API config (domain, spid, api_pwd, sender_name) |
| POST | /api/config/sms/test | Admin | Test API connection (charset check) |
| GET | /api/config/logs | Admin | Activity logs |

## SMS API Integration (infin8linx)
- Provider: infin8linx SMS API
- Endpoints: /sms/send (single), /sms/rsend (batch), /sms/state (status), /sms/charset (encoding check)
- Auth: spid + MD5(spid + pwd + timestamp) + timestamp
- Content encoding: UCS2 hex for Spanish (70 chars/SMS, 67 for long SMS parts)
- Fallback: Simulation mode when API not configured

## Default Credentials
- Admin: `admin` / `admin123`

## Database
SQLite with WAL mode. Tables: users, contacts, contact_groups, templates, sms_records (with msgid, api_code, api_msg for API tracking), sms_config (domain, spid, api_pwd, sender_name for infin8linx API), send_logs.

## Frontend Architecture
- SPA with hash-based routing (#/dashboard, #/contacts, etc.)
- No build step required
- Session-based auth with cookies
- Responsive design (mobile + desktop)
