import { normalizeStationReviewStatus } from "@/constants/review-status";
import { getStationReviewTracks, resolveStationTrackResults, type AlbumTrackMeta } from "@/lib/track-results";

export type BroadcastTrack = AlbumTrackMeta & {
  performer?: string | null;
  composer?: string | null;
  lyricist?: string | null;
  arranger?: string | null;
  lyrics?: string | null;
  broadcast_selected?: boolean | null;
};

export type BroadcastSubmission = {
  id: string;
  title?: string | null;
  artist_name?: string | null;
  artist_name_kr?: string | null;
  artist_name_en?: string | null;
  release_date?: string | null;
  genre?: string | null;
  album_tracks?: BroadcastTrack[] | null;
};

export type BroadcastReview = {
  id: string;
  status: string;
  track_results?: unknown;
  updated_at?: string;
  station?: { name?: string | null; code?: string | null } | null;
};

export function broadcastTrackTitle(track: BroadcastTrack) {
  return track.track_title || track.track_title_kr || track.track_title_en || "트랙";
}

export function broadcastArtist(submission: BroadcastSubmission) {
  return submission.artist_name || submission.artist_name_kr || submission.artist_name_en || "";
}

/** Only decisions for the selected broadcaster can make a track eligible. */
export function getBroadcastTracks(submission: BroadcastSubmission, review: BroadcastReview) {
  const tracks = getStationReviewTracks(submission.album_tracks ?? [], review.station, review.track_results);
  const results = resolveStationTrackResults(review.track_results, tracks, review.status, review.station);
  const blocked = ["REJECTED", "NEEDS_FIX"].includes(normalizeStationReviewStatus(review.status));
  return tracks.map((track, index) => ({
    track,
    key: track.id || `track-${track.track_no ?? index + 1}`,
    status: blocked ? normalizeStationReviewStatus(review.status) : results[index]?.status ?? "PENDING",
  }));
}

export function buildRadioRequest(input: {
  submission: BroadcastSubmission;
  track: BroadcastTrack;
  program?: string;
  story?: string;
  isEnglish?: boolean;
}) {
  const artist = input.track.performer || broadcastArtist(input.submission);
  const title = broadcastTrackTitle(input.track);
  const program = input.program?.trim();
  const story = input.story?.trim();
  return input.isEnglish
    ? { title: `Song request: ${artist} – ${title}`, body: [program ? `Hello, ${program}!` : "Hello!", "", `I'd like to request “${title}” by ${artist}.`, story ? `\n${story}` : "", "", "Thank you for listening."].filter((line) => line !== undefined).join("\n") }
    : { title: `[신청곡] ${artist} - ${title}`, body: [program ? `${program} 제작진 여러분, 안녕하세요.` : "안녕하세요.", "", `${artist}의 ‘${title}’ 신청합니다.`, story ? `\n${story}` : "", "", "함께 들을 수 있으면 좋겠습니다. 감사합니다."].join("\n") };
}

const csvCell = (value: unknown) => {
  const text = String(value ?? "");
  // Spreadsheet formulas can be embedded in user-entered track/artist names.
  const safe = /^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
};

export function buildBroadcastResultCsv(submission: BroadcastSubmission, reviews: BroadcastReview[]) {
  const rows: unknown[][] = [["방송국", "곡명", "아티스트", "결과", "결과 갱신일"]];
  for (const review of reviews) {
    for (const item of getBroadcastTracks(submission, review)) {
      rows.push([review.station?.name || review.station?.code || "방송국", broadcastTrackTitle(item.track), item.track.performer || broadcastArtist(submission), item.status === "APPROVED" ? "적격" : item.status === "REJECTED" ? "부적격" : item.status === "NEEDS_FIX" ? "보완요청" : "결과대기", review.updated_at || ""]);
    }
  }
  return "\uFEFF" + rows.map(row => row.map(csvCell).join(",")).join("\r\n");
}

export function buildBroadcastCredits(submission: BroadcastSubmission) {
  return [
    `음반: ${submission.title || ""}`,
    `아티스트: ${broadcastArtist(submission)}`,
    ...(submission.release_date ? [`발매일: ${submission.release_date}`] : []),
    ...(submission.genre ? [`장르: ${submission.genre}`] : []),
    "",
    ...(submission.album_tracks ?? []).flatMap((track, index) => [
      `${track.track_no ?? index + 1}. ${broadcastTrackTitle(track)}`,
      `가창/연주: ${track.performer || broadcastArtist(submission)}`,
      `작곡: ${track.composer || "미입력"} / 작사: ${track.lyricist || "미입력"} / 편곡: ${track.arranger || "미입력"}`,
      "",
    ]),
    "온사이드에 입력된 곡 정보입니다. 방송국별 심의 결과는 별도 결과표를 확인해주세요.",
  ].join("\n");
}

export const radioRequestGuide = [
  "적격 판정을 받은 방송국과 신청할 곡을 선택하세요. 방송국마다 결과가 다를 수 있습니다.",
  "공식 라디오 페이지에서 현재 방송 중인 프로그램을 고르고 ‘사연과 신청곡’ 또는 참여 게시판을 찾으세요.",
  "해당 방송국 계정으로 로그인한 뒤 게시판 공지와 작성 규칙을 확인하세요.",
  "곡명·아티스트와 함께 듣고 싶은 이유를 담아 문구를 수정하고, 제목과 본문을 각각 복사해 붙여넣으세요.",
  "공개 글의 개인정보와 첨부파일을 확인한 뒤 직접 등록하세요. 등록한 글과 방송 후 선곡표에서 확인할 수 있습니다.",
];

export const radioRequestGuideEnglish = [
  "Choose a broadcaster and a track approved by that broadcaster. Decisions can differ by station.",
  "Open its official radio site, choose a current program, and find the song-request or listener board.",
  "Sign in with your broadcaster account and read the board's posting rules.",
  "Add your own reason for requesting the song, then copy the title and body into the board.",
  "Check personal information and attachments before posting yourself. Check your post and the program playlist afterward.",
];
