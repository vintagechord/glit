import { test, expect } from "@playwright/test";

const root = "/api/admin/review-docs/jobs";
const id = "11111111-1111-4111-8111-111111111111";
const endpoints = [
  ["GET", root], ["POST", root], ["GET", `${root}/${id}`], ["PATCH", `${root}/${id}`],
  ...["generate", "translate", "retry", "cancel"].map((action) => ["POST", `${root}/${id}/${action}`]),
  ["GET", `${root}/${id}/source?file=unknown`], ["GET", `${root}/${id}/download?file=zip`],
];

test("all review document API entry points reject unauthenticated requests", async ({ request }) => {
  for (const [method, url] of endpoints) {
    const response = await request.fetch(url, { method, ...(method === "GET" ? {} : { data: { version: 1 } }) });
    expect(response.status(), `${method} ${url}`).toBe(401);
    expect((await response.json()).code).toBe("AUTH_REQUIRED");
  }
});

test("review document administrator page redirects anonymous visitors to login", async ({ request }) => {
  const response = await request.get("/admin/review-docs", { maxRedirects: 0 });
  expect(response.status()).toBe(307);
  expect(response.headers().location).toContain("/login?next=%2Fadmin%2Freview-docs");
});
