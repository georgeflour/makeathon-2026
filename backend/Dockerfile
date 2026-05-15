FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Ensure the DuckDB data file is present
RUN test -f app/data/conversations.duckdb || (echo "ERROR: conversations.duckdb not found in app/data/" && exit 1)

ENV PYTHONUNBUFFERED=1
ENV DUCKDB_PATH=app/data/conversations.duckdb

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
