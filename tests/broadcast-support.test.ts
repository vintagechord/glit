import assert from "node:assert/strict";
import test from "node:test";
import { buildBroadcastCredits, buildBroadcastResultCsv, buildRadioRequest, getBroadcastTracks, type BroadcastSubmission } from "../src/lib/broadcast-support";
import { resolveRadioBoardLinks } from "../src/lib/radio-board-links";
import { getRadioStationGuide } from "../src/lib/radio-station-guide";

const submission: BroadcastSubmission = { id: "demo", title: "앨범", artist_name: "뮤지션", album_tracks: [
  { id: "one", track_no: 1, track_title: "첫 곡", composer: "작곡가" },
  { id: "two", track_no: 2, track_title: "둘째 곡" },
] };

test("radio requests only use tracks approved by the selected broadcaster", () => {
  const rows = getBroadcastTracks(submission, { id: "kbs", status: "APPROVED", track_results: [{ track_id: "one", status: "APPROVED" }, { track_id: "two", status: "REJECTED" }] });
  assert.deepEqual(rows.map(row => row.status), ["APPROVED", "REJECTED"]);
  assert.deepEqual(getBroadcastTracks(submission, { id: "mbc", status: "SENT", track_results: [{ track_id: "two", status: "APPROVED" }] }).map(row => row.status), ["PENDING", "APPROVED"]);
});

test("correction requests and station rejection cannot enable song requests", () => {
  for (const status of ["NEEDS_FIX", "REJECTED"]) {
    assert.ok(getBroadcastTracks(submission, { id: "r", status, track_results: [{ track_id: "one", status: "APPROVED" }] }).every(row => row.status !== "APPROVED"));
  }
});

test("legacy station-wide approval can prepare all selected tracks", () => {
  assert.deepEqual(getBroadcastTracks(submission, { id: "r", status: "APPROVED" }).map(row => row.status), ["APPROVED", "APPROVED"]);
});

test("legacy named result snapshots restore songs and individual decisions without album metadata", () => {
  const legacySubmission = { ...submission, album_tracks: [] };
  const review = { id: "r", status: "APPROVED", station: { code: "KBS" }, track_results: JSON.stringify([
    { track_id: "one", track_no: 1, title: "첫 곡", status: "APPROVED" },
    { track_id: "two", track_no: 2, title: "둘째 곡", status: "REJECTED" },
    { track_no: 3, title: "아직 심의 중인 곡", status: "PENDING" },
  ]) };
  const rows = getBroadcastTracks(legacySubmission, review);
  assert.deepEqual(rows.map(row => [row.track.track_title, row.status]), [
    ["첫 곡", "APPROVED"], ["둘째 곡", "REJECTED"], ["아직 심의 중인 곡", "PENDING"],
  ]);
  assert.equal(rows[0].track.id, "one");
  assert.equal(buildRadioRequest({ submission: legacySubmission, track: rows[0].track }).title, "[신청곡] 뮤지션 - 첫 곡");
  const csv = buildBroadcastResultCsv(legacySubmission, [review]);
  assert.match(csv, /"첫 곡","뮤지션","적격"/);
  assert.match(csv, /"둘째 곡","뮤지션","부적격"/);
});

test("legacy fallback never invents song names or decisions from workflow and album metadata", () => {
  const legacySubmission = { ...submission, album_tracks: null };
  for (const status of ["APPROVED", "COMPLETED", "RESULT_READY"]) {
    assert.deepEqual(getBroadcastTracks(legacySubmission, { id: "r", status }), []);
    const rows = getBroadcastTracks(legacySubmission, { id: "r", status, track_results: [
      { track_id: "one", status: "APPROVED" },
      { title: "  ", status: "APPROVED" },
      { title: "결정 없는 곡" },
    ] });
    assert.deepEqual(rows.map(row => [row.track.track_title, row.status]), [["결정 없는 곡", "PENDING"]]);
  }
});

test("legacy snapshot approvals remain blocked by station rejection or correction requests", () => {
  for (const status of ["REJECTED", "NEEDS_FIX", " rejected ", " needs_fix "]) {
    const rows = getBroadcastTracks({ ...submission, album_tracks: [] }, {
      id: "r", status, track_results: [{ title: "첫 곡", status: "APPROVED" }],
    });
    assert.equal(rows.length, 1);
    assert.notEqual(rows[0].status, "APPROVED");
  }
});

test("legacy fallback does not reintroduce snapshot songs absent from available album metadata", () => {
  const rows = getBroadcastTracks({ ...submission, album_tracks: [submission.album_tracks![0]] }, {
    id: "r", status: "APPROVED", track_results: [
      { track_id: "one", title: "첫 곡", status: "APPROVED" },
      { track_id: "old-track", title: "오래된 곡", status: "APPROVED" },
    ],
  });
  assert.deepEqual(rows.map(row => row.track.id), ["one"]);
});

test("legacy WBS snapshots require explicit decisions and reject more than three decided songs", () => {
  const legacySubmission = { ...submission, album_tracks: [] };
  const review = { id: "wbs", status: "APPROVED", station: { code: "WBS" } };
  const snapshots = [1, 2, 3, 4].map(number => ({ track_no: number, title: `저장된 곡 ${number}`, status: "APPROVED" }));
  assert.equal(getBroadcastTracks(legacySubmission, { ...review, track_results: snapshots.slice(0, 3) }).filter(row => row.status === "APPROVED").length, 3);
  assert.ok(getBroadcastTracks(legacySubmission, { ...review, track_results: snapshots }).every(row => row.status === "PENDING"));
  assert.ok(getBroadcastTracks(legacySubmission, { ...review, track_results: snapshots.map(row => ({ ...row, status: "PENDING" })) }).every(row => row.status === "PENDING"));
});

