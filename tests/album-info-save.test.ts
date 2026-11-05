import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { albumInfoSchema, saveManagedAlbumInfo } from "../src/lib/admin/album-info-save";

const sid = "11111111-1111-4111-8111-111111111111";

type Row = Record<string, unknown>;
/** A minimal query recorder: selects answer from fixtures; updates and inserts are captured. */
function fakeDb(fixture: { submission: Row | null; tracks: Row[] }) {
  const writes: Array<{ table: string; op: "update" | "insert"; payload: unknown; id?: string }> = [];
  const db = {
    from(table: string) {
      const chain = {
        _op: "select" as "select" | "update" | "insert",
        _payload: undefined as unknown,
        _id: undefined as string | undefined,
        select() { return chain; },
        eq(column: string, value: string) { if (column === "id") chain._id = value; return chain; },
        order() { return chain; },
        update(payload: unknown) { chain._op = "update"; chain._payload = payload; return chain; },
        insert(payload: unknown) { chain._op = "insert"; chain._payload = payload; writes.push({ table, op: "insert", payload }); return Promise.resolve({ data: null, error: null }); },
        async maybeSingle() { return { data: table === "submissions" ? fixture.submission : null, error: null }; },
        then(resolve: (value: { data: unknown; error: null }) => void) {
          if (chain._op === "update") writes.push({ table, op: "update", payload: chain._payload, id: chain._id });
          resolve({ data: chain._op === "select" ? (table === "album_tracks" ? fixture.tracks : null) : null, error: null });
        },
      };
      return chain;
    },
  } as unknown as SupabaseClient;
  return { db, writes };
}

const base = { id: sid, type: "ALBUM", title: "지금이 딱 좋아", artist_name: "김수련", artist_name_kr: null, artist_name_en: null, release_date: null, genre: "성인가요", distributor: "오감 엔터테인먼트", production_company: null, previous_release: null, artist_type: "GROUP", artist_gender: null, artist_members: null };
const existingTracks = [
  { id: "t1", track_no: 1, track_title: "지금이 딱 좋아", performer: "김수련", featuring: null, composer: "김수련", lyricist: null, arranger: null, lyrics: null, translated_lyrics: null, notes: null, is_title: false, title_role: null, broadcast_selected: false },
  { id: "t2", track_no: 2, track_title: "지금이 딱 좋아 (MR)", performer: "김수련", featuring: null, composer: "김수련", lyricist: null, arranger: null, lyrics: "MR", translated_lyrics: null, notes: null, is_title: false, title_role: null, broadcast_selected: false },
];

test("overwrite applies provided values, keeps untouched columns, and marks the first title track MAIN", async () => {
  const { db, writes } = fakeDb({ submission: base, tracks: existingTracks });
  const input = albumInfoSchema.parse({
    submission: { releaseDate: "2026-11-05", genre: "성인가요", distributor: "오감 엔터테인먼트", productionCompany: "OK엔터테인먼트", artistType: "SOLO", title: "" },
    tracks: [
      { trackNo: 1, trackTitle: "지금이 딱 좋아", lyricist: "김수련", arranger: "영앤리치", lyrics: "가사", isTitle: true, broadcastSelected: true },
      { trackNo: 2, trackTitle: "지금이 딱 좋아 (MR)", composer: "김수련" },
      { trackNo: 3, trackTitle: "보너스", isTitle: true },
    ],
  });
  const result = await saveManagedAlbumInfo(db, { submissionId: sid, actorUserId: "admin", input, mode: "overwrite", source: "심의 데스크" });
  assert.deepEqual(result, { ok: true, changed: true, updatedFields: ["release_date", "production_company", "artist_type"], updatedTracks: 1, insertedTracks: 1 });
  const submissionUpdate = writes.find((w) => w.table === "submissions" && w.op === "update");
  assert.deepEqual(submissionUpdate?.payload, { release_date: "2026-11-05", production_company: "OK엔터테인먼트", artist_type: "SOLO" });
  const trackUpdates = writes.filter((w) => w.table === "album_tracks" && w.op === "update");
  assert.equal(trackUpdates.length, 1); assert.equal(trackUpdates[0].id, "t1");
  assert.deepEqual(trackUpdates[0].payload, { lyricist: "김수련", arranger: "영앤리치", lyrics: "가사", is_title: true, title_role: "MAIN", broadcast_selected: true });
  const inserts = writes.filter((w) => w.table === "album_tracks" && w.op === "insert");
  assert.equal(inserts.length, 1);
  const inserted = (inserts[0].payload as Row[])[0];
  assert.equal(inserted.track_no, 3); assert.equal(inserted.title_role, "SUB"); assert.equal(inserted.performer, "김수련"); assert.equal(inserted.submission_id, sid);
  const event = writes.find((w) => w.table === "submission_events");
  assert.match(String((event?.payload as Row).message), /심의 데스크에서 신청서 정보를 반영했습니다/);
  assert.equal((event?.payload as Row).actor_user_id, "admin");
});

