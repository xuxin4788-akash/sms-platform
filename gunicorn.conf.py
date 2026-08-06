# Gunicorn configuration for production deployment
# Large team: 20+ users, >10,000 SMS/day

import multiprocessing
import os

# Server socket
bind = f"0.0.0.0:{os.environ.get('DEPLOY_RUN_PORT', '5000')}"
backlog = 2048

# Worker processes
workers = multiprocessing.cpu_count() * 2 + 1
worker_class = 'sync'
worker_connections = 1000
timeout = 120
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
