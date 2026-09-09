type Timer = { unref?: () => unknown };
type Controller = { stop: () => Promise<void> };
const shared = globalThis as typeof globalThis & { __reviewDispatcher?: Controller };

export function isReviewDispatcherEnabled(env: Record<string, string | undefined>) {
  return env.NODE_ENV === "production" && env.NEXT_RUNTIME === "nodejs" && env.RENDER === "true"
    && env.npm_lifecycle_event === "start" && env.NEXT_PHASE !== "phase-production-build"
    && env.REVIEW_DOCS_WEB_DISABLED !== "true";
}

/** Resume after restarts even when the administrator has closed the browser. */
export function startReviewDispatcher(options: {
  env?: Record<string, string | undefined>;
  run?: () => Promise<void>;
  schedule?: (callback: () => void, delay: number) => Timer;
  cancel?: (timer: Timer) => void;
} = {}): Controller | null {
  if (!isReviewDispatcherEnabled(options.env ?? process.env)) return null;
  if (shared.__reviewDispatcher) return shared.__reviewDispatcher;
  const schedule = options.schedule ?? ((callback, delay) => setTimeout(callback, delay));
  const cancel = options.cancel ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  const run = options.run ?? (async () => { const { resumeWebReviewJobs } = await import("./web-runner"); await resumeWebReviewJobs(); });
  let stopped = false, timer: Timer | undefined, running: Promise<void> | undefined;
  const controller: Controller = { stop: async () => {
    stopped = true;
    if (timer) cancel(timer);
    await running;
    if (shared.__reviewDispatcher === controller) delete shared.__reviewDispatcher;
  } };
  const queue = () => {
    if (stopped) return;
    timer = schedule(() => {
      timer = undefined;
      if (stopped || running) return;
      running = Promise.resolve().then(run).catch(() => {
        console.error("[review-docs] automatic document processing will retry");
      }).finally(() => { running = undefined; queue(); });
    }, 15_000);
    timer.unref?.();
  };
  shared.__reviewDispatcher = controller;
  queue();
  return controller;
}
