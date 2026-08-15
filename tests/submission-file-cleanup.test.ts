import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  cleanupUnreferencedSubmissionB2Objects,
  deleteObjectKeysBestEffort,
  excludeReferencedObjectKeys,
  parseSubmissionB2ObjectRefs,
  selectDeletedSubmissionObjectKeys,
} from "../src/lib/submission-file-cleanup";

const read = (relativePath: string) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("B2 cleanup metadata accepts only explicit B2 object keys and deduplicates rows", () => {
  assert.deepEqual(
    parseSubmissionB2ObjectRefs(
      [
        {
          submission_id: "submission-a",
          storage_provider: "b2",
          object_key: " submissions/member/title/submission-a/file.wav ",
        },
        {
          submission_id: "submission-a",
          storage_provider: "B2",
          object_key: "submissions/member/title/submission-a/file.wav",
        },
        {
          submission_id: "submission-b",
          storage_provider: "supabase",
          object_key: "submissions/member/title/submission-b/file.wav",
        },
        {
          submission_id: "submission-c",
          storage_provider: "b2",
          object_key: null,
        },
        {
          submission_id: "submission-d",
          storage_provider: "b2",
          object_key: "submissions/member/title/someone-else/file.wav",
        },
      ],
      "submissions/",
    ),
    [
      {
        submissionId: "submission-a",
        objectKey: "submissions/member/title/submission-a/file.wav",
      },
    ],
  );
});

test("B2 cleanup selects only confirmed-deleted submission objects", () => {
  const refs = parseSubmissionB2ObjectRefs(
    [
      {
        submission_id: "submission-a",
        storage_provider: "b2",
        object_key: "submissions/member/title/submission-a/file.wav",
      },
      {
        submission_id: "submission-b",
        storage_provider: "b2",
        object_key: "submissions/member/title/submission-b/file.wav",
      },
    ],
    "submissions",
  );

  assert.deepEqual(selectDeletedSubmissionObjectKeys(refs, ["submission-a"]), [
    "submissions/member/title/submission-a/file.wav",
  ]);
});

test("B2 cleanup preserves keys that still have a database reference", () => {
  assert.deepEqual(
    excludeReferencedObjectKeys(
      ["shared-object", "deleted-only-object"],
      ["shared-object"],
    ),
    ["deleted-only-object"],
  );
});

test("B2 object deletion contains individual failures and continues", async () => {
  const attempted: string[] = [];
  const originalConsoleError = console.error;
  console.error = () => undefined;
  const result = await deleteObjectKeysBestEffort(
    ["first", "second", "first", "third"],
    async (objectKey) => {
      attempted.push(objectKey);
      if (objectKey === "second") throw new Error("simulated storage outage");
    },
  ).finally(() => {
    console.error = originalConsoleError;
  });

  assert.deepEqual(new Set(attempted), new Set(["first", "second", "third"]));
  assert.deepEqual(result, { deleted: 2, failed: 1 });
});

test("replacement cleanup deletes only captured keys with no surviving metadata reference", async () => {
  const deleted: string[] = [];
  const admin = {
    from: (table: string) => ({
      select: () => ({
        in: async () => ({
          data:
            table === "submission_files"
              ? [{ object_key: "submissions/member/title/a/shared.wav" }]
              : [{ object_key: "submissions/member/title/a/staged.wav" }],
          error: null,
        }),
      }),
    }),
  };

  const result = await cleanupUnreferencedSubmissionB2Objects(
    admin as never,
    [
      {
        submissionId: "a",
        objectKey: "submissions/member/title/a/shared.wav",
      },
      {
        submissionId: "a",
        objectKey: "submissions/member/title/a/replaced.wav",
      },
      {
        submissionId: "a",
        objectKey: "submissions/member/title/a/staged.wav",
      },
    ],
    async (objectKey) => {
      deleted.push(objectKey);
    },
  );

  assert.deepEqual(deleted, ["submissions/member/title/a/replaced.wav"]);
  assert.deepEqual(result, { deleted: 1, failed: 0, preserved: 2 });
});

test("hard-delete routes snapshot B2 metadata and defer cleanup until after deletion", () => {
  for (const path of [
    "src/app/api/cart/items/route.ts",
    "src/app/api/submissions/delete/route.ts",
  ]) {
    const source = read(path);
    const loadIndex = source.lastIndexOf("loadSubmissionB2ObjectRefs(");
    const deleteIndex = source.indexOf('.from("submissions")', loadIndex);
    const cleanupIndex = source.lastIndexOf(
      "cleanupDeletedSubmissionB2Objects(",
    );

    assert.match(source, /import \{ after, NextResponse \} from "next\/server"/);
    assert.ok(loadIndex >= 0, `${path}: missing pre-delete B2 snapshot`);
    assert.ok(deleteIndex > loadIndex, `${path}: snapshot must precede delete`);
    assert.ok(cleanupIndex > deleteIndex, `${path}: cleanup must follow delete`);
    assert.match(source, /after\(\(\) =>[\s\S]*cleanupDeletedSubmissionB2Objects/);
  }

  const draftRoute = read("src/app/api/submissions/drafts/route.ts");
  const atomicDeleteIndex = draftRoute.indexOf(
    'rpc("delete_submission_drafts_atomic"',
  );
  const returnedRefsIndex = draftRoute.indexOf(
    "result?.b2ObjectRefs",
    atomicDeleteIndex,
  );
  const cleanupIndex = draftRoute.lastIndexOf(
    "cleanupDeletedSubmissionB2Objects(",
  );
  assert.ok(atomicDeleteIndex >= 0, "draft delete must use the atomic RPC");
  assert.ok(
    returnedRefsIndex > atomicDeleteIndex,
    "draft delete must consume the RPC's pre-delete B2 snapshot",
  );
  assert.ok(cleanupIndex > returnedRefsIndex);
  assert.match(
    draftRoute,
    /after\(\(\) =>[\s\S]*cleanupDeletedSubmissionB2Objects/,
  );
});

test("admin hard-delete cleanup uses only database-confirmed deleted IDs", () => {
  const source = read("src/features/admin/actions.ts");
  const actionStart = source.indexOf(
    "export async function deleteSubmissionsAction",
  );
  const actionEnd = source.indexOf(
    "export async function deleteSubmissionsFormAction",
    actionStart,
  );
  const action = source.slice(actionStart, actionEnd);

  const authIndex = action.indexOf("await requireAdminAction()");
  const loadIndex = action.indexOf("loadSubmissionB2ObjectRefs(");
  const deleteIndex = action.indexOf('.from("submissions")', loadIndex);
  const confirmedIdsIndex = action.indexOf(
    "const deletedIds = (deletedRows ?? [])",
  );
  const cleanupIndex = action.indexOf(
    "cleanupDeletedSubmissionB2Objects(",
  );

  assert.ok(authIndex >= 0);
  assert.ok(loadIndex > authIndex);
  assert.ok(deleteIndex > loadIndex);
  assert.match(action, /\.delete\(\)[\s\S]*\.select\("id"\)/);
  assert.ok(confirmedIdsIndex > deleteIndex);
  assert.ok(cleanupIndex > confirmedIdsIndex);
  assert.match(
    action,
    /cleanupDeletedSubmissionB2Objects\(supabase, b2ObjectRefs, deletedIds\)/,
  );
});
