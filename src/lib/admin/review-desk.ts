import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeTrackResults, getStationReviewTracks } from "@/lib/track-results";
import { hasPublishedSubmissionResult } from "@/lib/submission-certificate";
import { getRatingSignedUrl, getGuideSignedUrl, isRatingCode } from "@/lib/mv-assets";
import { presignGetUrl } from "@/lib/b2";
import { createAttachmentResponseFromUrl } from "@/lib/download-response";

export async function loadDeskResults(db: SupabaseClient, submissionId: string) {
  const [s, r, t] = await Promise.all([
    db.from("submissions").select("id,type,title,artist_name,status,package_id,mv_selected_station_codes,mv_desired_rating,mv_rating,result_status,result_memo,result_notified_at,updated_at,certificate_b2_path,certificate_original_name,certificate_uploaded_at,certificate_size,certificate_mime").eq("id", submissionId).maybeSingle(),
    db.from("station_reviews").select("*,station:stations(id,code,name)").eq("submission_id", submissionId),
    db.from("album_tracks").select("id,track_no,track_title,track_title_kr,track_title_en,broadcast_selected").eq("submission_id", submissionId).order("track_no"),
  ]);
  if (s.error || !s.data || r.error || t.error) throw Object.assign(new Error("심의 결과를 불러오지 못했습니다. 서비스 연결을 확인해주세요."), { status: s.error || r.error || t.error ? 503 : 404 });
  const submission = s.data;
  const reviews = r.data || [];
  const requested = new Map<string, { id: string; code: string; name: string }>();
  for (const review of reviews) { const station = Array.isArray(review.station) ? review.station[0] : review.station; if (station?.id) requested.set(station.id, station); }
  if (submission.package_id) {
    const { data, error } = await db.from("package_stations").select("station:stations(id,code,name)").eq("package_id", submission.package_id);
    if (error) throw new Error("신청 패키지의 방송사 목록을 확인하지 못했습니다.");
    for (const link of data || []) { const station = Array.isArray(link.station) ? link.station[0] : link.station; if (station?.id) requested.set(station.id, station); }
  }
  if (submission.type === "MV_BROADCAST" && submission.mv_selected_station_codes?.length) {
    const { data, error } = await db.from("stations").select("id,code,name").in("code", submission.mv_selected_station_codes);
    if (error) throw new Error("신청 방송사 목록을 확인하지 못했습니다.");
    for (const station of data || []) requested.set(station.id, station);
  }
  const stations = [...requested.values()]
    .filter(station => submission.type !== "MV_BROADCAST" || !["MV_BROADCAST", "MV_ONLINE"].includes(station.code))
    .map(station => {
    const raw = reviews.find(review => review.station_id === station.id);
    const tracks = getStationReviewTracks(t.data || [], station, raw?.track_results_json ?? raw?.track_results);
    return { ...station, trackIds: tracks.map(track => track.id), review: raw ? { id: raw.id, status: raw.status, result_note: raw.result_note, age_rating: raw.age_rating ?? null, track_results: normalizeTrackResults(raw.track_results_json ?? raw.track_results), updated_at: raw.updated_at } : { id: null, status: "NOT_SENT", result_note: null, age_rating: null, track_results: [], updated_at: null } };
  }).sort((a, b) => (a.code || a.name || "").localeCompare(b.code || b.name || ""));
  const rating = submission.mv_desired_rating;
  const validRating = isRatingCode(rating) && rating !== "REJECT";
  const published = hasPublishedSubmissionResult(submission);
  const certificate = Boolean(submission.certificate_b2_path);
  const rejected = rating === "REJECT" || submission.result_status === "REJECTED";
  const items = [
    { kind: "ratingImage", label: "등급 이미지", available: published && validRating },
    { kind: "usageGuide", label: "등급 표기 사용 안내 PDF", available: published && validRating },
    { kind: "certificate", label: "영등위 발급 필증", available: published && certificate, name: submission.certificate_original_name || null },
  ];
  const missing = [...(!published ? ["심의 결과 미공개"] : []), ...(!validRating && !rejected ? ["확정 등급"] : []), ...(!certificate && !rejected ? ["영등위 필증"] : [])];
  const outbox = await db.from("email_outbox").select("id,operation,status,created_at,accepted_at,last_error_code,attempt_count").eq("submission_id", submissionId).order("created_at", { ascending: false }).limit(10);
  const { certificate_b2_path: _privateKey, ...safeSubmission } = submission;
  void _privateKey;
  return { type: submission.type, revision: createHash("sha256").update(JSON.stringify([submission.updated_at, stations.map(st => st.review.updated_at)])).digest("hex"), submission: safeSubmission, tracks: t.data || [], stations,
    assets: { ready: published && validRating && certificate, rejected, missing, items, verification: "등록 상태 기준이며 실제 파일은 발송 전에 크기·내용을 검사합니다." },
    notifications: outbox.error ? [] : outbox.data || [], notificationWarning: outbox.error ? "메일 발송 이력을 불러오지 못했습니다." : null,
  };
}
export async function downloadDeskResultAsset(db: SupabaseClient, id: string, kind: string) {
  const { data: submission, error } = await db.from("submissions").select("type,mv_desired_rating,status,result_status,result_notified_at,certificate_b2_path,certificate_original_name,certificate_mime").eq("id", id).maybeSingle();
  if (error || !submission || submission.type !== "MV_DISTRIBUTION") throw Object.assign(new Error("온라인 MV 결과 파일을 찾을 수 없습니다."), { status: 404 });
  let url: string | null = null; let filename = ""; let mime = "application/octet-stream";
  if (kind === "certificate" && submission.certificate_b2_path) { url = await presignGetUrl(submission.certificate_b2_path); filename = submission.certificate_original_name || "영등위_필증.pdf"; mime = submission.certificate_mime || "application/pdf"; }
  else if (kind === "ratingImage" && isRatingCode(submission.mv_desired_rating) && submission.mv_desired_rating !== "REJECT" && hasPublishedSubmissionResult(submission)) { url = await getRatingSignedUrl(submission.mv_desired_rating, db); filename = `등급이미지_${submission.mv_desired_rating}.png`; mime = "image/png"; }
  else if (kind === "usageGuide" && isRatingCode(submission.mv_desired_rating) && submission.mv_desired_rating !== "REJECT" && hasPublishedSubmissionResult(submission)) { url = await getGuideSignedUrl(); filename = "등급표기_사용안내.pdf"; mime = "application/pdf"; }
  if (!url) throw Object.assign(new Error("아직 준비되지 않은 결과 파일입니다."), { status: 404 });
  return createAttachmentResponseFromUrl({ url, filename, fallbackContentType: mime });
}
