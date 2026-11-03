import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type React from "react";

import type { SubmissionDetailClient } from "@/features/submissions/submission-detail-client";
import { getPackageStations, stationNameByCode } from "@/lib/station-reviews";
import { loadSubmissionDetailRelations } from "@/lib/submissions/detail-relations";
import { SUBMISSION_USER_DETAIL_SELECT } from "@/lib/submissions/select-columns";
import { normalizeTrackResults } from "@/lib/track-results";

type ClientProps = React.ComponentProps<typeof SubmissionDetailClient>;

export type CustomerSubmissionDetail = {
  submission: ClientProps["initialSubmission"];
  stationReviews: ClientProps["initialStationReviews"];
  files: NonNullable<ClientProps["initialFiles"]>;
  /** Present for guest submissions: the lookup code the result page is keyed on. */
  guestToken: string | null;
  userId: string | null;
};

/** Everything the customer's result page renders, including the application
 * form section (발매일·장르·유통사·제작사 등), the package and the tracks. Guest
 * and applicant contacts are included for the guest page's 신청자 rows. */
export const CUSTOMER_SUBMISSION_DETAIL_SELECT = `${SUBMISSION_USER_DETAIL_SELECT}, guest_token, guest_name, guest_email, guest_phone, guest_company, applicant_name, applicant_email, applicant_phone`;

type PackageInfo = { name?: string | null; station_count?: number | null; price_krw?: number | null };
type TrackRow = { id?: string | null; track_no?: number | null; track_title?: string | null };
type SubmissionRow = Record<string, unknown> & {
  id: string;
  user_id?: string | null;
  guest_token?: string | null;
  type?: string | null;
  status?: string | null;
  payment_status?: string | null;
  amount_krw?: number | null;
  package_id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  mv_selected_station_codes?: string[] | null;
  package?: PackageInfo | PackageInfo[] | null;
  album_tracks?: TrackRow[] | null;
};

const missingColumn = (error: PostgrestError | null) => {
  const match = (error?.message ?? "").match(/column\s+["']?([^\s"']+)["']?\s+does not exist/i);
  const full = match?.[1];
  return full ? full.split(".").pop() ?? null : null;
};

const dropColumn = (select: string, column: string) =>
  select.split(",").map((part) => part.trim()).filter((part) => !part.includes(column)).join(", ");

/** Loads a submission as the customer sees it. Authorization is the caller's:
 * the guest page proves the lookup code, the admin preview proves the admin. */
export async function loadCustomerSubmissionDetail(
  admin: SupabaseClient,
  target: { submissionId: string } | { guestToken: string },
  options: { onError?: (name: string, error: unknown) => void } = {},
): Promise<CustomerSubmissionDetail | null> {
  const report = options.onError ?? ((name, error) => console.error(`[CustomerDetail] ${name} load failed`, error));
  let select = CUSTOMER_SUBMISSION_DETAIL_SELECT;
  let submission: SubmissionRow | null = null;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    let query = admin.from("submissions").select(select);
    query = "guestToken" in target
      ? query.is("user_id", null).eq("guest_token", target.guestToken)
      : query.eq("id", target.submissionId);
    const { data, error } = await query.maybeSingle();
    if (!error) {
      submission = (data as SubmissionRow | null) ?? null;
      break;
    }
    // Older installations may lack a column; keep the page up without it.
    const column = missingColumn(error);
    const next = column ? dropColumn(select, column) : select;
    if (next === select) {
      report("submission", error);
      return null;
    }
    select = next;
  }
  if (!submission) return null;

  const packageInfo = Array.isArray(submission.package) ? submission.package[0] : submission.package;
  const normalizedPackage = packageInfo
    ? { name: packageInfo.name ?? null, station_count: packageInfo.station_count ?? null, price_krw: packageInfo.price_krw ?? null }
    : null;
  const related = await loadSubmissionDetailRelations(admin, submission.id, submission.package_id);
  for (const [name, result] of Object.entries(related)) {
    if (result.error) report(name, result.error);
  }
  const type = submission.type ?? "ALBUM";
  const stationReviews = (related.reviews.data ?? [])
    .filter((review) => type !== "MV_BROADCAST" || !["MV_BROADCAST", "MV_ONLINE"].includes(review.station?.code ?? ""))
    .map((review) => ({ ...review, track_results: normalizeTrackResults(review.track_results, submission?.album_tracks) }));
  const expected = related.packageStations.data.length
    ? related.packageStations.data
    : type === "ALBUM"
      ? getPackageStations(packageInfo?.station_count, packageInfo?.name).map((station) => ({ ...station, id: "" }))
      : [];
  if (type === "MV_BROADCAST") {
    for (const code of submission.mv_selected_station_codes ?? []) {
      if (!["MV_BROADCAST", "MV_ONLINE"].includes(code) && !expected.some((station) => station.code === code)) {
        expected.push({ id: "", code, name: stationNameByCode[code] ?? code });
      }
    }
  }
  const updatedAt = submission.updated_at ?? submission.created_at ?? new Date().toISOString();
  for (const station of expected) {
    if (stationReviews.some((review) => (station.id && review.station_id === station.id) || (station.code && review.station?.code === station.code))) continue;
    stationReviews.push({
      id: `placeholder-${submission.id}-${station.code ?? station.id}`,
      submission_id: submission.id,
      station_id: station.id || null,
      status: "NOT_SENT",
      result_note: null,
      track_results: [],
      updated_at: updatedAt,
      station,
    });
  }

  const normalizedSubmission = {
    ...submission,
    type,
    status: submission.status ?? "SUBMITTED",
    payment_status: submission.payment_status ?? "UNPAID",
    amount_krw: submission.amount_krw ?? null,
    created_at: submission.created_at ?? new Date().toISOString(),
    updated_at: updatedAt,
    package: normalizedPackage,
  } as unknown as ClientProps["initialSubmission"];

  return {
    submission: normalizedSubmission,
    stationReviews: stationReviews as unknown as ClientProps["initialStationReviews"],
    files: related.files.data ?? [],
    guestToken: typeof submission.guest_token === "string" && submission.guest_token.length >= 8 ? submission.guest_token : null,
    userId: submission.user_id ?? null,
  };
}
