import { BroadcastSupportPanel } from "../../../src/features/submissions/broadcast-support-panel";

export function BroadcastSupportFixture() {
  const mode = new URLSearchParams(window.location.search).get("mode");
  return <main className="mx-auto max-w-5xl p-4 sm:p-8"><BroadcastSupportPanel
    isEnglish={mode === "english"}
    submission={{ id: "fixture", title: "퇴근길", artist_name: "테스트 뮤지션", album_tracks: [
      { id: "one", track_no: 1, track_title: "함께 듣는 노래", composer: "작곡가" },
      { id: "two", track_no: 2, track_title: "다른 노래" },
    ] }}
    stationReviews={[
      { id: "kbs", status: mode === "rejected" ? "REJECTED" : "APPROVED", station: { name: "KBS", code: "KBS" }, track_results: [{ track_id: "one", status: mode === "rejected" ? "REJECTED" : "APPROVED" }, { track_id: "two", status: "REJECTED" }] },
      { id: "mbc", status: mode === "rejected" ? "REJECTED" : "APPROVED", station: { name: "MBC", code: "MBC" }, track_results: [{ track_id: "one", status: "REJECTED" }, { track_id: "two", status: mode === "rejected" ? "REJECTED" : "APPROVED" }] },
      { id: "kiss", status: mode === "rejected" ? "REJECTED" : "APPROVED", station: { name: "KISS", code: "KISS" } },
    ]}
  /></main>;
}
