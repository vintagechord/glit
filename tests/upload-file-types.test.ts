import assert from "node:assert/strict";
import test from "node:test";

import { inspectFileSignature } from "../src/lib/file-signature";
import {
  inferSubmissionUploadKind,
  isAllowedSubmissionUpload,
  knownDownloadContentType,
  safeUploadContentType,
  type UploadKind,
} from "../src/lib/upload-file-types";

test("an upload needs an allowed extension and a declared type that fits it", () => {
  const allowed: Array<[UploadKind, string, string]> = [
    ["audio", "master.wav", "audio/wav"], ["audio", "master.WAV", "audio/x-wav"], ["audio", "master.wav", "audio/vnd.wave"],
    ["audio", "track.mp3", "audio/mpeg"], ["audio", "album.zip", "application/x-zip-compressed"], ["audio", "album.zip", "multipart/x-zip"],
    ["audio", "신청서.hwp", "application/haansofthwp"], ["audio", "신청서.hwp", "application/octet-stream"], ["audio", "form.docx", ""],
    ["video", "mv.mp4", "video/mp4"], ["video", "mv.mov", "video/quicktime"], ["video", "mv.wmv", "video/x-ms-wmv"], ["video", "form.doc", "application/msword"],
    ["etc", "사업자등록증.pdf", "application/pdf"], ["etc", "scan.jpg", "image/jpeg"], ["etc", "scan.png", "image/png"], ["etc", "lyrics.txt", "text/plain"],
  ];
  for (const [kind, filename, mime] of allowed) {
    assert.equal(isAllowedSubmissionUpload(kind, filename, mime), true, `${kind} ${filename} ${mime}`);
  }
  const refused: Array<[UploadKind, string, string]> = [
    // The audit's bypasses: a MIME type alone, or a page behind a document name.
    ["etc", "a.pdf", "text/html"], ["etc", "a.pdf", "application/xhtml+xml"], ["etc", "scan.png", "image/svg+xml"],
    ["audio", "master", "audio/wav"], ["audio", "x.bin", "audio/wav"], ["audio", "form", "application/msword"],
    ["video", "clip", "video/mp4"], ["etc", "lyrics.txt", "text/html"], ["audio", "track.mp3", "video/mp4"],
    // Each kind keeps its own list.
    ["audio", "mv.mp4", "video/mp4"], ["video", "master.wav", "audio/wav"], ["etc", "master.wav", "audio/wav"], ["audio", "scan.pdf", "application/pdf"],
    ["video", "page.html", "text/html"], ["etc", "script.js", "application/javascript"], ["audio", "album.zip", "application/json"],
  ];
  for (const [kind, filename, mime] of refused) {
    assert.equal(isAllowedSubmissionUpload(kind, filename, mime), false, `${kind} ${filename} ${mime}`);
  }
});

test("every allowed extension has a container check, so completion never sees 'unsupported'", () => {
  for (const name of ["a.wav", "a.mp3", "a.zip", "a.hwp", "a.doc", "a.docx", "a.mp4", "a.mov", "a.wmv", "a.mpg", "a.mpeg", "a.m4v", "a.pdf", "a.jpg", "a.jpeg", "a.png", "a.webp", "a.txt"]) {
    const kind = inferSubmissionUploadKind(name);
    assert.ok(kind, name);
    assert.equal(isAllowedSubmissionUpload(kind, name, ""), true, name);
    assert.notEqual(inspectFileSignature(name, new Uint8Array(8)), "unsupported", name);
  }
});

test("direct uploads without a kind infer it from the extension", () => {
  assert.equal(inferSubmissionUploadKind("사업자등록증.pdf"), "etc");
  assert.equal(inferSubmissionUploadKind("scan.webp"), "etc");
  assert.equal(inferSubmissionUploadKind("master.wav"), "audio");
  assert.equal(inferSubmissionUploadKind("mv.mov"), "video");
  // Application forms travel with the album audio list.
  assert.equal(inferSubmissionUploadKind("신청서.hwp"), "audio");
  assert.equal(inferSubmissionUploadKind("page.html"), null);
  assert.equal(inferSubmissionUploadKind("noextension"), null);
});

test("objects are stored and served with a type chosen from the extension", () => {
  assert.equal(safeUploadContentType("a.pdf"), "application/pdf");
  assert.equal(safeUploadContentType("가사.txt"), "text/plain; charset=utf-8");
  assert.equal(safeUploadContentType("x.html"), "application/octet-stream");
  assert.equal(safeUploadContentType("noextension"), "application/octet-stream");
  assert.equal(knownDownloadContentType("thumb.webp"), "image/webp");
  assert.equal(knownDownloadContentType("x.html"), undefined, "unknown types keep what storage recorded, as attachments");
});
