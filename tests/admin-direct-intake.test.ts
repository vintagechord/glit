import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { legacyWordBlocksToDocx, LegacyWordError, readLegacyWordBlocks } from "../src/lib/admin/legacy-word-doc";
import { analyzeReferenceFile, ReferenceImportError, stripFormGuidance } from "../src/lib/admin/reference-import";
import { buildGuestMvIntakeParent, directIntakeSchema, mvIntakeAmountKrw } from "../src/lib/admin/direct-intake";
import { extractDocxBlocks } from "../src/lib/review-docs/docx-extract";

const form = (name: string) => readFileSync(new URL(`../public/forms/${name}`, import.meta.url));
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the legacy Word reader keeps the application form's table rows", () => {
  const blocks = readLegacyWordBlocks(form("Onside_music_application_word_form.doc"));
  const rows = blocks.filter((block) => block.kind === "row");
  assert.ok(rows.length >= 8, "form tables must stay tables");
  assert.ok(rows.some((row) => row.kind === "row" && row.cells[0] === "음반명" && row.cells[2] === "소속사"));
  assert.ok(rows.some((row) => row.kind === "row" && row.cells[0] === "곡명" && row.cells[2] === "작사자"));

  const docx = legacyWordBlocksToDocx(blocks);
  const reread = extractDocxBlocks(docx).blocks.filter((block) => block.cells);
  assert.equal(reread.length, rows.length, "the generated DOCX must be readable by the shared DOCX reader");
});

test("the legacy Word reader refuses non-Word input with a coded error", () => {
  assert.throws(() => readLegacyWordBlocks(form("Onside_music_application_hangul_form.hwp")), (error: unknown) =>
    error instanceof LegacyWordError && error.code === "FORMAT_MISMATCH");
  assert.throws(() => readLegacyWordBlocks(Buffer.from("not a document")), (error: unknown) => error instanceof LegacyWordError);
});

test("DOC and HWP versions of the same blank form give the same draft", async () => {
  for (const [doc, hwp, kind] of [
    ["Onside_music_application_word_form.doc", "Onside_music_application_hangul_form.hwp", "ALBUM"],
    ["Onside_MVapplication_word_form.doc", "Onside_MVapplication_hangul_form.hwp", "MV_DISTRIBUTION"],
  ] as const) {
    const fromDoc = await analyzeReferenceFile({ body: form(doc), fileName: doc, kind });
    const fromHwp = await analyzeReferenceFile({ body: form(hwp), fileName: hwp, kind });
    assert.equal(fromDoc.format, "doc");
    assert.deepEqual(fromDoc.album, fromHwp.album, `${kind} album fields`);
    assert.deepEqual(fromDoc.mv, fromHwp.mv, `${kind} mv fields`);
    // A blank form carries only guidance, which must not become data.
    assert.equal(fromDoc.album.title, "");
    assert.equal(fromDoc.album.genre, "");
    assert.equal(fromDoc.album.artistType, "");
    assert.equal(fromDoc.mv.director, "");
    assert.equal(fromDoc.mv.storyline, "");
    assert.equal(fromDoc.tracks.length, 0);
  }
});

test("form guidance is removed line by line, lyrics keep ordinary requests", () => {
  assert.deepEqual(stripFormGuidance("그룹일 경우 팀원이름을 적어주세요.\n그룹 (A, B)"), { value: "그룹 (A, B)", removed: true });
  assert.deepEqual(stripFormGuidance("ex)발라드 등"), { value: "", removed: true });
  assert.deepEqual(stripFormGuidance("작곡"), { value: "", removed: true });
  assert.deepEqual(stripFormGuidance("발라드"), { value: "발라드", removed: false });
  const lyric = "나를 안아 주세요.\n※ 유의사항\n천천히 걸어요";
  assert.equal(stripFormGuidance(lyric, { long: true }).value, "나를 안아 주세요.\n천천히 걸어요");
});

test("unsupported reference files are refused before parsing", async () => {
  await assert.rejects(
    analyzeReferenceFile({ body: Buffer.from("%PDF-1.7"), fileName: "form.pdf", kind: "ALBUM" }),
    (error: unknown) => error instanceof ReferenceImportError && error.code === "UNSUPPORTED_FORMAT",
  );
});

