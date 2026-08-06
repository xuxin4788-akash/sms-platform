FROM python:3.12-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application
COPY . .

# Create instance directory for SQLite (dev mode)
RUN mkdir -p /app/instance

EXPOSE 5000

ENV DEPLOY_RUN_PORT=5000
ENV FLASK_ENV=production

# Use gunicorn for production
CMD ["gunicorn", "-c", "gunicorn.conf.py", "app:app"]
