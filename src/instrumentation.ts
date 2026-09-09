/** Native Render web process only. Registration never waits for queue work. */
export function register() {
  if (
    process.env.NEXT_RUNTIME !== "nodejs" ||
    process.env.NODE_ENV !== "production" ||
    process.env.RENDER !== "true" ||
    process.env.npm_lifecycle_event !== "start" ||
    process.env.NEXT_PHASE === "phase-production-build"
  ) return;

  // Keep Node-only DB dependencies out of the Edge/build registration path.
  if (process.env.MUSIC_ARCHIVE_WORKER_DISABLED !== "true") void import("./lib/music-archive/dispatcher")
    .then(({ startMusicArchiveDispatcher }) => { startMusicArchiveDispatcher(); })
    .catch(() => { console.error("[music-archive] background dispatcher initialization failed"); });

  if (process.env.REVIEW_DOCS_WEB_DISABLED !== "true") void import("./lib/review-docs/dispatcher")
    .then(({ startReviewDispatcher }) => { startReviewDispatcher(); })
    .catch(() => { console.error("[review-docs] background dispatcher initialization failed"); });
}
