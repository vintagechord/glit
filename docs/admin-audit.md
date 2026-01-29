# Admin Area Audit (snapshot – Jan 29, 2026)

Scope: Onside admin (artists, submissions/reviews, files, payments, karaoke, banners, users, config). Focus on save/read path, permissions, cache, and data integrity. No large refactors; observations + concrete next steps.

## Admin routes (App Router)
- `/admin/page.tsx` (landing)
- `/admin/artists/page.tsx`, `/admin/artists/[id]/page.tsx`
- `/admin/submissions/page.tsx`, `/admin/submissions/detail/page.tsx`, `/admin/submissions/[id]/page.tsx`
- `/admin/files/page.tsx`
- `/admin/payments/page.tsx`
- `/admin/karaoke/page.tsx`
- `/admin/banners/page.tsx`
- `/admin/config/page.tsx`
- `/admin/users/page.tsx`

## Key server actions / APIs
- `src/features/admin/actions.ts`: submission status/save, station review update, track add/delete, package/station/banners/config CRUD, artist update/delete (recent), submission delete, etc.
- `src/app/api/dashboard/status/route.ts`: user-facing status feed (recent submissions + station reviews).
- `src/app/api/dashboard/history/route.ts` (implicit via page) and dashboard pages for user views.

## Data model touchpoints (read/write)
- `submissions` (status, payment_status, admin_memo, result_*).
- `station_reviews` (station_id, status, result_note, track_results JSON).
- `album_tracks` (track list per submission).
- `artists` (name, thumbnail_url).
- `packages` / `package_stations` (station presets).
- `submission_files` (uploads).
- `submission_events` (audit-style log).

## Current risks / findings (priority)
1. **Silent save failures**: Some server actions still redirect with `saved=error` without surfacing the underlying DB error to UI (e.g., `saveSubmissionAdminFormAction` improved but non-admin paths may still hide errors). Risk: admins think saves succeeded.
2. **Column-mismatch fallbacks**: `track_results` missing in certain envs triggers alternate selects; safer now but still logs only. Need clearer fatal error when both select attempts fail.
3. **Caching/stale data**: User dashboard relies on `/api/dashboard/status`; now uses service role (admin) but only pulls last 5 submissions. Older submissions won’t show station rows; could mislead users.
4. **Permissions**: Admin pages/actions use service client; user-facing status API uses service client but filters by `user_id`. Need explicit role checks on server actions (most rely on service key only).
5. **Atomicity**: Station status + track results are updated sequentially per review; no transaction. Partial writes possible on mid-loop failure.
6. **Audit**: `submission_events` exists but admin save paths don’t consistently append events (only some actions). Limited observability for who changed what.
7. **Artist management**: Delete added; no guard against deleting artists that still have submissions (FK constraint may fail). Need soft-check / error surfacing.
8. **Pagination limits**: Submissions list pages may still fetch large ranges (needs confirmation); artists now paginated.
9. **File access**: Download links (B2/Supabase storage) are plain public URLs; signed URLs not enforced. Needs review.

## Quick wins to schedule (low-risk changes)
- Surface DB error message in all admin form actions (especially delete/updates) via toast or inline banner.
- Add simple role gate in admin actions: reject if `createServerSupabase` user lacks admin flag (if available) before using service client.
- Expand `/api/dashboard/status` to fetch more rows or accept `limit` param; default to last 20.
- Wrap station review + track_results update in a small transaction (single call via RPC or PostgREST `eq` update inside a PL/pgSQL func) to avoid partial saves.
- Append `submission_events` entry for station status changes and track result changes (who/when/what).
- Add delete-precheck for artists (count submissions; block with message if >0).

## Minimal regression scenarios (to automate)
- Admin: open submission detail → set station MBC to APPROVED; set track1 APPROVED, track2 REJECTED → save → values persist after reload; user dashboard shows same.
- Admin: add track, delete track → station track_results updates (no stale track references).
- Admin: artist delete blocked when submissions exist; allowed when zero; pagination navigation works.
- User: `/api/dashboard/status` returns station rows (no empty table) for existing submissions; no 401 when logged in; no other users’ data leaked.

## Next steps (execution order)
1) Hard-stop failures: tighten error surface on all admin actions and add station update event log.  
2) Pagination + limit: increase `/api/dashboard/status` limit, add query param, ensure no-store headers.  
3) Permission check: lightweight admin flag check in actions; log and reject otherwise.  
4) Atomic station update: small transactional RPC or batched update with rowcount checks.  
5) Add artist delete guard + message.  
6) Add basic integration tests (Node + supabase stub) for station update + dashboard status mapping.

This document is a live checklist; keep deltas small and commit per fix. 
