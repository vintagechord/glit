import { after } from "next/server";

/**
 * Defers side effects (notification mail, logging) until the HTTP response
 * has been sent, so a customer never waits on a mail relay. Outside a Next.js
 * request scope (unit tests, scripts) the work simply runs inline.
 */
export async function runAfterResponse(task: () => Promise<void>): Promise<void> {
  try {
    after(task);
  } catch {
    await task();
  }
}
