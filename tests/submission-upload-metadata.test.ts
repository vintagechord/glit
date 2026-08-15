import assert from "node:assert/strict";
import test from "node:test";

import {
  areSubmissionUploadMetadataEqual,
  mergeSubmissionUploadMetadata,
} from "../src/lib/submission-upload-metadata";

test("new MV uploads preserve unrelated persisted file metadata", () => {
  const existing = [
    {
      path: "submissions/original-video.mp4",
      originalName: "video.mp4",
      size: 100,
      mime: "video/mp4",
    },
  ];
  const incoming = [
    {
      path: "submissions/application.docx",
      originalName: "application.docx",
      size: 20,
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    },
  ];

  assert.deepEqual(mergeSubmissionUploadMetadata(existing, incoming), [
    existing[0],
    incoming[0],
  ]);
});

test("same-name and same-size files with different object paths are preserved", () => {
  const existing = [
    {
      path: "submissions/first-video.mp4",
      originalName: "Video.MP4",
      size: 100,
      mime: "video/mp4",
    },
  ];
  const retried = {
    path: "submissions/retried-video.mp4",
    originalName: "video.mp4",
    size: 100,
    mime: "video/mp4",
  };

  assert.deepEqual(mergeSubmissionUploadMetadata(existing, [retried]), [
    existing[0],
    retried,
  ]);
});

test("the newest metadata for one object path wins", () => {
  const existing = [
    {
      path: "submissions/video.mp4",
      originalName: "old-name.mp4",
      size: 100,
      mime: "video/mp4",
    },
  ];
  const newest = {
    path: "submissions/video.mp4",
    originalName: "video.mp4",
    size: 101,
    mime: "video/mp4",
  };

  assert.deepEqual(mergeSubmissionUploadMetadata(existing, [newest]), [newest]);
});

test("metadata equality ignores ordering but detects a local-only file change", () => {
  const video = {
    path: "submissions/video.mp4",
    originalName: "video.mp4",
    size: 100,
    mime: "video/mp4",
  };
  const form = {
    path: "submissions/application.docx",
    originalName: "application.docx",
    size: 20,
    mime: "application/docx",
  };

  assert.equal(
    areSubmissionUploadMetadataEqual([video, form], [form, video]),
    true,
  );
  assert.equal(areSubmissionUploadMetadataEqual([video], [video, form]), false);
});
