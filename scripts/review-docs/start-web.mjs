import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

/** One existing container; worker failures retry independently of web requests. */
export function startReviewWebServices(options = {}) {
  const launch = options.spawn ?? spawn;
  const schedule = options.schedule ?? setTimeout;
  const cancel = options.cancel ?? clearTimeout;
  const stopProcess = options.kill ?? ((child, signal) => {
    if (child?.pid) { try { process.kill(-child.pid, signal); } catch { /* already exited */ } }
  });
  const environment = options.env ?? process.env;
  let stopping = false, worker = null, restart = null;
  const web = launch(process.execPath, ["node_modules/next/dist/bin/next", "start"], {
    stdio: "inherit", detached: true, env: { ...environment, npm_lifecycle_event: "start" },
  });
  const stop = () => {
    if (stopping) return;
    stopping = true;
    if (restart) cancel(restart);
    stopProcess(web, "SIGTERM"); stopProcess(worker, "SIGTERM");
    const killTimer = schedule(() => { stopProcess(web, "SIGKILL"); stopProcess(worker, "SIGKILL"); }, 10_000);
    killTimer.unref?.();
  };
  const startWorker = () => {
    if (stopping) return;
    const child = launch(process.execPath, ["--max-old-space-size=192", "--import", "tsx", "scripts/review-docs/worker.ts"], {
      stdio: "inherit", detached: true, env: { ...environment, npm_lifecycle_event: "review-docs:worker" },
    });
    worker = child;
    let ended = false;
    const onEnd = () => {
      if (ended) return;
      ended = true;
      if (worker === child) worker = null;
      if (!stopping) restart = schedule(startWorker, 15_000);
    };
    child.once("exit", onEnd); child.once("error", onEnd);
  };
  web.once("exit", (code) => {
    if (!stopping) { process.exitCode = code || 1; stop(); }
  });
  web.once("error", () => { process.exitCode = 1; stop(); });
  startWorker();
  return { stop };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const services = startReviewWebServices();
  process.on("SIGTERM", services.stop);
  process.on("SIGINT", services.stop);
}
