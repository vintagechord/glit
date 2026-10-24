"use client";

import { AlertTriangle, ArrowRight, Check, CircleAlert } from "lucide-react";

import { formatCurrency } from "@/lib/format";
import { brandStatusTones } from "@/lib/brand-status-tones";
import type {
  SubmissionPreflightIssue,
  SubmissionPreflightResult,
  SubmissionPreflightTarget,
} from "@/lib/submission-preflight";

type SubmissionPreflightPanelProps = {
  result: SubmissionPreflightResult;
  criteria?: string[];
  onNavigate: (
    target: SubmissionPreflightTarget,
    issue: SubmissionPreflightIssue,
  ) => void;
  onAcknowledge?: (issue: SubmissionPreflightIssue) => void;
  primaryAction?: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
    pending?: boolean;
  };
};

const getIssueButtonLabel = (issue: SubmissionPreflightIssue) =>
  issue.acknowledgementKey === "cart-price-change" ? "변경 확인" : issue.id === "materials.email-pending" ? "제출 안내" : "수정";

const PriceChangeSummary = ({ issue }: { issue: SubmissionPreflightIssue }) => {
  const previous = issue.meta?.previousAmountKrw;
  const current = issue.meta?.currentAmountKrw;
  if (
    previous === undefined ||
    current === undefined ||
    previous === current
  ) {
    return null;
  }

  return (
    <p className="mt-2 text-xs font-black text-current">
      {formatCurrency(previous)}원 → {formatCurrency(current)}원
    </p>
  );
};

const IssueRow = ({
  issue,
  onNavigate,
  onAcknowledge,
}: {
  issue: SubmissionPreflightIssue;
  onNavigate: SubmissionPreflightPanelProps["onNavigate"];
  onAcknowledge?: SubmissionPreflightPanelProps["onAcknowledge"];
}) => {
  const isBlocking = issue.severity === "blocking";
  const Icon = isBlocking ? CircleAlert : AlertTriangle;
  const handleClick = () => {
    if (issue.acknowledgementKey && onAcknowledge) {
      onAcknowledge(issue);
      return;
    }
    onNavigate(issue.target, issue);
  };

  return (
    <li
      data-preflight-issue={issue.id}
      className={`grid grid-cols-1 items-start sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center gap-3 rounded-[16px] border-2 p-3 sm:p-4 ${
        isBlocking
          ? brandStatusTones.danger
          : brandStatusTones.warning
      }`}
    >
      <div className="flex min-w-0 items-start gap-3">
        <Icon
          aria-hidden="true"
          className="mt-0.5 h-5 w-5 shrink-0 text-current"
        />
        <div className="min-w-0 [overflow-wrap:anywhere]">
          <p className="text-sm font-black text-current">{issue.title}</p>
          <p className="mt-0.5 text-xs font-semibold leading-5 text-current">
            {issue.message}
          </p>
          <PriceChangeSummary issue={issue} />
        </div>
      </div>
      <button
        type="button"
        onClick={handleClick}
        className="inline-flex min-h-11 shrink-0 items-center justify-center justify-self-end gap-1 rounded-full border-2 border-[#111111] bg-background px-3 py-2 text-xs font-black text-foreground transition hover:-translate-y-0.5 hover:bg-[#111111] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 dark:border-[#f2cf27] dark:hover:bg-[#f2cf27] dark:hover:text-[#111111]"
        aria-label={`${issue.title} ${getIssueButtonLabel(issue)}`}
      >
        {getIssueButtonLabel(issue)}
        <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
    </li>
  );
};

