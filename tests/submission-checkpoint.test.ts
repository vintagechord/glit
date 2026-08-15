import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createSubmissionCheckpointRecord,
  getSubmissionCheckpointHash,
  getSubmissionCheckpointPrevious,
  getSubmissionCheckpointStorageKey,
  initializeSubmissionCheckpoint,
  markSubmissionCheckpointSaved,
  parseSubmissionCheckpointRecord,
  readSubmissionCheckpoint,
  revertSubmissionCheckpointToSaved,
  sanitizeSubmissionCheckpointData,
  updateSubmissionCheckpoint,
  writeSubmissionCheckpoint,
  type SubmissionCheckpointStorage,
} from "../src/lib/submission-checkpoint";

const checkpointHookSource = readFileSync(
  new URL(
    "../src/features/submissions/use-submission-checkpoint.ts",
    import.meta.url,
  ),
  "utf8",
);

class MemoryStorage implements SubmissionCheckpointStorage {
  readonly values = new Map<string, string>();
  writes = 0;
  failWrites = false;

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    if (this.failWrites) throw new Error("quota");
    this.writes += 1;
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

const kind = "ALBUM" as const;
const submissionId = "11111111-1111-4111-8111-111111111111";
const storageKey = getSubmissionCheckpointStorageKey(
  "onside:draft:album:guest",
  submissionId,
);

test("checkpoint hashes are stable and raw browser files are excluded", () => {
  assert.equal(
    getSubmissionCheckpointHash({ title: "제목", tracks: [{ no: 1 }] }),
    getSubmissionCheckpointHash({ tracks: [{ no: 1 }], title: "제목" }),
  );

  const binary = new Blob(["audio"], { type: "audio/mpeg" });
  const sanitized = sanitizeSubmissionCheckpointData({
    title: "제목",
    selectedFiles: [binary],
    uploadedFiles: [
      {
        path: "submissions/track.mp3",
        originalName: "track.mp3",
        mime: "audio/mpeg",
        size: 5,
      },
    ],
  });

  assert.deepEqual(sanitized, {
    title: "제목",
    selectedFiles: [],
    uploadedFiles: [
      {
        path: "submissions/track.mp3",
        originalName: "track.mp3",
        mime: "audio/mpeg",
        size: 5,
      },
    ],
  });
});

test("one successful server snapshot and one previous snapshot are retained", () => {
  const first = createSubmissionCheckpointRecord({
    kind,
    submissionId,
    data: { title: "첫 저장본" },
    now: 1_000,
  });
  const secondWorking = updateSubmissionCheckpoint(
    first,
    { title: "두 번째 저장본" },
    2_000,
  );
  const secondSaved = markSubmissionCheckpointSaved({
    record: secondWorking,
    revision: secondWorking.revision,
    hash: secondWorking.working.hash,
    snapshot: secondWorking.working,
    savedAt: 2_100,
  });

  assert.equal(secondSaved.saved?.data.title, "두 번째 저장본");
  assert.equal(secondSaved.previousSaved?.data.title, "첫 저장본");
  assert.equal(
    getSubmissionCheckpointPrevious(secondSaved)?.data.title,
    "첫 저장본",
  );

  const reverted = revertSubmissionCheckpointToSaved(secondSaved, 3_000);
  assert.ok(reverted);
  assert.equal(reverted.working.data.title, "첫 저장본");
  assert.equal(
    reverted.pendingServerSave,
    true,
    "restoring an older server version must be saved back to the server",
  );
});

test("an in-flight save never marks newer local edits as synchronized", () => {
  const first = createSubmissionCheckpointRecord({
    kind,
    submissionId,
    data: { title: "A" },
    now: 1_000,
  });
  const candidate = updateSubmissionCheckpoint(first, { title: "B" }, 2_000);
  const latest = updateSubmissionCheckpoint(candidate, { title: "C" }, 3_000);
  const committed = markSubmissionCheckpointSaved({
    record: latest,
    revision: candidate.revision,
    hash: candidate.working.hash,
    snapshot: candidate.working,
    savedAt: 3_100,
  });

  assert.equal(committed.working.data.title, "C");
  assert.equal(committed.saved?.data.title, "B");
  assert.equal(committed.previousSaved?.data.title, "A");
  assert.equal(committed.pendingServerSave, true);
});

test("initialization reads a pending snapshot before a blank form can overwrite it", () => {
  const storage = new MemoryStorage();
  const pending = createSubmissionCheckpointRecord({
    kind,
    submissionId,
    data: {
      title: "복구해야 할 제목",
      tracks: [{ title: "복구해야 할 트랙" }],
    },
    now: 2_000,
    serverSaved: false,
  });
  writeSubmissionCheckpoint({ storage, storageKey, record: pending });
  const rawBeforeInitialization = storage.getItem(storageKey);
  storage.writes = 0;

  const initialized = initializeSubmissionCheckpoint({
    storage,
    storageKey,
    kind,
    submissionId,
    currentData: { title: "", tracks: [{ title: "" }] },
    serverUpdatedAt: 1_000,
    now: 3_000,
  });

  assert.equal(initialized.source, "existing");
  assert.equal(initialized.shouldSave, false);
  assert.equal(initialized.recovery?.data.title, "복구해야 할 제목");
  assert.equal(storage.writes, 0, "initial blank state must not be persisted");
  assert.equal(storage.getItem(storageKey), rawBeforeInitialization);
});

test("new initialization seeds a clean baseline and later edits become pending", () => {
  const storage = new MemoryStorage();
  const initialized = initializeSubmissionCheckpoint({
    storage,
    storageKey,
    kind,
    submissionId,
    currentData: { title: "서버에서 불러온 제목" },
    serverUpdatedAt: 1_000,
    now: 2_000,
  });

  assert.equal(initialized.recovery, null);
  assert.equal(initialized.shouldSave, false);
  assert.equal(initialized.record.pendingServerSave, false);

  const edited = updateSubmissionCheckpoint(
    initialized.record,
    { title: "사용자가 수정한 제목" },
    3_000,
  );
  assert.equal(edited.pendingServerSave, true);
});

test("records are identity-bound, age-limited and corruption-checked", () => {
  const storage = new MemoryStorage();
  const record = createSubmissionCheckpointRecord({
    kind,
    submissionId,
    data: { title: "안전한 저장본" },
    now: 10_000,
  });
  writeSubmissionCheckpoint({ storage, storageKey, record });

  assert.equal(
    readSubmissionCheckpoint<{ title: string }>({
      storage,
      storageKey,
      kind,
      submissionId,
      now: 11_000,
    })?.working.data.title,
    "안전한 저장본",
  );
  assert.equal(
    readSubmissionCheckpoint({
      storage,
      storageKey,
      kind,
      submissionId: "22222222-2222-4222-8222-222222222222",
      now: 11_000,
    }),
    null,
  );
  assert.equal(
    storage.getItem(storageKey),
    null,
    "an identity-mismatched checkpoint is removed instead of retaining PII",
  );
  writeSubmissionCheckpoint({ storage, storageKey, record });
  assert.equal(
    parseSubmissionCheckpointRecord({
      raw: JSON.stringify(record).replace("안전한 저장본", "변조된 저장본"),
      kind,
      submissionId,
      now: 11_000,
    }),
    null,
  );
  assert.equal(
    parseSubmissionCheckpointRecord({
      raw: JSON.stringify(record),
      kind,
      submissionId,
      now: 20_000,
      maxAgeMs: 5_000,
    }),
    null,
  );
});

test("a quota error keeps the prior recoverable checkpoint intact", () => {
  const storage = new MemoryStorage();
  const first = createSubmissionCheckpointRecord({
    kind,
    submissionId,
    data: { title: "보존할 입력" },
    now: 1_000,
    serverSaved: false,
  });
  writeSubmissionCheckpoint({ storage, storageKey, record: first });
  const rawBeforeFailure = storage.getItem(storageKey);

  storage.failWrites = true;
  const next = updateSubmissionCheckpoint(first, { title: "새 입력" }, 2_000);
  const result = writeSubmissionCheckpoint({ storage, storageKey, record: next });

  assert.equal(result.ok, false);
  assert.equal(storage.getItem(storageKey), rawBeforeFailure);
});

test("checkpoint keys do not replace the existing guest token map key", () => {
  assert.equal(
    storageKey,
    `onside:draft:album:guest:checkpoint:v1:${submissionId}`,
  );
  assert.notEqual(storageKey, "onside:guest-token:album:guest");
});

test("foreground checkpoint operations share one promise queue", () => {
  assert.match(
    checkpointHookSource,
    /const exclusiveQueueRef = React\.useRef<Promise<void>>\(Promise\.resolve\(\)\)/,
  );
  assert.match(
    checkpointHookSource,
    /await previousTask\.catch\(\(\) => undefined\);[\s\S]*return await task\(\);[\s\S]*releaseTask\(\)/,
  );
});
