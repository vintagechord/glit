import assert from "node:assert/strict";
import test from "node:test";

import { buildUrl, getBaseUrl } from "../src/lib/url";

const mutableEnv = process.env as Record<string, string | undefined>;

test("buildUrl normalizes trailing slashes", () => {
  const url = buildUrl("/api/inicis/return", "https://example.com/");
  assert.equal(url, "https://example.com/api/inicis/return");
});

test("buildUrl preserves query params without duplication", () => {
  const url = buildUrl("/api/inicis/close?oid=abc&cancel=1", "https://example.com/base");
  assert.equal(url, "https://example.com/api/inicis/close?oid=abc&cancel=1");
});

test("getBaseUrl never trusts request host headers in production", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  const originalServerAppUrl = process.env.APP_URL;
  try {
    mutableEnv.NODE_ENV = "production";
    delete process.env.NEXT_PUBLIC_SITE_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.APP_URL;
    const request = {
      headers: new Headers({
        host: "attacker.example",
        "x-forwarded-host": "attacker.example",
        "x-forwarded-proto": "https",
      }),
    } as Parameters<typeof getBaseUrl>[0];

    assert.equal(getBaseUrl(request), "https://glit-b1yn.onrender.com");
  } finally {
    if (originalNodeEnv === undefined) Reflect.deleteProperty(mutableEnv, "NODE_ENV");
    else mutableEnv.NODE_ENV = originalNodeEnv;
    if (originalSiteUrl === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = originalSiteUrl;
    if (originalAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
    if (originalServerAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = originalServerAppUrl;
  }
});

test("getBaseUrl accepts only a valid configured HTTP origin", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  try {
    mutableEnv.NODE_ENV = "production";
    process.env.NEXT_PUBLIC_SITE_URL = "https://example.com/nested?ignored=1";
    assert.equal(getBaseUrl(), "https://example.com");
  } finally {
    if (originalNodeEnv === undefined) Reflect.deleteProperty(mutableEnv, "NODE_ENV");
    else mutableEnv.NODE_ENV = originalNodeEnv;
    if (originalSiteUrl === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = originalSiteUrl;
  }
});
