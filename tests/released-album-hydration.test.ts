import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { albumInfoFromBundle, hydrateReleasedAlbumSubmission, toIsoDate } from "../src/lib/admin/released-album-hydration";

const sid = "11111111-1111-4111-8111-111111111111";

const albumHtml = `
  <div class="section_info">
    <span class="gubun">[싱글]</span>
    <div class="song_name"><strong class="none">앨범명</strong> 어떤 미소</div>
    <div class="artist"><a class="artist_name"><span>장유정</span></a></div>
    <div class="meta"><dl class="list"><dt>발매일</dt><dd>2026.10.30</dd><dt>장르</dt><dd>성인가요/트로트</dd><dt>발매사</dt><dd>테스트 유통</dd><dt>기획사</dt><dd>테스트 기획</dd></dl></div>
    <div class="button d_album_like"></div>
  </div>
  <tr data-group-items="cd1">
    <td><input name="input_check" value="111" title="어떤 미소 곡 선택"></td><td><span class="rank ">1</span></td>
    <td><a href="javascript:melon.link.goSongDetail('111');">곡정보</a></td>
    <td><span title="타이틀 곡" class="bullet_icons title"></span><a href="javascript:melon.play.playSong('28010101',111);" title="어떤 미소 재생">어떤 미소</a><div class="ellipsis rank02"><a class="artist_name">장유정</a></div></td>
  </tr>
`;
const songHtml = `
  <div class="song_name"><strong class="none">곡명</strong> 어떤 미소</div>
  <a class="artist_name"><span>장유정</span></a>
  <div class="lyric" id="d_video_summary">첫 줄<BR>둘째 줄</div>
  <ul class="list_person clfix"><li><a class="artist_name">작사가</a><span class="type">작사</span></li><li><a class="artist_name">작곡가</a><span class="type">작곡</span></li><li><a class="artist_name">편곡가</a><span class="type">편곡</span></li></ul>
`;
const fetcher = (async (input: Parameters<typeof fetch>[0]) => {
  const url = String(input);
  return new Response(url.includes("album") ? albumHtml : songHtml, { status: 200, headers: { "content-type": "text/html" } });
}) as typeof fetch;

type Row = Record<string, unknown>;
function fakeDb(submission: Row, tracks: Row[]) {
  const writes: Array<{ table: string; op: string; payload: unknown }> = [];
  let fetched = 0;
  const db = {
    from(table: string) {
      const chain = {
        _op: "select",
        _payload: undefined as unknown,
        select() { return chain; },
        in() { return chain; },
        eq() { return chain; },
        order() { return chain; },
        update(payload: unknown) { chain._op = "update"; chain._payload = payload; return chain; },
        insert(payload: unknown) { writes.push({ table, op: "insert", payload }); return Promise.resolve({ data: null, error: null }); },
        async maybeSingle() { return { data: table === "submissions" ? submission : null, error: null }; },
        then(resolve: (value: { data: unknown; error: null }) => void) {
          if (chain._op === "update") { writes.push({ table, op: "update", payload: chain._payload }); return resolve({ data: null, error: null }); }
          if (table === "submissions") fetched += 1;
          resolve({ data: table === "submissions" ? [submission] : table === "album_tracks" ? tracks : [], error: null });
        },
      };
      return chain;
    },
  } as unknown as SupabaseClient;
  return { db, writes, reads: () => fetched };
}

test("catalog dates in every common spelling become ISO dates and anything else is dropped", () => {
  assert.equal(toIsoDate("2026.07.21"), "2026-07-21");
  assert.equal(toIsoDate("2026.07.21."), "2026-07-21");
  assert.equal(toIsoDate("2026-7-1"), "2026-07-01");
  assert.equal(toIsoDate("2026년 7월 1일"), "2026-07-01");
  assert.equal(toIsoDate("2026.02.30"), null);
  assert.equal(toIsoDate("미정"), null);
  assert.equal(toIsoDate(undefined), null);
});

