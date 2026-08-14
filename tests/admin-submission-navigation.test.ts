import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildAdminSubmissionDetailPath,
  safeAdminSubmissionsReturnTo,
} from "../src/lib/admin/submission-navigation";

const readSource = (relativePath: string) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("admin submission returnTo preserves only supported list filters", () => {
  assert.equal(
    safeAdminSubmissionsReturnTo(
      "/admin/submissions?q=%20artist%20&status=IN_PROGRESS&payment=PAID&origin=global&from=2026-08-01&to=2026-08-15&page=3&type=MV_BROADCAST&ignored=1#row",
    ),
    "/admin/submissions?q=artist&status=IN_PROGRESS&payment=PAID&origin=global&from=2026-08-01&to=2026-08-15&page=3&type=MV_BROADCAST",
  );
});

test("admin submission returnTo blocks external and unrelated redirects", () => {
  for (const value of [
    "https://evil.example/admin/submissions",
    "//evil.example/admin/submissions",
    "/admin/users",
    "/admin/submissions/00000000-0000-0000-0000-000000000000",
    "javascript:alert(1)",
  ]) {
    assert.equal(
      safeAdminSubmissionsReturnTo(value),
      "/admin/submissions",
    );
  }
});

test("admin detail paths keep safe returnTo through save state", () => {
  const detailPath = buildAdminSubmissionDetailPath({
    submissionId: "00000000-0000-0000-0000-000000000000",
    returnTo: "/admin/submissions?q=demo&page=2&type=ALBUM",
    state: { saved: "status", savedWarning: undefined },
  });
  const url = new URL(detailPath, "https://onside.local");

  assert.equal(url.pathname, "/admin/submissions/00000000-0000-0000-0000-000000000000");
  assert.equal(url.searchParams.get("saved"), "status");
  assert.equal(
    url.searchParams.get("returnTo"),
    "/admin/submissions?q=demo&page=2&type=ALBUM",
  );
});

test("admin list and detail forms keep the filtered return path wired", () => {
  const listPage = readSource("src/app/admin/submissions/page.tsx");
  const detailPage = readSource("src/app/admin/submissions/detail/page.tsx");
  const actions = readSource("src/features/admin/actions.ts");

  assert.match(listPage, /href=\{buildDetailHref\(submission\.id\)\}/);
  assert.match(
    detailPage,
    /name="returnTo" value=\{adminSubmissionListHref\}/,
  );
  assert.match(detailPage, /returnTo=\{adminSubmissionListHref\}/);
  assert.match(actions, /buildSubmissionFormRedirect\(formData, submissionId/);
});
