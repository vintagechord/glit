import { BroadcastSupportPanel } from "../../../src/features/submissions/broadcast-support-panel";

export function BroadcastSupportFixture() {
  const mode = new URLSearchParams(window.location.search).get("mode");
  const boundaryStatus = mode === "legacy-completed" ? "COMPLETED" : mode === "legacy-result-ready" ? "RESULT_READY" : "APPROVED";
  const legacyMode = mode === "missing-tracks" || mode?.startsWith("legacy-");
  return <main className="mx-auto max-w-5xl p-4 sm:p-8"><BroadcastSupportPanel
    isEnglish={mode === "english"}
    submission={{ id: "fixture", title: "퇴근길", artist_name: mode === "missing-artist" ? null : "테스트 뮤지션", artist_name_en: mode === "missing-artist" ? null : "Test Musician", genre: "Indie Folk", album_tracks: legacyMode ? [] : [
      { id: "one", track_no: 1, track_title: "함께 듣는 노래", track_title_en: "Song Together", composer: "작곡가" },
      { id: "two", track_no: 2, track_title: "다른 노래", is_title: mode === "title-track" },
    ] }}
    stationReviews={legacyMode ? [{ id: "arirang", status: boundaryStatus, station: { name: "Arirang 방송", code: "ARIRANG" }, track_results: mode === "legacy-recovered" ? [{ track_id: "snapshot", title: "결과표에 남은 곡명", status: "APPROVED" }] : mode === "legacy-pending" ? [{ track_id: "snapshot", status: "PENDING" }] : mode === "legacy-rejected" ? [{ track_id: "snapshot", status: "REJECTED" }] : null }] : [
      { id: "kbs", status: mode === "rejected" ? "REJECTED" : "APPROVED", station: { name: "KBS", code: "KBS" }, track_results: [{ track_id: "one", status: mode === "rejected" ? "REJECTED" : "APPROVED" }, { track_id: "two", status: "REJECTED" }] },
      { id: "mbc", status: mode === "rejected" ? "REJECTED" : "APPROVED", station: { name: "MBC", code: "MBC" }, track_results: [{ track_id: "one", status: "REJECTED" }, { track_id: "two", status: mode === "rejected" ? "REJECTED" : "APPROVED" }] },
      { id: "kiss", status: mode === "rejected" ? "REJECTED" : "APPROVED", station: { name: "KISS", code: "KISS" } },
      { id: "arirang", status: mode === "rejected" ? "REJECTED" : "APPROVED", station: { name: "Arirang 방송", code: "ARIRANG" }, track_results: mode === "revoked-track" ? [{ track_id: "one", status: "REJECTED" }, { track_id: "two", status: "APPROVED" }] : undefined },
    ]}
  /></main>;
}
