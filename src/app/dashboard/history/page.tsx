import Link from "next/link";

import { formatCurrency, formatDateTime } from "@/lib/format";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata = {
  title: "심의 내역",
};

export default async function HistoryPage() {
  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: submissions } = await supabase
    .from("submissions")
    .select(
      "id, title, artist_name, status, payment_status, created_at, updated_at, type, package:packages ( name, price_krw )",
    )
    .order("updated_at", { ascending: false })
    .eq("user_id", user?.id ?? "");

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-12">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            History
          </p>
          <h1 className="font-display mt-2 text-3xl text-foreground">
            내 심의 내역
          </h1>
        </div>
        <Link
          href="/dashboard/new"
          className="rounded-full bg-foreground px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-background"
        >
          새 접수
        </Link>
      </div>

      <div className="mt-8 space-y-3">
        {submissions && submissions.length > 0 ? (
          submissions.map((submission) => (
            <Link
              key={submission.id}
              href={`/dashboard/submissions/${submission.id}`}
              className="grid gap-4 rounded-2xl border border-border/60 bg-card/80 p-4 text-sm transition hover:border-foreground md:grid-cols-[1.4fr_1fr_1fr]"
            >
              <div>
                <p className="font-semibold text-foreground">
                  {submission.title || "제목 미입력"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {submission.artist_name || "아티스트 미입력"} ·{" "}
                  {submission.type}
                </p>
              </div>
              <div className="text-xs text-muted-foreground">
                <p>상태: {submission.status}</p>
                <p>결제: {submission.payment_status}</p>
              </div>
              <div className="text-xs text-muted-foreground md:text-right">
                <p>
                  {submission.package?.price_krw
                    ? `${formatCurrency(submission.package.price_krw)}원`
                    : "-"}
                </p>
                <p>{formatDateTime(submission.updated_at)}</p>
              </div>
            </Link>
          ))
        ) : (
          <div className="rounded-2xl border border-dashed border-border/60 bg-background/70 px-4 py-6 text-xs text-muted-foreground">
            아직 접수된 내역이 없습니다.
          </div>
        )}
      </div>
    </div>
  );
}
