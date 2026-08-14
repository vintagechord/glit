import assert from "node:assert/strict";
import test from "node:test";

import {
  consumeRateLimit,
  getRequestIdentifier,
} from "../src/lib/request-rate-limit";

test("request rate limiter blocks after the configured fixed-window limit", () => {
  const identifier = `test-${Date.now()}-${Math.random()}`;
  const options = {
    namespace: "unit",
    identifier,
    limit: 2,
    windowMs: 60_000,
    now: 1_000_000,
  };

  assert.equal(consumeRateLimit(options).allowed, true);
  assert.equal(consumeRateLimit(options).allowed, true);
  const blocked = consumeRateLimit(options);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSeconds, 60);

  assert.equal(
    consumeRateLimit({ ...options, now: options.now + options.windowMs }).allowed,
    true,
  );
});

test("request rate limiter accounts for weighted byte-budget costs", () => {
  const identifier = `weighted-${Date.now()}-${Math.random()}`;
  const options = {
    namespace: "unit-weighted",
    identifier,
    limit: 10,
    windowMs: 60_000,
    now: 2_000_000,
  };

  assert.deepEqual(consumeRateLimit({ ...options, cost: 6 }).remaining, 4);
  const blocked = consumeRateLimit({ ...options, cost: 5 });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.remaining, 0);
  assert.equal(consumeRateLimit({ ...options, cost: 4 }).allowed, true);
});

test("request identifier prefers trusted edge headers and normalizes forwarding", () => {
  assert.equal(
    getRequestIdentifier(
      new Headers({
        "cf-connecting-ip": "203.0.113.7",
        "x-forwarded-for": "198.51.100.2, 10.0.0.1",
      }),
    ),
    "203.0.113.7",
  );
  assert.equal(
    getRequestIdentifier(
      new Headers({ "x-forwarded-for": "198.51.100.2, 10.0.0.1" }),
    ),
    "198.51.100.2",
  );
});
