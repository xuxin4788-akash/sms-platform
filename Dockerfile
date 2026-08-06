FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p /app/instance

EXPOSE 5000

ENV DEPLOY_RUN_PORT=5000

CMD ["sh", "-c", "python app.py"]
