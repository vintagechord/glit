FROM python:3.12.3-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends libreoffice-writer poppler-utils fonts-noto-cjk fonts-liberation && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir pillow pdf2image lxml python-docx
