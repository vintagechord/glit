# Member navigation and homepage update — 2026-10-28

## Findings and changes

- Status previously verified the user on the server, then waited for hydration to call `/api/dashboard/status`, verify the user again, and start the database queries. Status now streams the authenticated initial snapshot into the client. Orders use the same server-seeded approach with their existing ownership-filtered loader.
- The normal populated status path now uses four database queries in two dependent stages, down from five queries in three stages. Package metadata already returned by the submission join is reused; missing joins retain their compatibility fallback. Independent package-station and review reads run together.
- Concurrent server status reads share one in-flight request per verified user. The short cache has a 100-user bound; invalidated older reads cannot repopulate it. Explicit refreshes bypass the previous ordinary snapshot. User verification and owner filters remain in place; private API responses remain `private, no-store`.
- Status hydration avoids its redundant API request. Short client cache entries are per user, background polling runs only in visible tabs, and unmount cancels unused requests. Updated props are reconciled into the displayed submission/station rows while preserving selection and newer realtime results.
- Artist metadata and the member's artist history are queried concurrently. English music archive tabs and login-return links now carry their locale directly.
- `/api/dashboard/status` exposes aggregate `Server-Timing` durations for authentication and status loading, without identifiers or query details.
- The homepage station list uses compact logo/status rows, showing six stations without oversized status buttons. The requested subtitle and preview label are removed, “예시 데이터” becomes “예시”, Artmelon joins the other-brand rotation using its official wordmark, and the footer support button links to the support page with the separate contact button removed.

## Operational evidence

Read-only Supabase CLI inspection (the connected MCP permission was unavailable): database 22 MB, tables 1,032 kB, index and table cache hit ratios both 1.00. `submissions_user_visible_idx` had 1,622 index scans and no sequential scans in its reported table statistics. The top cumulative outlier was the scheduled email dispatcher, 72.27 seconds over 5,062 calls (about 14 ms/call); these cumulative statistics do not establish endpoint latency. No speculative indexes or schema changes were added.

`scripts/navigation-perf-smoke.ts` measures six real browser transitions using one disposable, empty member account, then deletes it. It does not send mail, create submissions/orders, change customers, or record private traces/screenshots. Timings include browser and network variation and are not a populated-account benchmark.

Before deployment, on `https://glit-b1yn.onrender.com` at 2026-10-28 14:14 UTC:

| Transition | Samples (ms) | Median (ms) | Hydration API requests per visit | Full document reloads |
| --- | --- | --- | --- | --- |
| Account → Status | 2,866 / 1,333 / 1,002 | 1,333 | 1 | 0 |
| Account → Orders | 2,325 / 1,329 / 1,828 | 1,828 | 1 | 0 |

## Verification and rollout

- 42 focused unit tests passed, covering authentication/session guards, ownership, status query sequencing, cache races and homepage copy.
- 40 isolated Chromium checks passed for compact station results, homepage controls, status lifecycle, seeded orders and English music navigation. Another 19 checks passed against the clean production build, including responsive Korean/English pages, Artmelon, footer links and navigation without document restarts. Desktop/mobile screenshots were inspected.
- Full TypeScript, changed-file ESLint and a production webpack build passed. The release build was made from a clean source snapshot, excluding unrelated local document-tool work.
- A live Supabase login test against that candidate confirmed zero initial status/order API calls across all six member transitions, with no document reload. Its local timings are intentionally not compared with the remote baseline. The disposable account was deleted successfully.
- Production PR: https://github.com/vintagechord/glit/pull/27. Deployed commit `fa53a5a8d86aeb1db9c911ce46639a1e723f4d9c`, Render deployment `dep-dbh0e7k9v7es73bhgdjg`, **Live at 2026-10-28 23:33:42 KST**.
- All 19 public/navigation checks passed on production. `/api/health` and `/readyz` returned `ok: true`, zero errors and the existing Kakao notification configuration warning. Unauthenticated status returned 401 with `private, no-store`; authenticated status returned 200 with the new timing header.

After deployment, the same disposable-account browser procedure produced the following results. The first run overlapped two public-smoke browser workers; the second ran after those workers finished, to distinguish that extra load. All temporary accounts were deleted. Each sample rendered the final empty state and made **zero** initial status/order API requests and **zero** document reloads.

| Run / transition | Samples (ms) | Median (ms) |
| --- | --- | --- |
| Concurrent smoke / Status, 14:35 UTC | 3,344 / 807 / 1,320 | 1,320 |
| Concurrent smoke / Orders, 14:35 UTC | 819 / 1,333 / 1,327 | 1,327 |
| After smoke / Status, 14:37 UTC | 1,347 / 810 / 821 | 821 |
| After smoke / Orders, 14:37 UTC | 809 / 1,312 / 1,340 | 1,312 |

Compared with the baseline, the after-smoke sample medians were 38% lower for status and 28% lower for orders. This is a three-sample empty-account observation, not a population percentile or guarantee for large histories or cold starts. The zero duplicate hydration request and four-query/two-stage populated path are separately verified structural improvements.

The existing Render service uses the free plan. This release optimizes application work; an idle service wake-up can still add latency. No hosting plan or deferred Spotify/YouTube key configuration was changed.
