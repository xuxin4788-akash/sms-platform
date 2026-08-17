# Gunicorn configuration for production deployment
# Large team: 20+ users, >10,000 SMS/day

import multiprocessing
import os

# Server socket
bind = f"0.0.0.0:{os.environ.get('DEPLOY_RUN_PORT', '5000')}"
backlog = 2048

# Worker processes
# Allow override via GUNICORN_WORKERS for small/test servers. Default keeps the
# production formula (2 * CPU + 1) for large multi-core boxes.
workers = int(os.environ.get('GUNICORN_WORKERS') or (multiprocessing.cpu_count() * 2 + 1))
worker_class = 'sync'
worker_connections = 1000
# Threads only matter for async/gthread worker classes; keep 1 for sync but allow
# override if a future worker class needs it.
threads = int(os.environ.get('GUNICORN_THREADS') or 1)
timeout = int(os.environ.get('GUNICORN_TIMEOUT') or 120)
keepalive = 5

# Worker recycling (prevent memory leaks)
max_requests = 1000
max_requests_jitter = 50

# Logging
accesslog = '-'
errorlog = '-'
loglevel = 'info'
access_log_format = '%(h)s %(l)s %(u)s %(t)s "%(r)s" %(s)s %(b)s "%(f)s" "%(a)s" %(D)sms'

# Process naming
proc_name = 'sms-platform'

# Security
limit_request_line = 8190
limit_request_fields = 100
limit_request_field_size = 8190

# Graceful shutdown
graceful_timeout = 30
