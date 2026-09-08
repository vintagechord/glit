/**
 * Resume the existing leased queue from the native Render Next web process.
 * Database leases are shared with request after() work and optional CLI workers.
 * A sleeping/restarting free instance resumes persisted jobs on its next start.
 */
type TimerHandle = { unref?: () => unknown };
type DispatcherOptions = {
  env?: Record<string, string | undefined>;
  runBatch?: () => Promise<unknown>;
  schedule?: (callback: () => void, delayMs: number) => TimerHandle;
  cancel?: (timer: TimerHandle) => void;
  logError?: (message: string) => void;
};
export type MusicArchiveDispatcher = { stop: () => Promise<void> };
type DispatcherState = {
  timer: TimerHandle | null; running: Promise<void> | null; stopped: boolean;
  controller: MusicArchiveDispatcher;
};
const shared = globalThis as typeof globalThis & { __onsideMusicArchiveDispatcher?: DispatcherState };

export function isMusicArchiveDispatcherEnabled(env: Record<string, string | undefined>) {
  return env.NODE_ENV === "production" && env.NEXT_RUNTIME === "nodejs" && env.RENDER === "true"
    && env.npm_lifecycle_event === "start" && env.NEXT_PHASE !== "phase-production-build"
    && env.MUSIC_ARCHIVE_WORKER_DISABLED !== "true";
}

export function startMusicArchiveDispatcher(options: DispatcherOptions = {}): MusicArchiveDispatcher | null {
  if (!isMusicArchiveDispatcherEnabled(options.env ?? process.env)) return null;
  if (shared.__onsideMusicArchiveDispatcher) return shared.__onsideMusicArchiveDispatcher.controller;
  const schedule = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
  const cancel = options.cancel ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  const logError = options.logError ?? ((message) => console.error(message));
  const runBatch = options.runBatch ?? (async () => {
    const { runArchiveBatch } = await import("./sync");
    await runArchiveBatch();
  });
  const state: DispatcherState = {
    timer: null, running: null, stopped: false,
    controller: { stop: async () => {
      state.stopped = true;
      if (state.timer) { cancel(state.timer); state.timer = null; }
      // Never overlap a new dispatcher with a batch already holding DB leases.
      await state.running;
      if (shared.__onsideMusicArchiveDispatcher === state) delete shared.__onsideMusicArchiveDispatcher;
    } },
  };
  shared.__onsideMusicArchiveDispatcher = state;

  const queue = (delayMs: number) => {
    if (state.stopped || state.timer || state.running) return;
    state.timer = schedule(tick, delayMs);
    state.timer.unref?.();
  };
  const tick = () => {
    state.timer = null;
    if (state.stopped || state.running) return;
    let delayMs = 3000;
    // Defer invocation so even a synchronous throw becomes a handled rejection.
    state.running = Promise.resolve().then(runBatch).then(() => {}, () => {
      delayMs = 15000;
      // Do not expose response bodies, environment variables or error messages.
      try { logError("[music-archive] background batch failed; retrying in 15 seconds"); } catch { /* Logging must not break queue recovery. */ }
    }).finally(() => {
      state.running = null;
      queue(delayMs);
    });
  };
  queue(3000);
  return state.controller;
}

/** Stop scheduling, wait for the current bounded batch, then clear the singleton. */
export async function stopMusicArchiveDispatcher() {
  await shared.__onsideMusicArchiveDispatcher?.controller.stop();
}
