import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { MEDIA_UPLOAD_EMAIL_HINT, MEDIA_UPLOAD_MAX_BYTES, MEDIA_UPLOAD_MAX_LABEL, MEDIA_UPLOAD_TOO_LARGE_MESSAGE } from "../src/lib/media-upload-limit";
import { SUPPLEMENT_MAX_BYTES, supplementActionSchema } from "../src/lib/submission-supplements/model";
import { APP_CONFIG } from "../src/lib/config";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("audio and music video uploads are limited to 2GB per file everywhere", () => {
  assert.equal(MEDIA_UPLOAD_MAX_BYTES, 2 * 1024 ** 3);
  assert.equal(MEDIA_UPLOAD_MAX_LABEL, "2GB");
  assert.equal(SUPPLEMENT_MAX_BYTES, MEDIA_UPLOAD_MAX_BYTES);
  const init = read("src/app/api/uploads/multipart/init/route.ts");
  assert.match(init, /const MAX_AUDIO_BYTES = MEDIA_UPLOAD_MAX_BYTES;/);
  assert.match(init, /const MAX_VIDEO_BYTES = MEDIA_UPLOAD_MAX_BYTES;/);
  assert.match(init, /error: MEDIA_UPLOAD_TOO_LARGE_MESSAGE/);
  assert.match(read("src/features/submissions/actions.ts"), /const MAX_UPLOAD_BYTES = MEDIA_UPLOAD_MAX_BYTES;/);
  for (const wizard of ["src/features/submissions/album-wizard.tsx", "src/features/submissions/mv-wizard.tsx"]) {
    const source = read(wizard);
    assert.match(source, /const uploadMaxBytes = MEDIA_UPLOAD_MAX_BYTES;/, wizard);
    assert.match(source, /invalidNotice = MEDIA_UPLOAD_TOO_LARGE_MESSAGE;/, wizard);
    assert.match(source, /\{MEDIA_UPLOAD_EMAIL_HINT\}/, wizard);
    assert.doesNotMatch(source, /UPLOAD_MAX_MB/, wizard);
  }
  assert.doesNotMatch(read("src/app/api/submissions/[id]/supplements/route.ts"), /4GB/);
});

test("supplement uploads over 2GB are refused by the request schema", () => {
  const base = { action: "init", requestId: "11111111-1111-4111-8111-111111111111", filename: "mv.mp4", mimeType: "video/mp4" };
  assert.equal(supplementActionSchema.safeParse({ ...base, sizeBytes: MEDIA_UPLOAD_MAX_BYTES }).success, true);
  assert.equal(supplementActionSchema.safeParse({ ...base, sizeBytes: MEDIA_UPLOAD_MAX_BYTES + 1 }).success, false);
});

test("the over-limit message points to email submission at the support address", () => {
  assert.match(MEDIA_UPLOAD_TOO_LARGE_MESSAGE, /2GB까지/);
  assert.match(MEDIA_UPLOAD_TOO_LARGE_MESSAGE, /‘파일은 이메일로 나중에 제출’/);
  assert.ok(MEDIA_UPLOAD_TOO_LARGE_MESSAGE.includes(`${APP_CONFIG.supportEmail} 주소로`));
  assert.ok(MEDIA_UPLOAD_EMAIL_HINT.includes(APP_CONFIG.supportEmail));
});