test("only WBS uses the three-track selection; other stations keep all reviewed songs", () => {
  const album = { ...submission, album_tracks: [1, 2, 3, 4].map(track_no => ({ id: `track-${track_no}`, track_no, broadcast_selected: track_no < 4 })) };
  assert.equal(getBroadcastTracks(album, { id: "wbs", status: "APPROVED", station: { code: "WBS" } }).length, 3);
  assert.equal(getBroadcastTracks(album, { id: "kbs", status: "APPROVED", station: { code: "KBS" } }).length, 4);
});

test("WBS legacy overall approval cannot invent four eligible songs without a recorded target", () => {
  const album = { ...submission, album_tracks: [1, 2, 3, 4].map(track_no => ({ id: `track-${track_no}`, track_no, broadcast_selected: false })) };
  const review = { id: "wbs", status: "APPROVED", station: { code: "WBS" } };
  assert.ok(getBroadcastTracks(album, review).every(item => item.status !== "APPROVED"));
  const explicit = { ...review, track_results: [1, 2, 4].map(number => ({ track_id: `track-${number}`, status: "APPROVED" })) };
  assert.deepEqual(getBroadcastTracks(album, explicit).filter(item => item.status === "APPROVED").map(item => item.key), ["track-1", "track-2", "track-4"]);
  const invalid = { ...review, track_results: [1, 2, 3, 4].map(number => ({ track_id: `track-${number}`, status: "APPROVED" })) };
  assert.ok(getBroadcastTracks(album, invalid).every(item => item.status !== "APPROVED"));
});

test("request draft includes actual artist, song, program and story without claiming airplay", () => {
  const draft = buildRadioRequest({ submission, track: submission.album_tracks![0], program: "저녁 라디오", story: "퇴근길에 듣고 싶어요." });
  assert.equal(draft.title, "[신청곡] 뮤지션 - 첫 곡");
  assert.match(draft.body, /저녁 라디오 제작진/);
  assert.match(draft.body, /퇴근길에 듣고 싶어요/);
  assert.doesNotMatch(draft.body, /방송 확정|등록 완료|심의 통과/);
});

test("English request uses supplied official names and falls back without inventing translations", () => {
  const input = { ...submission, artist_name_en: "Official Artist" };
  const track = { ...submission.album_tracks![0], track_title_en: "Official Song" };
  assert.equal(buildRadioRequest({ submission: input, track, isEnglish: true }).title, "Song request: Official Artist – Official Song");
  assert.equal(buildRadioRequest({ submission, track: submission.album_tracks![0], isEnglish: true }).title, "Song request: 뮤지션 – 첫 곡");
});

test("station guide keeps verified participation routes scoped to the approved broadcaster", () => {
  const arirang = getRadioStationGuide({ stationCode: "ARIRANG" })!;
  assert.equal(arirang.language, "en");
  assert.equal(arirang.programs.length, 2);
  for (const program of arirang.programs) {
    for (const url of [program.url, program.messageUrl, program.playlistUrl]) assert.equal(new URL(url).hostname, "www.arirang.com");
    assert.ok(program.messageUrl.startsWith(`${program.url}/board/`));
    assert.ok(program.playlistUrl.startsWith(`${program.url}/tracklist/`));
  }
  assert.equal(getRadioStationGuide({ stationCode: "KISS", stationName: "ARIRANG" }), null);
  assert.equal(getRadioStationGuide({ stationCode: "MBC" })?.participationLink?.name, "MBC mini");
});

test("reference pack labels broadcaster-specific decisions and excludes private data", () => {
  const input = { ...submission, applicant_email: "private@example.com", applicant_phone: "010-secret", guest_token: "secret-token" };
  const output = buildBroadcastCredits(input) + buildBroadcastResultCsv(input, [{ id: "r", status: "APPROVED", station: { code: "KBS" }, track_results: [{ track_id: "one", status: "APPROVED" }, { track_id: "two", status: "REJECTED" }] }]);
  assert.match(output, /KBS/); assert.match(output, /부적격/); assert.match(output, /작곡가/);
  assert.doesNotMatch(output, /private@example|secret/);
});

test("CSV escapes user metadata formulas, quotes and multiline values", () => {
  const csv = buildBroadcastResultCsv({ ...submission, artist_name: '=HYPERLINK("https://invalid")', album_tracks: [{ id: "one", track_title: '+SUM(1,2)\n"name"' }] }, [{ id: "r", status: "APPROVED", station: { code: "KBS" } }]);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.match(csv, /'\+SUM\(1,2\)\n""name""/);
  assert.match(csv, /'=HYPERLINK\(""https:\/\/invalid""\)/);
});

test("official broadcaster directory never falls back to unrelated stations or search engines", () => {
  for (const code of ["KBS", "MBC", "SBS", "CBS", "TBS", "YTN", "WBS", "CPBC", "BBS", "ARIRANG", "GYEONGIN_IFM", "TBN", "FEBC", "GUGAK"]) {
    const links = resolveRadioBoardLinks({ stationCode: code });
    assert.equal(links.length, 1); assert.ok(links[0].url.startsWith("https://")); assert.ok(!links[0].url.includes("google"));
  }
  assert.deepEqual(resolveRadioBoardLinks({ stationCode: "KISS", stationName: "KBS" }), []);
  assert.deepEqual(resolveRadioBoardLinks({ stationName: "" }), []);
  assert.deepEqual(resolveRadioBoardLinks({ stationCode: "NEW" }), []);
});
