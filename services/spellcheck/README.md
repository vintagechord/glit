# Onside Spellcheck Microservice

FastAPI wrapper around `py-hanspell` that chunks long text and returns a simple correction payload.

## Local development

```bash
cd services/spellcheck
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
```

- Environment variables:
  - `ALLOWED_ORIGINS`: Comma-separated origins allowed by CORS (e.g. `https://glit-b1yn.onrender.com`).
  - `SPELLCHECK_SHARED_SECRET`: Optional shared secret; requests must include `x-spellcheck-secret` header when set.
  - `SPELLCHECK_MAX_CHUNK` (default `450`), `SPELLCHECK_MAX_TEXT` (default `20000`), `SPELLCHECK_TIMEOUT_SECONDS` (default `8`).

Test with curl:

```bash
curl -X POST http://localhost:8000/spellcheck \
  -H "Content-Type: application/json" \
  -d '{"text":"안되 겠지만 시도해본다"}'
```

- Quick checks:
  - 긴 문장/줄바꿈: `curl -X POST http://localhost:8000/spellcheck -H "Content-Type: application/json" -d '{"text":"첫 줄은 테스트입니다.\n두번째 줄에는 맞춤법이 안맞아요...세번째줄도 확인해봐요"}'`
  - 욕설 포함: `curl -X POST http://localhost:8000/spellcheck -H "Content-Type: application/json" -d '{"text":"이런 젠장, 안돼겠지만 해본다"}'`
  - 정상 문장: `curl -X POST http://localhost:8000/spellcheck -H "Content-Type: application/json" -d '{"text":"오늘은 날씨가 좋습니다. 산책을 나갑니다."}'`

## Deploying to Render (Web Service)

- Root: `services/spellcheck`
- Build command: `pip install -r requirements.txt`
- Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
- Environment:
  - `ALLOWED_ORIGINS=https://glit-b1yn.onrender.com,https://<custom-domain>`
  - `SPELLCHECK_SHARED_SECRET=<shared-secret>`
  - (optional) tune `SPELLCHECK_MAX_CHUNK`, `SPELLCHECK_MAX_TEXT`, `SPELLCHECK_TIMEOUT_SECONDS`

Expose the resulting URL as `SPELLCHECK_SERVICE_URL` in the Next.js app.
