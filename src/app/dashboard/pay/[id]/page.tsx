import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { APP_CONFIG } from "@/lib/config";
import { formatCurrency } from "@/lib/format";
import { createServerSupabase } from "@/lib/supabase/server";
import { getServerSessionUser } from "@/lib/supabase/server-user";

export const dynamic = "force-dynamic";

export default async function PayPage({
  params,
}: {
  params: { id: string };
}) {
  const supabase = await createServerSupabase();
  const user = await getServerSessionUser(supabase);

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
      <div className="rounded-[10px] border-2 border-[#111111] bg-card p-8 shadow-[8px_8px_0_#111111] dark:border-[#f2cf27] dark:shadow-[8px_8px_0_#f2cf27]">
        <p className="bauhaus-kicker">
          결제하기
        </p>
        <h1 className="mt-4 text-2xl font-black text-foreground">
          {submission.title || "제목 미입력"}
        </h1>
        <p className="mt-1 text-sm font-semibold text-muted-foreground">
          {submission.artist_name || "아티스트 미입력"}
        </p>

        <div className="mt-6 grid gap-4 rounded-[8px] border-2 border-border bg-background/70 p-4 text-sm text-foreground">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black uppercase tracking-normal text-muted-foreground">
              결제 상태
            </span>
            <span className="rounded-[6px] border-2 border-[#111111] bg-[#f2cf27] px-3 py-1 text-[11px] font-black uppercase tracking-normal text-black">
              {submission.payment_status || "결제대기"}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs font-black uppercase tracking-normal text-muted-foreground">
              결제 금액
            </span>
            <span className="text-base font-black">{amountLabel}원</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs font-black uppercase tracking-normal text-muted-foreground">
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

        <div className="mt-6 rounded-[8px] border-2 border-border bg-background/80 p-4 text-sm text-foreground">
          <p className="text-xs font-black uppercase tracking-normal text-muted-foreground">
            무통장 입금 안내
          </p>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <div>
              <p className="text-[11px] font-black uppercase tracking-normal text-muted-foreground">
                은행
              </p>
              <p className="mt-1 font-semibold">{APP_CONFIG.bankName}</p>
            </div>
            <div>
              <p className="text-[11px] font-black uppercase tracking-normal text-muted-foreground">
                계좌번호
              </p>
              <p className="mt-1 font-semibold">{APP_CONFIG.bankAccount}</p>
            </div>
            <div>
              <p className="text-[11px] font-black uppercase tracking-normal text-muted-foreground">
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
            className="rounded-[8px] border-2 border-border px-4 py-2 text-xs font-black uppercase tracking-normal text-foreground transition hover:border-foreground"
          >
            접수 현황으로
          </Link>
          <a
            href={`mailto:${APP_CONFIG.supportEmail}`}
            className="bauhaus-button px-4 py-2 text-xs uppercase"
          >
            문의하기
          </a>
        </div>
      </div>
    </div>
  );
}
