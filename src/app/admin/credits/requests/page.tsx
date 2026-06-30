import Link from "next/link";
import { ExternalLink } from "lucide-react";

import { AdminSaveToast } from "@/components/admin/save-toast";
import { updateStudioReservationStatusFormAction } from "@/features/credits/actions";
import { updateMagazineRequestStatusFormAction } from "@/features/magazine/actions";
import { formatDate, formatDateTime } from "@/lib/format";
import type { StudioReservationRequest } from "@/lib/credits";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "크레딧 요청 관리",
};

type SearchParamsInput = {
  saved?: string | string[];
  error?: string | string[];
};

type ProfileRow = {
  user_id: string;
  name: string | null;
  company: string | null;
  phone: string | null;
};

type MagazineRequestRow = {
  id: string;
  submission_id: string;
  user_id: string | null;
  target_channel: string | null;
  status: string | null;
  requester_name: string | null;
  requester_email: string | null;
  requester_phone: string | null;
  album_title: string | null;
  artist_name: string | null;
  release_date: string | null;
  published_url: string | null;
  admin_memo: string | null;
  created_at: string | null;
};

const magazineStatusOptions = [
  "REQUESTED",
  "WRITING",
  "PUBLISHED",
  "CANCELED",
] as const;

const magazineStatusLabels: Record<string, string> = {
  REQUESTED: "요청 접수",
  WRITING: "작성 중",
  PUBLISHED: "발행 완료",
  CANCELED: "취소",
};

const studioStatusOptions = ["REQUESTED", "APPROVED", "CANCELED"] as const;

const studioStatusLabels: Record<string, string> = {
  REQUESTED: "요청 접수",
  APPROVED: "예약 승인",
  CANCELED: "취소",
};

const channelLabels: Record<string, string> = {
  DOMESTIC_NEWS: "국내뉴스",
  MEDIA: "미디어",
};

const fieldClass =
  "min-h-10 rounded-2xl border border-border/70 bg-card px-4 py-2 text-xs text-foreground";

const labelClass = "grid gap-1 text-xs font-semibold text-muted-foreground";

const toSingle = (value?: string | string[]) =>
  Array.isArray(value) ? value[0] : value;

const formatReservationDateTime = (date?: string | null, time?: string | null) =>
  `${formatDate(date)}${time ? ` ${time.slice(0, 5)}` : ""}`;

const buildDefaultVisitMessage = (
  reservation: Pick<StudioReservationRequest, "preferred_date" | "preferred_time">,
) =>
  `${formatReservationDateTime(
    reservation.preferred_date,
    reservation.preferred_time,
  )}에 빈티지하우스 녹음실로 방문해주세요.`;