test("fill-empty never replaces an existing value and reports no change when nothing was blank", async () => {
  const { db, writes } = fakeDb({ submission: { ...base, release_date: "2026-01-01", production_company: "기존 제작사" }, tracks: existingTracks });
  const input = albumInfoSchema.parse({
    submission: { releaseDate: "2026-11-05", productionCompany: "멜론 제작사", distributor: "멜론 유통사", artistNameEn: "Kim Suryeon" },
    tracks: [{ trackNo: 2, trackTitle: "다른 제목", composer: "다른 작곡", lyricist: "멜론 작사", lyrics: "멜론 가사", isTitle: false }],
  });
  const result = await saveManagedAlbumInfo(db, { submissionId: sid, actorUserId: null, input, mode: "fill-empty", source: "멜론·지니 앨범 정보" });
  assert.equal(result.ok, true);
  assert.deepEqual(writes.find((w) => w.table === "submissions")?.payload, { artist_name_en: "Kim Suryeon" });
  assert.deepEqual(writes.find((w) => w.table === "album_tracks")?.payload, { lyricist: "멜론 작사" });
  const again = fakeDb({ submission: { ...base, release_date: "2026-01-01", production_company: "기존 제작사", artist_name_en: "Kim Suryeon" }, tracks: existingTracks });
  const unchanged = await saveManagedAlbumInfo(again.db, { submissionId: sid, actorUserId: null, input: albumInfoSchema.parse({ submission: { releaseDate: "2026-11-05", artistNameEn: "Kim Suryeon" } }), mode: "fill-empty", source: "멜론·지니 앨범 정보" });
  assert.deepEqual(unchanged, { ok: true, changed: false, updatedFields: [], updatedTracks: 0, insertedTracks: 0 });
  assert.equal(again.writes.length, 0);
});

test("only album submissions accept application details and the schema rejects bad dates", async () => {
  const { db, writes } = fakeDb({ submission: { ...base, type: "MV_DISTRIBUTION" }, tracks: [] });
  const refused = await saveManagedAlbumInfo(db, { submissionId: sid, actorUserId: "admin", input: albumInfoSchema.parse({}), mode: "overwrite", source: "관리자 페이지" });
  assert.deepEqual(refused, { ok: false, errorCode: "INVALID_TYPE", error: "음반 접수에만 신청서 정보를 반영할 수 있습니다." });
  assert.equal(writes.length, 0);
  const missing = fakeDb({ submission: null, tracks: [] });
  assert.equal((await saveManagedAlbumInfo(missing.db, { submissionId: sid, actorUserId: "admin", input: albumInfoSchema.parse({}), mode: "overwrite", source: "관리자 페이지" })).ok, false);
  assert.equal(albumInfoSchema.safeParse({ submission: { releaseDate: "2026.11.05" } }).success, false);
  assert.equal(albumInfoSchema.safeParse({ submission: { artistType: "DUO" } }).success, false);
  assert.equal(albumInfoSchema.safeParse({ tracks: [{ trackNo: 0, trackTitle: "x" }] }).success, false);
  assert.deepEqual(albumInfoSchema.parse({ submission: { genre: "  ", releaseDate: "" } }).submission.genre, null);
});

test("a sync that marks no 원음방송 song keeps the selection made on the admin page", async () => {
  const selected = existingTracks.map((track, index) => ({ ...track, broadcast_selected: index === 0 }));
  const { db, writes } = fakeDb({ submission: base, tracks: selected });
  const input = albumInfoSchema.parse({
    tracks: [
      { trackNo: 1, trackTitle: "지금이 딱 좋아", broadcastSelected: false },
      { trackNo: 2, trackTitle: "지금이 딱 좋아 (MR)", broadcastSelected: false },
    ],
  });
  await saveManagedAlbumInfo(db, { submissionId: sid, actorUserId: "admin", input, mode: "overwrite", source: "심의 데스크" });
  assert.equal(writes.some((w) => w.table === "album_tracks" && JSON.stringify(w.payload).includes("broadcast_selected")), false);

  // A sync that carries its own selection still replaces it.
  const next = fakeDb({ submission: base, tracks: selected });
  await saveManagedAlbumInfo(next.db, { submissionId: sid, actorUserId: "admin", input: albumInfoSchema.parse({
    tracks: [{ trackNo: 1, trackTitle: "지금이 딱 좋아", broadcastSelected: false }, { trackNo: 2, trackTitle: "지금이 딱 좋아 (MR)", broadcastSelected: true }],
  }), mode: "overwrite", source: "심의 데스크" });
  const updates = next.writes.filter((w) => w.table === "album_tracks" && w.op === "update");
  assert.deepEqual(updates.map((w) => [w.id, w.payload]), [["t1", { broadcast_selected: false }], ["t2", { broadcast_selected: true }]]);
});

test("filling blanks from Melon/Genie never adds songs to an existing 원음방송 selection", async () => {
  const selected = existingTracks.map((track, index) => ({ ...track, broadcast_selected: index === 1 }));
  const { db, writes } = fakeDb({ submission: base, tracks: selected });
  await saveManagedAlbumInfo(db, { submissionId: sid, actorUserId: null, input: albumInfoSchema.parse({
    tracks: [{ trackNo: 1, trackTitle: "지금이 딱 좋아", isTitle: true, broadcastSelected: true }],
  }), mode: "fill-empty", source: "멜론·지니 앨범 정보" });
  assert.equal(writes.some((w) => w.table === "album_tracks" && JSON.stringify(w.payload).includes("broadcast_selected")), false);
});
