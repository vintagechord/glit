import Link from "next/link";
import { ExternalLink } from "lucide-react";

import { AdminSaveToast } from "@/components/admin/save-toast";
import { updateMagazineRequestStatusFormAction } from "@/features/magazine/actions";
import { formatDate, formatDateTime } from "@/lib/format";
import { createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "매거진 발행 요청 관리",
};

const statusOptions = ["REQUESTED", "WRITING", "PUBLISHED", "CANCELED"];
const statusLabels: Record<string, string> = {
  REQUESTED: "요청 접수",
  WRITING: "작성 중",
  PUBLISHED: "발행 완료",
  CANCELED: "취소",
};
const channelLabels: Record<string, string> = {
  DOMESTIC_NEWS: "국내뉴스",
  MEDIA: "미디어",
};

type MagazineAdminRow = {
  id: string;
  submission_id: string;
  user_id: string | null;
  guest_token: string | null;
  target_channel: string | null;
  status: string | null;
  requester_name: string | null;
  requester_email: string | null;
  requester_phone: string | null;
  album_title: string | null;
  artist_name: string | null;
  release_date: string | null;
  artwork_url: string | null;
  album_url: string | null;
  video_url: string | null;
  article_body: string | null;
  credits_text: string | null;
  notes: string | null;
  published_url: string | null;
  admin_memo: string | null;
  created_at: string | null;
  submission?: {
    id?: string | null;
    title?: string | null;
    artist_name?: string | null;
    payment_status?: string | null;
    type?: string | null;
  } | null;
};

type SearchParamsInput = {
  status?: string | string[];
  saved?: string | string[];
};

const toSingle = (value?: string | string[]) => {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
};