export default async function AdminCreditRequestsPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParamsInput>;
}) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const savedFlag = toSingle(resolvedSearchParams?.saved);
  const errorFlag = toSingle(resolvedSearchParams?.error);
  const admin = createAdminClient();

  const [magazineResult, studioResult] = await Promise.all([
    admin
      .from("magazine_requests")
      .select(
        "id, submission_id, user_id, target_channel, status, requester_name, requester_email, requester_phone, album_title, artist_name, release_date, published_url, admin_memo, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(120),
    admin
      .from("studio_reservation_requests")
      .select(
        "id, user_id, redemption_id, reward_id, reward_title, service_location, status, preferred_date, preferred_time, duration_hours, contact_name, contact_phone, contact_email, notes, approved_message, admin_memo, approved_at, canceled_at, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(120),
  ]);

  const magazineRequests =
    ((magazineResult.data ?? []) as MagazineRequestRow[]) ?? [];
  const studioRequests =
    ((studioResult.data ?? []) as StudioReservationRequest[]) ?? [];
  const userIds = Array.from(
    new Set(
      [...magazineRequests, ...studioRequests]
        .map((request) => request.user_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const { data: profilesData } =
    userIds.length > 0
      ? await admin
          .from("profiles")
          .select("user_id, name, company, phone")
          .in("user_id", userIds)
      : { data: [] as ProfileRow[] };
  const profileMap = new Map(
    ((profilesData ?? []) as ProfileRow[]).map((profile) => [
      profile.user_id,
      profile,
    ]),
  );

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-12">
      {savedFlag ? <AdminSaveToast message="저장되었습니다." /> : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            Admin
          </p>
          <h1 className="font-display mt-2 text-3xl text-foreground">
            크레딧 요청 관리
          </h1>
          <p className="mt-3 max-w-3xl text-sm text-muted-foreground">
            크레딧으로 접수된 매거진 발행 요청과 빈티지하우스 녹음실 예약 요청을
            처리합니다.
          </p>
        </div>
        <Link
          href="/admin/credits"
          className="rounded-full border border-border bg-background px-4 py-2 text-xs font-semibold text-foreground transition hover:border-foreground"
        >
          크레딧/쿠폰 관리
        </Link>
      </div>

      {errorFlag ? (
        <div className="mt-6 rounded-2xl border border-dashed border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-600">
          요청 상태 저장 중 오류가 발생했습니다. 입력값과 마이그레이션 적용 상태를
          확인해주세요.
        </div>
      ) : null}

      <section className="mt-8 space-y-4 rounded-[32px] border border-border/60 bg-card/80 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              매거진 발행 요청
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              발행 URL을 저장하고 상태를 발행 완료로 바꾸면 사용자 화면에서 바로
              발행 링크가 표시됩니다.
            </p>
          </div>
          <span className="rounded-full border border-border bg-background px-3 py-1 text-xs font-semibold text-muted-foreground">
            {magazineRequests.length.toLocaleString()}건
          </span>
        </div>

        {magazineResult.error ? (
          <div className="rounded-2xl border border-dashed border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-600">
            매거진 요청을 불러오지 못했습니다. ({magazineResult.error.message})
          </div>
        ) : magazineRequests.length > 0 ? (
          <div className="space-y-4">
            {magazineRequests.map((request) => {
              const profile = request.user_id
                ? profileMap.get(request.user_id)
                : null;

              return (
                <article
                  key={request.id}
                  className="rounded-2xl border border-border/60 bg-background/70 p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="flex flex-wrap gap-2">
                        <span className="rounded-[6px] bg-[#f2cf27] px-2 py-1 text-[10px] font-black text-[#111111]">
                          {magazineStatusLabels[request.status ?? ""] ??
                            request.status}
                        </span>
                        <span className="rounded-[6px] border border-border px-2 py-1 text-[10px] font-black text-muted-foreground">
                          {channelLabels[request.target_channel ?? ""] ??
                            request.target_channel ??
                            "-"}
                        </span>
                      </div>
                      <h3 className="mt-3 text-base font-black text-foreground">
                        {request.artist_name ?? "-"} ·{" "}
                        {request.album_title ?? "앨범명 미입력"}
                      </h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        요청일 {formatDateTime(request.created_at)} · 발매일{" "}
                        {formatDate(request.release_date)}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {profile?.name ?? request.requester_name ?? "회원명 미입력"}
                        {profile?.company ? ` · ${profile.company}` : ""} ·{" "}
                        {request.requester_phone ?? profile?.phone ?? "-"} ·{" "}
                        {request.requester_email ?? "-"}
                      </p>
                    </div>
                    {request.published_url ? (
                      <a
                        href={request.published_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 rounded-[8px] border-2 border-[#111111] bg-[#f2cf27] px-3 py-2 text-xs font-black text-[#111111]"
                      >
                        발행 URL
                        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                      </a>
                    ) : null}
                  </div>

                  <form
                    action={updateMagazineRequestStatusFormAction}
                    className="mt-4 grid gap-3 md:grid-cols-[150px_1fr_1fr_auto]"
                  >
                    <input type="hidden" name="requestId" value={request.id} />
                    <input
                      type="hidden"
                      name="redirectTo"
                      value="/admin/credits/requests"
                    />
                    <label className={labelClass}>
                      상태
                      <select
                        name="status"
                        defaultValue={request.status ?? "REQUESTED"}
                        className={fieldClass}
                      >
                        {magazineStatusOptions.map((status) => (
                          <option key={status} value={status}>
                            {magazineStatusLabels[status]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className={labelClass}>
                      발행 URL
                      <input
                        name="publishedUrl"
                        defaultValue={request.published_url ?? ""}
                        placeholder="https://..."
                        className={fieldClass}
                      />
                    </label>
                    <label className={labelClass}>
                      관리자 메모
                      <input
                        name="adminMemo"
                        defaultValue={request.admin_memo ?? ""}
                        className={fieldClass}
                      />
                    </label>
                    <div className="flex items-end">
                      <button
                        type="submit"
                        className="h-10 rounded-full bg-foreground px-5 text-xs font-semibold uppercase tracking-[0.2em] text-background"
                      >
                        저장
                      </button>
                    </div>
                  </form>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-border/60 bg-background/70 px-4 py-6 text-xs text-muted-foreground">
            접수된 매거진 발행 요청이 없습니다.
          </div>
        )}
      </section>

      <section className="mt-6 space-y-4 rounded-[32px] border border-border/60 bg-card/80 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              녹음실 예약 요청
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              예약 승인 시 사용자에게 방문 안내 문구가 표시됩니다. 취소 처리하면
              해당 크레딧 사용량도 취소됩니다.
            </p>
          </div>
          <span className="rounded-full border border-border bg-background px-3 py-1 text-xs font-semibold text-muted-foreground">
            {studioRequests.length.toLocaleString()}건
          </span>
        </div>

        {studioResult.error ? (
          <div className="rounded-2xl border border-dashed border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-600">
            녹음실 예약 요청을 불러오지 못했습니다. ({studioResult.error.message})
          </div>
        ) : studioRequests.length > 0 ? (
          <div className="space-y-4">
            {studioRequests.map((request) => {
              const profile = profileMap.get(request.user_id);
              const defaultMessage =
                request.approved_message || buildDefaultVisitMessage(request);

              return (
                <article
                  key={request.id}
                  className="rounded-2xl border border-border/60 bg-background/70 p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="flex flex-wrap gap-2">
                        <span className="rounded-[6px] bg-[#f2cf27] px-2 py-1 text-[10px] font-black text-[#111111]">
                          {studioStatusLabels[request.status] ?? request.status}
                        </span>
                        <span className="rounded-[6px] border border-border px-2 py-1 text-[10px] font-black text-muted-foreground">
                          {request.service_location ?? "빈티지하우스 녹음실"}
                        </span>
                      </div>
                      <h3 className="mt-3 text-base font-black text-foreground">
                        {request.reward_title}
                      </h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        희망일{" "}
                        {formatReservationDateTime(
                          request.preferred_date,
                          request.preferred_time,
                        )}{" "}
                        · {request.duration_hours}시간
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {profile?.name ?? request.contact_name}
                        {profile?.company ? ` · ${profile.company}` : ""} ·{" "}
                        {request.contact_phone} · {request.contact_email ?? "-"}
                      </p>
                      {request.notes ? (
                        <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-muted-foreground">
                          요청사항: {request.notes}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  <form
                    action={updateStudioReservationStatusFormAction}
                    className="mt-4 grid gap-3 md:grid-cols-[150px_1fr_auto]"
                  >
                    <input
                      type="hidden"
                      name="reservationId"
                      value={request.id}
                    />
                    <input
                      type="hidden"
                      name="redirectTo"
                      value="/admin/credits/requests"
                    />
                    <label className={labelClass}>
                      상태
                      <select
                        name="status"
                        defaultValue={request.status}
                        className={fieldClass}
                      >
                        {studioStatusOptions.map((status) => (
                          <option key={status} value={status}>
                            {studioStatusLabels[status]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className={labelClass}>
                      승인 안내 문구
                      <textarea
                        name="approvedMessage"
                        rows={3}
                        defaultValue={defaultMessage}
                        className={fieldClass}
                      />
                    </label>
                    <div className="flex items-end">
                      <button
                        type="submit"
                        className="h-10 rounded-full bg-foreground px-5 text-xs font-semibold uppercase tracking-[0.2em] text-background"
                      >
                        저장
                      </button>
                    </div>
                    <label className={`${labelClass} md:col-span-3`}>
                      관리자 메모
                      <input
                        name="adminMemo"
                        defaultValue={request.admin_memo ?? ""}
                        className={fieldClass}
                      />
                    </label>
                  </form>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-border/60 bg-background/70 px-4 py-6 text-xs text-muted-foreground">
            접수된 녹음실 예약 요청이 없습니다.
          </div>
        )}
      </section>
    </div>
  );
}