export function SubmissionPreflightPanel({
  result,
  criteria = [
    "필수 정보와 트랙별 크레딧",
    "트랙 수, 타이틀곡과 심의 대상곡",
    "음원·신청서 파일과 결제 금액 변경",
  ],
  onNavigate,
  onAcknowledge,
  primaryAction,
}: SubmissionPreflightPanelProps) {
  const hasIssues = result.issues.length > 0;
  const hasBlockingIssues = result.blockingIssues.length > 0;
  const hasWarnings = result.warnings.length > 0;

  return (
    <section
      aria-labelledby="submission-preflight-title"
      className="rounded-[22px] border-2 border-[#111111] bg-card p-4 shadow-[4px_4px_0_#111111] dark:border-[#f2cf27] dark:shadow-[4px_4px_0_#f2cf27] sm:p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.18em] text-muted-foreground">
            Final check
          </p>
          <h2
            id="submission-preflight-title"
            className="mt-1 text-xl font-black text-foreground"
          >
            최종 점검
          </h2>
        </div>
        <span
          role="status"
          className={`inline-flex items-center gap-1 rounded-full border-2 px-3 py-1 text-xs font-black ${
            hasBlockingIssues
              ? brandStatusTones.danger
              : hasWarnings
                ? brandStatusTones.warning
                : brandStatusTones.success
          }`}
        >
          {!hasBlockingIssues && !hasWarnings ? (
            <Check aria-hidden="true" className="h-3.5 w-3.5" />
          ) : (
            <CircleAlert aria-hidden="true" className="h-3.5 w-3.5" />
          )}
          {hasBlockingIssues
            ? `확인 필요 ${result.blockingIssues.length}`
            : result.awaitingMaterials
              ? "자료 제출 대기"
            : hasWarnings
              ? `확인 권장 ${result.warnings.length}`
              : "입력·첨부 확인"}
        </span>
      </div>

      {hasIssues ? (
        <div className="mt-5 space-y-4">
          {result.blockingIssues.length > 0 ? (
            <ul className="space-y-2" aria-label="수정이 필요한 항목">
              {result.blockingIssues.map((item) => (
                <IssueRow
                  key={item.id}
                  issue={item}
                  onNavigate={onNavigate}
                  onAcknowledge={onAcknowledge}
                />
              ))}
            </ul>
          ) : null}
          {result.warnings.length > 0 ? (
            <div>
              <p className="mb-2 text-xs font-black text-muted-foreground">
                제출 전 확인 권장
              </p>
              <ul className="space-y-2" aria-label="확인을 권장하는 항목">
                {result.warnings.map((item) => (
                  <IssueRow
                    key={item.id}
                    issue={item}
                    onNavigate={onNavigate}
                    onAcknowledge={onAcknowledge}
                  />
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : (
        <div className={`mt-5 flex items-center gap-3 rounded-[16px] border-2 p-4 text-sm font-black ${brandStatusTones.success}`}>
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-current">
            <Check aria-hidden="true" className="h-4 w-4" />
          </span>
          <p className="break-keep">필수 입력과 파일 첨부 상태를 확인했습니다.<br />자료 내용과 제출 규격은 관리자가 확인합니다.</p>
        </div>
      )}

      <details className="mt-4 rounded-[14px] border border-border/70 bg-background/60 px-4 py-3 text-xs text-muted-foreground">
        <summary className="cursor-pointer font-black text-foreground">
          점검 기준
        </summary>
        <ul className="mt-3 list-disc space-y-1 pl-4 leading-5">
          {criteria.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </details>

      {primaryAction ? (
        <button
          type="button"
          onClick={primaryAction.onClick}
          disabled={
            primaryAction.disabled || primaryAction.pending || !result.canSubmit
          }
          className="mt-5 inline-flex min-h-12 w-full items-center justify-center rounded-full border-2 border-[#111111] bg-[var(--bauhaus-red)] px-6 py-3 text-sm font-black text-white shadow-[2px_2px_0_#111111] transition hover:-translate-y-0.5 hover:bg-[#b92d25] disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none disabled:hover:translate-y-0 dark:border-[#f2cf27] dark:text-[#06111f] dark:shadow-[2px_2px_0_#f2cf27]"
        >
          {primaryAction.pending ? "확인 중..." : primaryAction.label}
        </button>
      ) : null}
    </section>
  );
}
