export const metadata = {
  title: "관리자",
};

import Link from "next/link";
import { CASH_RECEIPT_PURPOSE_LABELS } from "@/lib/cash-receipts";
import {
  AlertTriangle,
  ClipboardList,
  FilePlus2,
  type LucideIcon,
  MailWarning,
  Wallet,
  SendHorizontal,
} from "lucide-react";

import { requireAdminPage } from "@/lib/admin/page-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { brandStatusTones } from "@/lib/brand-status-tones";
import { formatDateTime } from "@/lib/format";
import { formatDepositDue, isDepositOverdue } from "@/lib/bank-transfer-details";
import { loadAdminDashboard, type DashboardSubmission } from "@/lib/admin/dashboard-summary";
import { adminSubmissionStageKeys, adminSubmissionStages, type AdminSubmissionStage } from "@/lib/admin/submission-stages";
import { buildAdminSubmissionDetailPath } from "@/lib/admin/submission-navigation";

export const dynamic = "force-dynamic";

const typeLabels: Record<string, string> = {
  ALBUM: "음반",
  MV_DISTRIBUTION: "온라인 뮤비",
  MV_BROADCAST: "방송 뮤비",
};

const stageHref = (stage: AdminSubmissionStage) => `/admin/submissions?type=ALL&stage=${stage}`;
const detailHref = (id: string, hash = "") =>
  `${buildAdminSubmissionDetailPath({ submissionId: id, returnTo: "/admin/submissions?type=ALL" })}${hash}`;

const menuGroups: Array<{ title: string; items: Array<{ href: string; label: string; note?: string }> }> = [
  {
    title: "접수·심의",
    items: [
      { href: "/admin/intake", label: "관리자 직접 접수", note: "기준파일로 비회원 접수 생성" },
      { href: "/admin/submissions?type=ALL", label: "접수 관리" },
      { href: "/admin/review-docs", label: "심의자료 생성" },
      { href: "/admin/review-docs/links", label: "멜론/지니 링크 심의자료 생성" },
      { href: "/admin/files", label: "심의 파일 업로드" },
      { href: "/admin/config", label: "패키지/방송국 설정" },
      { href: "/admin/storage", label: "저장공간 정리" },
    ],
  },
  {
    title: "결제·메일",
    items: [
      { href: "/admin/payments", label: "이니시스 승인 내역" },
      { href: "/admin/cash-receipts", label: "현금영수증 발급" },
      { href: "/admin/emails", label: "메일 발송 내역" },
    ],
  },
  {
    title: "회원·콘텐츠",
    items: [
      { href: "/admin/users", label: "가입 회원 관리" },
      { href: "/admin/artists", label: "아티스트 관리" },
      { href: "/admin/music", label: "음악 관리 운영" },
      { href: "/admin/karaoke", label: "노래방 등록 관리" },
      { href: "/admin/magazine", label: "매거진 발행 요청" },
      { href: "/admin/credits", label: "크레딧 서비스 관리" },
      { href: "/admin/banners", label: "배너 관리" },
    ],
  },
  {
    title: "고객 응대",
    items: [
      { href: "/admin/chat", label: "실시간 채팅" },
      { href: "/admin/inquiries", label: "1:1 문의" },
    ],
  },
];

function StageChip({ stage }: { stage: AdminSubmissionStage | null }) {
  if (!stage) return null;
  const info = adminSubmissionStages[stage];
  return (
    <span className={`inline-flex shrink-0 items-center rounded-[6px] border-2 px-2 py-0.5 text-[11px] font-black ${info.tone}`}>
      {info.label}
    </span>
  );
}