test("a hydrated bundle maps to the album-info shape without inventing fields", () => {
  const input = albumInfoFromBundle({
    submission: { id: sid, title: "어떤 미소", artist_name: "장유정", release_date: "2026.10.30", genre: "트로트", distributor: "", production_company: "기획" },
    tracks: [{ track_no: 1, track_title: "어떤 미소", composer: "작곡가", lyricist: "작사가", arranger: "", lyrics: "가사", is_title: true, broadcast_selected: true, notes: "멜론 곡 ID: 111" }, { track_no: 2, track_title: "" }],
    files: [], events: [],
  });
  assert.deepEqual(input.submission, { title: "어떤 미소", artistName: "장유정", artistNameKr: null, artistNameEn: null, releaseDate: "2026-10-30", genre: "트로트", distributor: null, productionCompany: "기획", previousRelease: null, artistType: null, artistGender: null, artistMembers: null });
  assert.equal(input.tracks.length, 1);
  assert.deepEqual(input.tracks[0], { trackNo: 1, trackTitle: "어떤 미소", performer: null, featuring: null, composer: "작곡가", lyricist: "작사가", arranger: null, lyrics: "가사", translatedLyrics: null, notes: "멜론 곡 ID: 111", isTitle: true, broadcastSelected: true });
});

test("hydration completes a released-album request from the catalog, filling blanks and inserting tracks", async () => {
  const submission = { id: sid, type: "ALBUM", is_oneclick: true, melon_url: "https://www.melon.com/album/detail.htm?albumId=14594379", title: "어떤 미소/나에게 꿈이 있어요", artist_name: "장유정", release_date: null, genre: null, distributor: null, production_company: null, previous_release: null, artist_type: null, artist_gender: null, artist_members: null, artist_name_kr: null, artist_name_en: null };
  const { db, writes } = fakeDb(submission, []);
  const result = await hydrateReleasedAlbumSubmission(db, sid, { actorUserId: "admin", fetcher });
  assert.deepEqual(result, { ok: true, changed: true, updatedFields: ["release_date", "genre", "distributor", "production_company"], updatedTracks: 0, insertedTracks: 1 });
  const update = writes.find((w) => w.table === "submissions" && w.op === "update")?.payload as Row;
  // The customer's own title stays; only blank fields are completed.
  assert.deepEqual(update, { release_date: "2026-10-30", genre: "성인가요/트로트", distributor: "테스트 유통", production_company: "테스트 기획" });
  const inserted = (writes.find((w) => w.table === "album_tracks")?.payload as Row[])[0];
  assert.equal(inserted.track_title, "어떤 미소"); assert.equal(inserted.lyrics, "첫 줄\n둘째 줄"); assert.equal(inserted.is_title, true); assert.equal(inserted.title_role, "MAIN"); assert.equal(inserted.lyricist, "작사가");
  const event = writes.find((w) => w.table === "submission_events")?.payload as Row;
  assert.match(String(event.message), /멜론·지니 앨범 정보에서 신청서 정보를 반영했습니다/);
});

test("hydration is skipped for ordinary requests and for complete ones without touching the catalog", async () => {
  let calls = 0;
  const counting = (async (input: Parameters<typeof fetch>[0]) => { calls += 1; return fetcher(input); }) as typeof fetch;
  const ordinary = fakeDb({ id: sid, type: "ALBUM", is_oneclick: false, title: "일반", artist_name: "가수" }, []);
  assert.deepEqual(await hydrateReleasedAlbumSubmission(ordinary.db, sid, { fetcher: counting }), { ok: true, changed: false, skipped: "not-released-album", updatedFields: [], updatedTracks: 0, insertedTracks: 0 });
  const complete = fakeDb({ id: sid, type: "ALBUM", is_oneclick: true, melon_url: "https://www.melon.com/album/detail.htm?albumId=1", title: "앨범", artist_name: "가수", release_date: "2026-01-01", genre: "장르", distributor: "유통", production_company: "제작" },
    [{ submission_id: sid, track_no: 1, track_title: "곡", composer: "작곡", lyricist: "작사", arranger: "편곡", lyrics: "가사" }]);
  assert.deepEqual(await hydrateReleasedAlbumSubmission(complete.db, sid, { fetcher: counting }), { ok: true, changed: false, skipped: "complete", updatedFields: [], updatedTracks: 0, insertedTracks: 0 });
  assert.equal(calls, 0);
  assert.equal(ordinary.writes.length + complete.writes.length, 0);
  const broken = fakeDb({ id: sid, type: "ALBUM", is_oneclick: true, melon_url: "https://example.invalid/not-a-catalog", title: "앨범", artist_name: "가수" }, []);
  const failed = await hydrateReleasedAlbumSubmission(broken.db, sid, { fetcher: counting });
  assert.equal(failed.ok, false); assert.equal(broken.writes.length, 0);
});