test("MV prices and stations follow the wizard's table", () => {
  assert.deepEqual(mvIntakeAmountKrw("MV_DISTRIBUTION", []), { codes: [], amountKrw: 30_000 });
  assert.deepEqual(mvIntakeAmountKrw("MV_DISTRIBUTION", ["mnet", "MNET"]), { codes: ["MNET"], amountKrw: 60_000 });
  assert.deepEqual(mvIntakeAmountKrw("MV_BROADCAST", ["KBS", "SBS"]), { codes: ["KBS", "SBS"], amountKrw: 80_000 });
  assert.equal(mvIntakeAmountKrw("MV_BROADCAST", []), null);
  assert.equal(mvIntakeAmountKrw("MV_BROADCAST", ["MNET"]), null);
  assert.equal(mvIntakeAmountKrw("MV_DISTRIBUTION", ["KBS"]), null);
  // ETN is a broadcast delivery (입고) only since 2026-11-07.
  assert.equal(mvIntakeAmountKrw("MV_DISTRIBUTION", ["ETN"]), null);
  assert.deepEqual(mvIntakeAmountKrw("MV_BROADCAST", ["ETN"]), { codes: ["ETN"], amountKrw: 30_000 });
});

test("the intake request validates album and MV drafts", () => {
  const guest = { name: "고객", phone: "", email: "", company: "" };
  const album = directIntakeSchema.safeParse({
    kind: "ALBUM", requestId: "11111111-1111-4111-8111-111111111111", packageId: "22222222-2222-4222-8222-222222222222", paid: true, guest,
    submission: { title: "앨범", artistName: "가수", releaseDate: null, artistType: null },
    tracks: [{ trackTitle: "곡", isTitle: true, broadcastSelected: false }],
  });
  assert.equal(album.success, true);
  const mv = directIntakeSchema.safeParse({
    kind: "MV_DISTRIBUTION", requestId: "11111111-1111-4111-8111-111111111111", paid: false, stationCodes: [], guest,
    mv: { title: "HUG", artistName: "가수", releaseDate: "", productionDate: "2026-10-20", desiredRating: "전체" },
  });
  assert.equal(mv.success, true);
  if (mv.success && mv.data.kind !== "ALBUM") {
    const parent = buildGuestMvIntakeParent(mv.data, null);
    assert.equal(parent.mv_desired_rating, "전체관람가");
    assert.equal(parent.release_date, null);
    assert.equal(parent.applicant_name, "고객");
  }
  assert.equal(directIntakeSchema.safeParse({ kind: "MV_BROADCAST", requestId: "x", paid: true, guest, mv: { title: "a", artistName: "b" } }).success, false);
  assert.equal(directIntakeSchema.safeParse({ kind: "ALBUM", requestId: "11111111-1111-4111-8111-111111111111", packageId: "22222222-2222-4222-8222-222222222222", paid: true, guest, submission: { title: "앨범", artistName: "가수" }, tracks: [] }).success, false);
});

test("the guest MV registration is one admin-only transaction mirroring the album intake", () => {
  const sql = read("supabase/migrations/20261105120000_admin_guest_mv_intake.sql");
  assert.match(sql, /profiles where user_id=p_actor_user_id and role='admin'/);
  assert.match(sql, /where s\.guest_token=p_guest_token;\s+if found then/);
  assert.match(sql, /array\['KBS','MBC','SBS','ETN'\] else array\['MNET','ETN'\]/);
  // The latest definition keeps ETN out of online distribution intake.
  const latest = read("supabase/migrations/20261107120000_mv_online_without_etn.sql");
  assert.match(latest, /create or replace function public\.admin_register_guest_mv\(/);
  assert.match(latest, /array\['KBS','MBC','SBS','ETN'\] else array\['MNET'\] end;/);
  assert.match(latest, /revoke all on function public\.admin_register_guest_mv\([^)]*\) from public,anon,authenticated;/);
  assert.match(latest, /grant execute on function public\.admin_register_guest_mv\([^)]*\) to service_role;/);
  assert.match(sql, /revoke all on function public\.admin_register_guest_mv\([^)]*\) from public,anon,authenticated;/);
  assert.match(sql, /grant execute on function public\.admin_register_guest_mv\([^)]*\) to service_role;/);
});

test("the intake routes authorize the administrator before reading input", () => {
  for (const path of ["src/app/api/admin/intake/route.ts", "src/app/api/admin/intake/analyze/route.ts"]) {
    const source = read(path);
    for (const handler of source.split("export async function").slice(1)) {
      const auth = handler.indexOf("requireAdminForApi()");
      assert.ok(auth >= 0, `${path} handler must authorize`);
      for (const read of ["formData()", "readBoundedJsonBody(", "createAdminClient()"]) {
        const index = handler.indexOf(read);
        if (index >= 0) assert.ok(index > auth, `${path} reads ${read} only after authorization`);
      }
    }
  }
});

test("the dashboard moved the link-based review docs to their own page", () => {
  const home = read("src/app/admin/page.tsx");
  assert.doesNotMatch(home, /MelonReviewDocsDownloadForm/);
  assert.match(home, /href: "\/admin\/review-docs\/links", label: "멜론\/지니 링크 심의자료 생성"/);
  assert.match(home, /href: "\/admin\/intake", label: "관리자 직접 접수"/);
  assert.match(read("src/app/admin/review-docs/links/page.tsx"), /<MelonReviewDocsDownloadForm \/>/);
});
