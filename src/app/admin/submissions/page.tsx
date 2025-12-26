import Link from "next/link";

import { formatDateTime } from "@/lib/format";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata = {
  title: "접수 관리",
};

const statusOptions = [
  "DRAFT",
  "SUBMITTED",
  "PRE_REVIEW",
  "WAITING_PAYMENT",
  "IN_PROGRESS",
  "RESULT_READY",
  "COMPLETED",
];

const paymentOptions = ["UNPAID", "PAYMENT_PENDING", "PAID", "REFUNDED"];

const typeOptions = ["ALBUM", "MV_DISTRIBUTION", "MV_BROADCAST"];

export default async function AdminSubmissionsPage({
  searchParams,
}: {
  searchParams: {
    status?: string;
    payment?: string;
    type?: string;
    q?: string;
    from?: string;
    to?: string;
  };
}) {
  const supabase = await createServerSupabase();
  let query = supabase
    .from("submissions")
    .select(
      "id, title, artist_name, status, payment_status, type, created_at, updated_at, guest_name, package:packages ( name )",
    )
    .order("created_at", { ascending: false });

  if (searchParams.status) {
    query = query.eq("status", searchParams.status);
  }
  if (searchParams.payment) {
    query = query.eq("payment_status", searchParams.payment);
  }
  if (searchParams.type) {
    query = query.eq("type", searchParams.type);
  }
  if (searchParams.q) {
    query = query.or(
      `title.ilike.%${searchParams.q}%,artist_name.ilike.%${searchParams.q}%`,
    );
  }
  if (searchParams.from) {
    query = query.gte("created_at", `${searchParams.from}T00:00:00.000Z`);
  }
  if (searchParams.to) {
    query = query.lte("created_at", `${searchParams.to}T23:59:59.999Z`);
  }

  const { data: submissions } = await query;

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-12">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            Admin
          </p>
          <h1 className="font-display mt-2 text-3xl text-foreground">
            접수 관리
          </h1>
        </div>
        <Link
          href="/admin/config"
          className="rounded-full border border-border/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-foreground"
        >
          패키지/방송국 설정
        </Link>
      </div>

      <form className="mt-6 grid gap-4 rounded-[28px] border border-border/60 bg-card/80 p-6 md:grid-cols-[1fr_repeat(5,auto)_auto]">
        <input
          name="q"
          defaultValue={searchParams.q ?? ""}
          placeholder="검색어 (제목/아티스트)"
          className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm"
        />
        <input
          type="date"
          name="from"
          defaultValue={searchParams.from ?? ""}
          className="rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm"
        />
        <input
          type="date"
          name="to"
          defaultValue={searchParams.to ?? ""}
          className="rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm"
        />
        <select
          name="type"
          defaultValue={searchParams.type ?? ""}
          className="rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm"
        >
          <option value="">전체 유형</option>
          {typeOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <select
          name="status"
          defaultValue={searchParams.status ?? ""}
          className="rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm"
        >
          <option value="">전체 상태</option>
          {statusOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <select
          name="payment"
          defaultValue={searchParams.payment ?? ""}
          className="rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm"
        >
          <option value="">결제 상태</option>
          {paymentOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-full bg-foreground px-5 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-background"
        >
          필터 적용
        </button>
      </form>

      <div className="mt-6 space-y-3">
        {submissions && submissions.length > 0 ? (
          submissions.map((submission) => (
            <Link
              key={submission.id}
              href={`/admin/submissions/${submission.id}`}
              className="grid gap-4 rounded-2xl border border-border/60 bg-card/80 p-4 text-sm transition hover:border-foreground md:grid-cols-[1.4fr_1fr_1fr]"
            >
              <div>
                <p className="font-semibold text-foreground">
                  {submission.title || "제목 미입력"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {submission.artist_name || "아티스트 미입력"} ·{" "}
                  {submission.type}
                  {submission.guest_name ? " · 비회원" : ""}
                </p>
              </div>
              <div className="text-xs text-muted-foreground">
                <p>상태: {submission.status}</p>
                <p>결제: {submission.payment_status}</p>
              </div>
              <div className="text-xs text-muted-foreground md:text-right">
                <p>{submission.package?.name ?? "-"}</p>
                <p>{formatDateTime(submission.created_at)}</p>
              </div>
            </Link>
          ))
        ) : (
          <div className="rounded-2xl border border-dashed border-border/60 bg-background/70 px-4 py-6 text-xs text-muted-foreground">
            조회된 접수가 없습니다.
          </div>
        )}
      </div>
    </div>
  );
}