export default async function AdminMagazinePage({
  searchParams,
}: {
  searchParams?: Promise<SearchParamsInput>;
}) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const statusFilter = toSingle(resolvedSearchParams?.status).trim();
  const savedFlag = toSingle(resolvedSearchParams?.saved).trim();
  const currentParams = new URLSearchParams();
  if (statusFilter) currentParams.set("status", statusFilter);
  const currentPageHref = currentParams.toString()
    ? `/admin/magazine?${currentParams.toString()}`
    : "/admin/magazine";

  const supabase = await createServerSupabase();
  let query = supabase
    .from("magazine_requests")
    .select(
      "id, submission_id, user_id, guest_token, target_channel, status, requester_name, requester_email, requester_phone, album_title, artist_name, release_date, artwork_url, album_url, video_url, article_body, credits_text, notes, published_url, admin_memo, created_at, submission:submissions ( id, title, artist_name, payment_status, type )",
    )
    .order("created_at", { ascending: false });

  if (statusFilter) {
    query = query.eq("status", statusFilter);
  }

  const { data, error } = await query;
  const requests = (data ?? []) as unknown as MagazineAdminRow[];

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-12">
      {savedFlag ? <AdminSaveToast message="저장되었습니다." /> : null}
      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
        Admin
      </p>
      <h1 className="font-display mt-2 text-3xl text-foreground">
        매거진 발행 요청 관리
      </h1>
      <p className="mt-3 text-sm text-muted-foreground">
        음반심의 크레딧으로 접수된 워터멜론 매거진 요청을 확인하고 발행 상태를
        관리합니다.
      </p>

      <form className="mt-6 flex flex-wrap items-center gap-3 rounded-[28px] border border-border/60 bg-card/80 p-4">
        <select
          name="status"
          defaultValue={statusFilter}
          className="rounded-2xl border border-border/70 bg-background px-4 py-2 text-sm"
        >
          <option value="">전체 상태</option>
          {statusOptions.map((status) => (
            <option key={status} value={status}>
              {statusLabels[status]}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-full bg-foreground px-5 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-background"
        >
          필터 적용
        </button>
      </form>

      <div className="mt-6 space-y-4">
        {error ? (
          <div className="rounded-2xl border border-dashed border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-600">
            요청 목록을 불러오지 못했습니다. ({error.message})
          </div>
        ) : requests.length > 0 ? (
          requests.map((request) => (
            <section
              key={request.id}
              className="rounded-[18px] border border-border/60 bg-card/85 p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-[6px] bg-[#f2cf27] px-2 py-1 text-[10px] font-black text-[#111111]">
                      {statusLabels[request.status ?? ""] ?? request.status}
                    </span>
                    <span className="rounded-[6px] border border-border px-2 py-1 text-[10px] font-black text-muted-foreground">
                      {channelLabels[request.target_channel ?? ""] ??
                        request.target_channel}
                    </span>
                    {request.user_id ? (
                      <span className="rounded-[6px] border border-[#1556a4]/30 bg-[#1556a4]/10 px-2 py-1 text-[10px] font-black text-[#1556a4]">
                        회원
                      </span>
                    ) : (
                      <span className="rounded-[6px] border border-border px-2 py-1 text-[10px] font-black text-muted-foreground">
                        비회원
                      </span>
                    )}
                  </div>
                  <h2 className="mt-3 text-lg font-black text-foreground">
                    {request.artist_name ?? request.submission?.artist_name ?? "-"} ·{" "}
                    {request.album_title ?? request.submission?.title ?? "-"}
                  </h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    요청일 {formatDateTime(request.created_at)} · 발매일{" "}
                    {formatDate(request.release_date)}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    담당자 {request.requester_name ?? "-"} ·{" "}
                    {request.requester_phone ?? "-"} · {request.requester_email ?? "-"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link
                    href={`/admin/submissions/${request.submission_id}`}
                    className="rounded-[8px] border-2 border-border px-3 py-2 text-xs font-black text-foreground transition hover:border-[#111111]"
                  >
                    심의 접수 보기
                  </Link>
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
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-3">
                {[
                  ["아트워크", request.artwork_url],
                  ["앨범 링크", request.album_url],
                  ["영상 링크", request.video_url],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="rounded-[10px] border border-border/60 bg-background p-3"
                  >
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">
                      {label}
                    </p>
                    {value ? (
                      <a
                        href={value}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 block truncate text-xs font-semibold text-[#1556a4] underline-offset-2 hover:underline"
                      >
                        {value}
                      </a>
                    ) : (
                      <p className="mt-2 text-xs text-muted-foreground">-</p>
                    )}
                  </div>
                ))}
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="rounded-[10px] border border-border/60 bg-background p-4">
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">
                    기사 내용
                  </p>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground">
                    {request.article_body || "직접 작성 내용 없음"}
                  </p>
                </div>
                <div className="rounded-[10px] border border-border/60 bg-background p-4">
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">
                    크레딧 / 요청사항
                  </p>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground">
                    {[request.credits_text, request.notes].filter(Boolean).join("\n\n") ||
                      "추가 요청사항 없음"}
                  </p>
                </div>
              </div>

              <form
                action={updateMagazineRequestStatusFormAction}
                className="mt-4 grid gap-3 rounded-[10px] border border-border/60 bg-background p-4 md:grid-cols-[0.7fr_1fr_1fr_auto]"
              >
                <input type="hidden" name="requestId" value={request.id} />
                <input type="hidden" name="redirectTo" value={currentPageHref} />
                <select
                  name="status"
                  defaultValue={request.status ?? "REQUESTED"}
                  className="rounded-2xl border border-border/70 bg-card px-4 py-2 text-xs"
                >
                  {statusOptions.map((status) => (
                    <option key={status} value={status}>
                      {statusLabels[status]}
                    </option>
                  ))}
                </select>
                <input
                  name="publishedUrl"
                  defaultValue={request.published_url ?? ""}
                  placeholder="발행 URL"
                  className="rounded-2xl border border-border/70 bg-card px-4 py-2 text-xs"
                />
                <input
                  name="adminMemo"
                  defaultValue={request.admin_memo ?? ""}
                  placeholder="관리자 메모"
                  className="rounded-2xl border border-border/70 bg-card px-4 py-2 text-xs"
                />
                <button
                  type="submit"
                  className="rounded-full bg-foreground px-5 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-background"
                >
                  저장
                </button>
              </form>
            </section>
          ))
        ) : (
          <div className="rounded-[18px] border border-dashed border-border bg-card/70 p-8 text-center text-sm text-muted-foreground">
            매거진 발행 요청이 없습니다.
          </div>
        )}
      </div>
    </div>
  );
}
