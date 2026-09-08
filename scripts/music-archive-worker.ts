import { loadEnvConfig } from "@next/env";
import { runArchiveJob } from "../src/lib/music-archive/sync";

loadEnvConfig(process.cwd());
let stopped = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { stopped = true; });
async function main() {
  do {
    try {
      const processed = await runArchiveJob();
      if (process.argv.includes("--once")) return;
      if (!processed) await new Promise(resolve => setTimeout(resolve, 3000));
    } catch {
      console.error("[music-archive] 연결 실패: Supabase 설정과 0095 마이그레이션을 확인해주세요.");
      if (process.argv.includes("--once")) { process.exitCode = 1; return; }
      await new Promise(resolve => setTimeout(resolve, 15000));
    }
  } while (!stopped);
}
void main();
