FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-venv antiword libreoffice-writer poppler-utils \
    tesseract-ocr tesseract-ocr-kor tesseract-ocr-eng tesseract-ocr-jpn \
    fonts-noto-cjk fonts-liberation ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY services/review-docs/requirements.txt /app/services/review-docs/requirements.txt
RUN python3 -m venv /opt/review-venv && /opt/review-venv/bin/pip install --no-cache-dir -r /app/services/review-docs/requirements.txt
COPY tsconfig.json ./
COPY src ./src
COPY scripts/review-docs ./scripts/review-docs
COPY templates/review-docs ./templates/review-docs
COPY services/review-docs ./services/review-docs
ENV PATH="/opt/review-venv/bin:$PATH" NODE_ENV=production REVIEW_DOCS_PYTHON=/opt/review-venv/bin/python
USER node
CMD ["npm", "run", "review-docs:worker"]
