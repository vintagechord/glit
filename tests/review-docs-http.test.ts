import assert from "node:assert/strict";
import { test } from "node:test";
import { readReviewJson, readReviewUpload } from "../src/lib/review-docs/http";

test("review upload reads real multipart files and refuses unknown fields", async () => {
  const form = new FormData(); form.set("mode", "mv"); form.append("files", new Blob(["{\\rtf1 hello}"], { type: "application/msword" }), "한글.doc");
  const result = await readReviewUpload(new Request("http://localhost/api", { method: "POST", body: form }));
  assert.equal(result.mode, "mv"); assert.equal(result.files[0].name, "한글.doc"); assert.match(result.files[0].buffer.toString(), /rtf1/);
  form.set("isAdmin", "true");
  await assert.rejects(readReviewUpload(new Request("http://localhost/api", { method: "POST", body: form })), /업로드 정보|제한/);
});
test("review multipart enforces file limits rather than trusting content length", async () => {
  const form = new FormData(); form.set("mode", "album");
  for (let i = 0; i < 9; i++) form.append("files", new Blob(["a"]), `${i}.docx`);
  await assert.rejects(readReviewUpload(new Request("http://localhost/api", { method: "POST", body: form })), /제한/);
});
test("review JSON body is byte bounded including streams without content-length", async () => {
  await assert.rejects(readReviewJson(new Request("http://localhost/api", { method: "POST", body: " ".repeat(4000) }), 100), /너무 큽니다/);
  await assert.rejects(readReviewJson(new Request("http://localhost/api", { method: "POST", body: "{" })), /JSON/);
  assert.deepEqual(await readReviewJson(new Request("http://localhost/api", { method: "POST", body: '{"version":2}' })), { version: 2 });
});
