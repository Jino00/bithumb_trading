FROM python:3.13-slim

WORKDIR /app

# System dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Application code
COPY . .

# Create log/db directories
RUN mkdir -p logger

# Default: run bot in paper trading mode
CMD ["python", "main.py", "--paper"]
