FROM python:3.12-slim

# Non-root user for security best practice
RUN groupadd -r appuser && useradd -r -g appuser appuser

WORKDIR /app

# Install dependencies first (better layer caching)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Drop root privileges
RUN chown -R appuser:appuser /app
USER appuser

# Cloud Run / Kubernetes both inject $PORT; default to 8080 for local docker run
ENV PORT=8080
EXPOSE 8080

# Healthcheck matches /healthz in main.py
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:${PORT}/healthz')" || exit 1

CMD exec uvicorn main:app --host 0.0.0.0 --port ${PORT}