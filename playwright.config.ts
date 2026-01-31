import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.NEXT_E2E_BASE_URL || "http://localhost:3000";

export default defineConfig({
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
