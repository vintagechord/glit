import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20261103160000_submission_admin_memos.sql");

test("staff notes move to a table only the service role can read", () => {
  assert.match(migration, /create table if not exists public\.submission_admin_memos/);
  assert.match(migration, /alter table public\.submission_admin_memos enable row level security;/);
  assert.match(migration, /revoke all on public\.submission_admin_memos from public, anon, authenticated;/);
  assert.match(migration, /grant select, insert, update, delete on public\.submission_admin_memos to service_role;/);
  assert.doesNotMatch(migration, /grant [^;]*submission_admin_memos to (?:anon|authenticated)/);
  assert.match(migration, /using \(public\.is_admin\(\)\)\s*with check \(public\.is_admin\(\)\)/);
  // Existing notes are copied, then the readable column is emptied.
  assert.match(migration, /insert into public\.submission_admin_memos \(submission_id, memo, updated_at\)\s*select s\.id, s\.admin_memo/);
  assert.match(migration, /update public\.submissions\s+set admin_memo = null\s+where admin_memo is not null;/);
  assert.ok(migration.indexOf("disable trigger user") < migration.indexOf("set admin_memo = null"));
  assert.ok(migration.indexOf("set admin_memo = null") < migration.indexOf("enable trigger user"));
});

test("old RPC writes to submissions.admin_memo are routed into the private table after the privileged-field guard", () => {
  assert.match(migration, /create trigger route_submission_admin_memo\s+before insert or update of admin_memo on public\.submissions\s+for each row\s+when \(new\.admin_memo is not null\)/);
  // BEFORE triggers fire in name order; the guard must run first.
  assert.ok("protect_submission_privileged_fields" < "route_submission_admin_memo");
  assert.match(migration, /new\.admin_memo := null;/);
  assert.match(migration, /security definer\s+set search_path = ''/);
  assert.match(migration, /if coalesce\(auth\.role\(\), ''\) <> 'service_role' and not public\.is_admin\(\) then/);
  // Unrelated text (a refund line) is appended; a prefilled edit replaces.
  assert.match(migration, /starts_with\(v_incoming, btrim\(v_existing\)\) then v_incoming\s+else v_existing \|\| E'\\n' \|\| v_incoming/);
  assert.match(migration, /deferrable initially deferred/, "the guest intake inserts the note in the same statement as the submission");
  assert.match(migration, /revoke all on function public\.route_submission_admin_memo\(\) from public, anon, authenticated;/);
});

test("no later migration grants the memo table to browser roles", () => {
  const files = readdirSync(new URL("../supabase/migrations/", import.meta.url)).filter((name) => name.endsWith(".sql") && name > "20261103160000");
  for (const file of files) {
    const sql = read(`supabase/migrations/${file}`);
    assert.doesNotMatch(sql, /grant [^;]*submission_admin_memos[^;]*to (?:anon|authenticated)/, file);
  }
});

test("admin code reads and writes staff notes only through the private table", () => {
  const actions = read("src/features/admin/actions.ts");
  assert.doesNotMatch(actions.replace(/\/\/.*$/gm, ""), /admin_memo/, "admin actions must not write or read submissions.admin_memo");
  assert.match(actions, /saveSubmissionAdminMemo\(/);
  assert.match(actions, /loadSubmissionAdminMemo\(/);
  const detail = read("src/app/admin/submissions/detail/page.tsx");
  assert.match(detail, /loadSubmissionAdminMemo\(supabase, submission\.id\)/);
  assert.match(detail, /disabled=\{adminMemoUnavailable\}/, "an unloaded note is not submitted, so it cannot be cleared");
  const helper = read("src/lib/admin/submission-admin-memo.ts");
  assert.match(helper, /"submission_admin_memos"/);
  assert.match(helper, /onConflict: "submission_id"/);
  // The customer detail select never asks for the note.
  const columns = read("src/lib/submissions/select-columns.ts");
  const userSelect = columns.slice(columns.indexOf("SUBMISSION_USER_DETAIL_SELECT"), columns.indexOf("SUBMISSION_ADMIN_DETAIL_SELECT"));
  assert.doesNotMatch(userSelect, /admin_memo/);
});
