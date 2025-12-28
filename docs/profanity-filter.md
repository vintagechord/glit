# Profanity filter (lyrics)

## Current v1 behavior
- Location: `src/features/submissions/album-wizard.tsx` (client-only).
- Terms: base hardcoded list + `profanity_terms` from Supabase.
- Flow: user clicks "욕설 체크" -> regex test -> confirm dialog -> highlight + word chips.
- No server-side block/mask/logging is enforced today.

## v2 pipeline (flagged)
- Module: `src/lib/profanity/engine.ts`.
- Steps: normalize -> rule match -> scoring -> allowlist.
- Feature flag: `PROFANITY_FILTER_V2=true` enables v2 on the album lyrics flow.
- v1 remains active for highlighting and backward compatibility; v2 only augments detection.

## Config files
- `config/profanity_rules.json`
  - Fields: `id`, `severity`, `pattern`, `description`, `lang`, `score`.
  - Regex patterns are applied to normalized text.
- `config/profanity_allowlist.json`
  - Fields: `id`, `pattern`, `description`, `lang`.
  - Used to suppress known safe terms and reduce false positives.

## Scoring and actions
- `BLOCK` rules trigger immediate block.
- `MASK`/`WARN` rules accumulate scores.
- Default thresholds live in `src/lib/profanity/engine.ts` (warn/mask/block).
- Extra weights (optional): repeated matches, excessive punctuation, @mentions, all-caps.

## Logging / audit (no raw text)
- Keep logs minimal: `matched_rule_ids`, `action`, `score`, optional hash.
- Helper: `buildAuditPayload` in `src/lib/profanity/engine.ts`.
- Hash should be computed outside the engine (e.g., SHA-256 of normalized input).

## External slur list placeholder
- Use `evaluate(text, { extraRules })` to attach a separate ruleset.
- Keep sensitive lists in a separate module or managed config (not in this repo).

## Tests
- `tests/profanity-filter.test.ts` covers allowlist, evasion cases, and v1 flag-off parity.
- Run: `npm test`.
