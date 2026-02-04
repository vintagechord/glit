import asyncio
import logging
import os
import re
from typing import List, Tuple

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
try:
    from hanspell import spell_checker
except ModuleNotFoundError:  # pragma: no cover - fallback for py-hanspell-aideer
    from py_hanspell_aideer import spell_checker

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("spellcheck")

MAX_CHUNK_LENGTH = int(os.getenv("SPELLCHECK_MAX_CHUNK", "450"))
MAX_TEXT_LENGTH = int(os.getenv("SPELLCHECK_MAX_TEXT", "20000"))
CHECK_TIMEOUT_SECONDS = float(os.getenv("SPELLCHECK_TIMEOUT_SECONDS", "8"))
BOUNDARY_SUFFIXES = ("다", "요", "함", "음", "임", "죠")
BOUNDARY_CHARS = {".", "?", "!", "…", "\n"}

SHARED_SECRET = os.getenv("SPELLCHECK_SHARED_SECRET")

allowed_origins = [
    origin.strip()
    for origin in os.getenv("ALLOWED_ORIGINS", "").split(",")
    if origin.strip()
]

app = FastAPI(title="Onside Spellcheck", version="0.1.0")

if allowed_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=True,
        allow_methods=["POST", "OPTIONS"],
        allow_headers=["*"],
    )


class SpellcheckPayload(BaseModel):
    text: str


class SpellcheckResponse(BaseModel):
    ok: bool
    original: str
    corrected: str
    diffCount: int
    chunks: int
    warnings: List[str]
    suggestions: List[dict] = Field(default_factory=list)


def build_chunks(text: str, max_length: int) -> List[Tuple[int, int, str]]:
    if len(text) <= max_length:
        return [(0, len(text), text)]

    chunks: List[Tuple[int, int, str]] = []
    start = 0
    last_boundary = 0

    for idx, char in enumerate(text):
        if char in BOUNDARY_CHARS:
            last_boundary = idx + 1
        elif char.isspace():
            window_start = max(0, idx - 2)
            window = text[window_start:idx]
            if any(window.endswith(suffix) for suffix in BOUNDARY_SUFFIXES):
                last_boundary = idx + 1

        if idx - start + 1 >= max_length:
            end = last_boundary if last_boundary > start else idx + 1
            chunks.append((start, end, text[start:end]))
            start = end
            last_boundary = start

    if start < len(text):
        chunks.append((start, len(text), text[start:]))

    return chunks


async def check_chunk(chunk: str) -> str:
    result = await asyncio.wait_for(
        asyncio.to_thread(spell_checker.check, chunk),
        timeout=CHECK_TIMEOUT_SECONDS,
    )
    checked = getattr(result, "checked", None)
    return checked if checked is not None else chunk


@app.post("/spellcheck", response_model=SpellcheckResponse)
async def spellcheck(payload: SpellcheckPayload, request: Request):
    if SHARED_SECRET:
        header_secret = request.headers.get("x-spellcheck-secret")
        if header_secret != SHARED_SECRET:
            raise HTTPException(status_code=401, detail="unauthorized")

    original = payload.text or ""
    warnings: List[str] = []
    fatal_error = False

    if not original.strip():
        return SpellcheckResponse(
            ok=False,
            original=original,
            corrected=original,
            diffCount=0,
            chunks=1,
            warnings=["empty_text"],
            suggestions=[],
        )

    if len(original) > MAX_TEXT_LENGTH:
        warnings.append("text_truncated")
        original = original[:MAX_TEXT_LENGTH]

    chunk_specs = build_chunks(original, MAX_CHUNK_LENGTH)
    logger.info(
        "spellcheck_request",
        extra={
            "length": len(original),
            "chunks": len(chunk_specs),
        },
    )

    corrected_parts: List[str] = []
    suggestions: List[dict] = []
    diff_count = 0

    try:
        for start, end, chunk in chunk_specs:
            corrected_chunk = await check_chunk(chunk)
            corrected_parts.append(corrected_chunk)
            if corrected_chunk != chunk:
                diff_count += 1
                suggestions.append(
                    {
                        "start": start,
                        "end": end,
                        "before": chunk,
                        "after": corrected_chunk,
                        "reason": "hanspell",
                    }
                )
    except asyncio.TimeoutError:
        warnings.append("timeout")
        fatal_error = True
    except Exception as exc:
        warnings.append(f"error:{type(exc).__name__}")
        fatal_error = True
        logger.exception("spellcheck_failed")

    if fatal_error:
        return SpellcheckResponse(
            ok=False,
            original=original,
            corrected=original,
            diffCount=0,
            chunks=len(chunk_specs) or 1,
            warnings=warnings,
            suggestions=[],
        )

    corrected = "".join(corrected_parts)
    return SpellcheckResponse(
        ok=True,
        original=original,
        corrected=corrected,
        diffCount=diff_count,
        chunks=len(chunk_specs) or 1,
        warnings=warnings,
        suggestions=suggestions,
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", "8000")),
        reload=False,
    )