function Panel({ title, icon: Icon, accent, children, action }: {
  title: string; icon: LucideIcon; accent: string; children: React.ReactNode; action?: React.ReactNode;
}) {
  return (
    <section className="rounded-[14px] border-2 border-[#111111] bg-card p-4 dark:border-[#f2cf27]" style={{ boxShadow: `4px 4px 0 ${accent}` }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-black text-foreground">
          <Icon className="h-5 w-5" aria-hidden="true" />
          {title}
        </h2>
        {action}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function EmptyLine({ children }: { children: React.ReactNode }) {
  return <p className="rounded-[8px] border-2 border-dashed border-border px-3 py-3 text-xs font-semibold text-muted-foreground">{children}</p>;
}

function SubmissionLine({ item, hash = "", extra }: { item: DashboardSubmission; hash?: string; extra?: React.ReactNode }) {
  return (
    <li>
      <Link
        href={detailHref(item.id, hash)}
        prefetch={false}
        className="flex flex-wrap items-center justify-between gap-2 rounded-[8px] border-2 border-border bg-background px-3 py-2 text-sm transition hover:border-[#111111] dark:hover:border-[#f2cf27]"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate font-black text-foreground">{item.title || "제목 미입력"}</span>
          <span className="block truncate text-xs font-semibold text-muted-foreground">
            {[item.artistName || "아티스트 미입력", typeLabels[item.type] ?? item.type, item.customer].join(" · ")}
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-1.5">{extra}</span>
      </Link>
    </li>
  );
}

export default async function AdminPage() {
  await requireAdminPage();
  const dashboard = await loadAdminDashboard(createAdminClient());
  const { counts } = dashboard;
  const draftingCount = counts.drafting ?? 0;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b-2 border-[#111111] pb-5 dark:border-[#f2cf27]">
        <div>
          <h1 className="font-display text-3xl font-black text-foreground">대시보드</h1>
          <p className="mt-1 text-sm font-semibold text-muted-foreground">
            접수·결제·결과 상황을 단계별로 확인합니다. 임시 저장(자동 저장)은 집계에서 제외합니다.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/admin/intake"
            className="inline-flex h-11 items-center gap-2 rounded-[8px] border-2 border-[#111111] bg-[#f2cf27] px-4 text-sm font-black text-[#111111] shadow-[3px_3px_0_#111111] transition hover:-translate-y-0.5"
          >
            <FilePlus2 className="h-5 w-5" aria-hidden="true" />
            관리자 직접 접수
          </Link>
          <Link
            href="/admin/submissions?type=ALL"
            className="inline-flex h-11 items-center gap-2 rounded-[8px] border-2 border-[#111111] bg-card px-4 text-sm font-black text-foreground transition hover:bg-background dark:border-[#f2cf27]"
          >
            <ClipboardList className="h-5 w-5" aria-hidden="true" />
            접수 관리
          </Link>
        </div>
      </div>

      {dashboard.failedSections.length ? (
        <p role="alert" className={`mt-5 rounded-[10px] border-2 px-4 py-3 text-sm font-bold ${brandStatusTones.danger}`}>
          일부 집계를 불러오지 못했습니다: {dashboard.failedSections.join(", ")}. 새로고침하거나 접수 관리에서 직접 확인해주세요.
        </p>
      ) : null}

      <section aria-labelledby="stage-title" className="mt-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="stage-title" className="text-lg font-black text-foreground">처리 현황</h2>
          <Link href="/admin/submissions?type=ALL" className="text-sm font-black text-[#1556a4] underline underline-offset-4 dark:text-sky-300">
            전체 접수 {dashboard.total === null ? "–" : dashboard.total.toLocaleString()}건 보기
          </Link>
        </div>
        <ol className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {adminSubmissionStageKeys.map((stage) => {
            const info = adminSubmissionStages[stage];
            const count = counts[stage];
            const highlight = Boolean(count) && ["bank_pending", "paid", "result_pending"].includes(stage);
            return (
              <li key={stage}>
                <Link
                  href={stageHref(stage)}
                  className={[
                    "flex h-full min-h-[132px] flex-col justify-between gap-3 rounded-[12px] border-2 p-4 transition hover:-translate-y-0.5",
                    highlight
                      ? "border-[#111111] bg-card shadow-[4px_4px_0_#d9362c] dark:border-[#f2cf27]"
                      : "border-border bg-card hover:border-[#111111] dark:hover:border-[#f2cf27]",
                  ].join(" ")}
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className={`inline-flex rounded-[6px] border-2 px-2 py-0.5 text-[11px] font-black ${info.tone}`}>{info.label}</span>
                    <span className="text-right">
                      <span className="text-3xl font-black leading-none text-foreground">{count === null ? "–" : count.toLocaleString()}</span>
                      <span className="ml-1 text-sm font-black text-muted-foreground">건</span>
                    </span>
                  </span>
                  <span className="text-xs font-semibold leading-5 text-muted-foreground">{info.description}</span>
                </Link>
              </li>
            );
          })}
        </ol>
      </section>

      <div className="mt-8 grid gap-5 lg:grid-cols-2">
        <Panel
          title="입금 확인 대기"
          icon={Wallet}
          accent="#f2cf27"
          action={<Link href={stageHref("bank_pending")} className="text-xs font-black underline underline-offset-4">목록</Link>}
        >
          {dashboard.bankOrders.length ? (
            <ul className="space-y-2">
              {dashboard.bankOrders.map((order) => {
                const due = formatDepositDue(order.depositDueAt);
                const overdue = isDepositOverdue(order.depositDueAt);
                const content = (
                  <>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-black text-foreground">{order.titles.join(", ") || "신청 항목 확인 필요"}</span>
                      <span className="block text-xs font-semibold text-muted-foreground">
                        입금자 {order.depositorName || "미입력"} · 요청 {formatDateTime(order.createdAt)}
                      </span>
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      {order.cashReceiptPurpose ? (
                        <span className={`rounded-[6px] border-2 px-2 py-0.5 text-[11px] font-black ${brandStatusTones.progress}`}>
                          현금영수증 {CASH_RECEIPT_PURPOSE_LABELS[order.cashReceiptPurpose]}
                        </span>
                      ) : null}
                      {due ? (
                        <span className={`rounded-[6px] border-2 px-2 py-0.5 text-[11px] font-black ${overdue ? brandStatusTones.danger : brandStatusTones.warning}`}>
                          {overdue ? "기한 지남" : "입금 예정"} {due}
                        </span>
                      ) : null}
                      <span className="text-sm font-black text-foreground">{order.amountKrw ? `${order.amountKrw.toLocaleString()}원` : "-"}</span>
                    </span>
                  </>
                );
                const className = "flex flex-wrap items-center justify-between gap-2 rounded-[8px] border-2 border-border bg-background px-3 py-2 text-sm transition hover:border-[#111111] dark:hover:border-[#f2cf27]";
                return (
                  <li key={order.id}>
                    {order.submissionId ? (
                      <Link href={detailHref(order.submissionId)} prefetch={false} className={className}>{content}</Link>
                    ) : (
                      <div className={className}>{content}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyLine>확인할 무통장 입금 요청이 없습니다.</EmptyLine>
          )}
        </Panel>

        <Panel
          title="결과 안내 대기"
          icon={SendHorizontal}
          accent="#d9362c"
          action={<Link href={stageHref("result_pending")} className="text-xs font-black underline underline-offset-4">목록</Link>}
        >
          {dashboard.resultNotices.length ? (
            <ul className="space-y-2">
              {dashboard.resultNotices.map((item) => (
                <SubmissionLine
                  key={item.id}
                  item={item}
                  hash="#notification-recipient"
                  extra={item.hasRecipient === false ? (
                    <span className={`rounded-[6px] border-2 px-2 py-0.5 text-[11px] font-black ${brandStatusTones.danger}`}>수신 이메일 없음</span>
                  ) : item.hasRecipient === null ? (
                    <span className={`rounded-[6px] border-2 px-2 py-0.5 text-[11px] font-black ${brandStatusTones.warning}`}>수신자 확인 실패</span>
                  ) : (
                    <span className={`rounded-[6px] border-2 px-2 py-0.5 text-[11px] font-black ${brandStatusTones.warning}`}>메일 발송 필요</span>
                  )}
                />
              ))}
            </ul>
          ) : (
            <EmptyLine>결과가 등록됐는데 안내 메일을 보내지 않은 접수가 없습니다.</EmptyLine>
          )}
        </Panel>

        <Panel title="확인 필요" icon={AlertTriangle} accent="#1556a4">
          <ul className="space-y-2 text-sm">
            <li>
              <Link href="/admin/emails" className="flex items-center justify-between gap-2 rounded-[8px] border-2 border-border bg-background px-3 py-2 font-bold transition hover:border-[#111111] dark:hover:border-[#f2cf27]">
                <span className="flex items-center gap-2"><MailWarning className="h-4 w-4" aria-hidden="true" />메일 발송 내역 · 최근 14일 실패·확인 필요</span>
                <span className={`rounded-[6px] border-2 px-2 py-0.5 text-[11px] font-black ${dashboard.mailIssues ? brandStatusTones.danger : brandStatusTones.neutral}`}>
                  {dashboard.mailIssues === null ? "–" : dashboard.mailIssues}건
                </span>
              </Link>
            </li>
            <li>
              <Link href={stageHref("drafting")} className="flex items-center justify-between gap-2 rounded-[8px] border-2 border-border bg-background px-3 py-2 font-bold transition hover:border-[#111111] dark:hover:border-[#f2cf27]">
                <span>업로드·결제 전에 멈춘 신청서 (안내 메일 없음)</span>
                <span className={`rounded-[6px] border-2 px-2 py-0.5 text-[11px] font-black ${draftingCount ? brandStatusTones.warning : brandStatusTones.neutral}`}>
                  {counts.drafting === null ? "–" : draftingCount}건
                </span>
              </Link>
            </li>
            <li>
              <Link href={stageHref("notified")} className="flex items-center justify-between gap-2 rounded-[8px] border-2 border-border bg-background px-3 py-2 font-bold transition hover:border-[#111111] dark:hover:border-[#f2cf27]">
                <span>결과 안내 후 고객 확인 기록 없음 (30일)</span>
                <span className={`rounded-[6px] border-2 px-2 py-0.5 text-[11px] font-black ${dashboard.unseenResults ? brandStatusTones.warning : brandStatusTones.neutral}`}>
                  {dashboard.unseenResults === null ? "–" : dashboard.unseenResults}건
                </span>
              </Link>
            </li>
            <li>
              <Link href={stageHref("paid")} className="flex items-center justify-between gap-2 rounded-[8px] border-2 border-border bg-background px-3 py-2 font-bold transition hover:border-[#111111] dark:hover:border-[#f2cf27]">
                <span>결제 완료 후 방송사·영등위 접수 전</span>
                <span className={`rounded-[6px] border-2 px-2 py-0.5 text-[11px] font-black ${counts.paid ? brandStatusTones.progress : brandStatusTones.neutral}`}>
                  {counts.paid === null ? "–" : counts.paid}건
                </span>
              </Link>
            </li>
          </ul>
        </Panel>

        <Panel
          title="최근 접수·변경"
          icon={ClipboardList}
          accent="#1f7a5a"
          action={<Link href="/admin/submissions?type=ALL" className="text-xs font-black underline underline-offset-4">전체</Link>}
        >
          {dashboard.recent.length ? (
            <ul className="space-y-2">
              {dashboard.recent.map((item) => (
                <SubmissionLine
                  key={item.id}
                  item={item}
                  extra={(
                    <>
                      <StageChip stage={item.stage} />
                      <span className="text-[11px] font-semibold text-muted-foreground">{formatDateTime(item.updatedAt)}</span>
                    </>
                  )}
                />
              ))}
            </ul>
          ) : (
            <EmptyLine>제출된 접수가 없습니다.</EmptyLine>
          )}
        </Panel>
      </div>

      <section aria-labelledby="menu-title" className="mt-10">
        <h2 id="menu-title" className="text-lg font-black text-foreground">관리 메뉴</h2>
        <div className="mt-3 grid gap-5 lg:grid-cols-2">
          {menuGroups.map((group) => (
            <div key={group.title} className="rounded-[12px] border-2 border-border bg-card p-4">
              <h3 className="text-xs font-black uppercase tracking-[0.2em] text-muted-foreground">{group.title}</h3>
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {group.items.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className="flex h-full min-h-12 flex-col justify-center rounded-[8px] border-2 border-border bg-background px-3 py-2 transition hover:border-[#111111] dark:hover:border-[#f2cf27]"
                    >
                      <span className="text-sm font-black text-foreground">{item.label}</span>
                      {item.note ? <span className="text-[11px] font-semibold text-muted-foreground">{item.note}</span> : null}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
