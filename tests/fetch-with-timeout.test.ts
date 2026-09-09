import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { fetchWithTimeout } from "../src/lib/fetch-with-timeout";

test("API deadlines cover stalled headers and bodies without repeating writes", async () => {
  let writes = 0;
  const server = createServer((request, response) => {
    if (request.method === "POST") writes++;
    if (request.url === "/body") {
      response.writeHead(200, { "content-type": "application/json" });
      response.write('{"pending":');
    }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}`;
  try {
    await assert.rejects(fetchWithTimeout(`${url}/headers`, { method: "POST" }, 100), { name: "TimeoutError" });
    const response = await fetchWithTimeout(`${url}/body`, undefined, 100);
    await assert.rejects(response.json(), (error: Error) => /^(AbortError|TimeoutError)$/.test(error.name));
    assert.equal(writes, 1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test("API deadlines preserve both Request and init cancellation signals", async () => {
  for (const abortRequest of [true, false]) {
    const requestController = new AbortController();
    const initController = new AbortController();
    let receivedSignal: AbortSignal | null | undefined;
    const fetcher: typeof fetch = async (_input, init) => {
      receivedSignal = init?.signal;
      return new Response("ok");
    };
    const request = new Request("https://example.invalid", { signal: requestController.signal });
    const response = await fetchWithTimeout(request, { signal: initController.signal }, 500, fetcher);
    assert.equal(await response.text(), "ok");
    const reason = new Error("caller cancelled");
    (abortRequest ? requestController : initController).abort(reason);
    assert.equal(receivedSignal?.aborted, true);
    assert.equal(receivedSignal?.reason, reason);
  }
});
