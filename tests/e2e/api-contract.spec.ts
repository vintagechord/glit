import { test, expect, request } from "@playwright/test";

const baseURL = process.env.NEXT_E2E_BASE_URL;
const hasSupabase =
  !!process.env.SUPABASE_URL &&
  !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

test.describe("API contract (unauthenticated guards)", () => {
  test.skip(!baseURL || !hasSupabase, "Requires NEXT_E2E_BASE_URL and Supabase env");

  test("uploads init rejects missing auth", async () => {
    const context = await request.newContext({ baseURL });
    const res = await context.post("/api/uploads/init", {
      data: {
        submissionId: "11111111-1111-1111-1111-111111111111",
        kind: "audio",
        filename: "demo.mp3",
        mimeType: "audio/mpeg",
        sizeBytes: 1234,
      },
    });
    expect([401, 403]).toContain(res.status());
  });

  test("dashboard status requires auth", async () => {
    const context = await request.newContext({ baseURL });
    const res = await context.get("/api/dashboard/status");
    expect(res.status()).toBe(401);
  });
});
