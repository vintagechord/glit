import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { APP_CONFIG } from "@/lib/config";
import { formatCurrency } from "@/lib/format";
import { createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function PayPage({
  params,
}: {
  params: { id: string };
}) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: submission } = await supabase
    .from("submissions")
    .select(
      "id, user_id, title, artist_name, amount_krw, payment_status, payment_method",
    )
    .eq("id", params.id)
    .maybeSingle();

  if (!submission || submission.user_id !== user.id) {
    notFound();
  }

  const amountLabel = submission.amount_krw
    ? formatCurrency(submission.amount_krw)
    : "미정";

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <div className="rounded-[32px] border border-border/60 bg-card/90 p-8 shadow-[0_24px_80px_rgba(15,23,42,0.15)]">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
          결제하기
        </p>
        <h1 className="mt-3 text-2xl font-semibold text-foreground">
          {submission.title || "제목 미입력"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {submission.artist_name || "아티스트 미입력"}
        </p>

        <div className="mt-6 grid gap-4 rounded-2xl border border-border/60 bg-background/70 p-4 text-sm text-foreground">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              결제 상태
            </span>
            <span className="rounded-full bg-amber-500/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-700">
              {submission.payment_status || "결제대기"}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              결제 금액
            </span>
            <span className="text-base font-semibold">{amountLabel}원</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              결제 방식
            </span>
            <span className="text-sm">
              {submission.payment_method === "CARD"
                ? "카드"
                : submission.payment_method === "BANK"
                  ? "무통장 입금"
                  : "결제대기"}
            </span>
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-border/60 bg-background/80 p-4 text-sm text-foreground">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            무통장 입금 안내
          </p>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                은행
              </p>
              <p className="mt-1 font-semibold">{APP_CONFIG.bankName}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                계좌번호
              </p>
              <p className="mt-1 font-semibold">{APP_CONFIG.bankAccount}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                예금주
              </p>
              <p className="mt-1 font-semibold">{APP_CONFIG.bankHolder}</p>
            </div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            입금 후 문의하기로 알려주시면 확인을 빠르게 도와드립니다.
          </p>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/dashboard"
            className="rounded-full border border-border/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-foreground"
          >
            접수 현황으로
          </Link>
          <a
            href="mailto:help@vhouse.co.kr"
            className="rounded-full bg-foreground px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-background transition hover:bg-amber-200 hover:text-slate-900"
          >
            문의하기
          </a>
        </div>
      </div>
    </div>
  );
}
