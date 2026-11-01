"use client";

import * as React from "react";
import { LoaderCircle } from "lucide-react";
import { usePathname } from "next/navigation";

import type { MemberApplicant } from "@/lib/member-applicant";
import { hasBrowserAuthCookie } from "@/lib/supabase/browser-session";

export type ApplicationViewer = { userId: string | null; userEmail: string | null; applicant?: MemberApplicant };
export type ApplicationViewerState =
  | { status: "loading" }
  | { status: "ready"; viewer: ApplicationViewer }
  | { status: "error"; message: string };

const GUEST: ApplicationViewer = { userId: null, userEmail: null };
const MEMBER_REUSE_MS = 30_000;
let memberRequest: { startedAt: number; promise: Promise<ApplicationViewer> } | null = null;

// Album and MV forms reuse one verified read while a member moves between them.
function readMember(): Promise<ApplicationViewer> {
  if (memberRequest && Date.now() - memberRequest.startedAt < MEMBER_REUSE_MS) return memberRequest.promise;
  const promise = fetch("/api/account/applicant", { cache: "no-store" }).then(async (response) => {
    // A cookie the server no longer accepts is a signed-out visitor.
    if (response.status === 401) return GUEST;
    const body = await response.json().catch(() => null) as (ApplicationViewer & { error?: string }) | null;
    if (!response.ok || !body?.userId) throw new Error("회원 정보를 불러오지 못했습니다.");
    return { userId: body.userId, userEmail: body.userEmail ?? null, applicant: body.applicant };
  });
  const request = { startedAt: Date.now(), promise };
  memberRequest = request;
  promise.catch(() => { if (memberRequest === request) memberRequest = null; });
  return promise;
}

const noSubscription = () => () => {};

/**
 * The application pages are served from the CDN, so who is applying is
 * resolved in the browser: no session cookie means a guest at once; with one,
 * /api/account/applicant verifies the session and returns the member's
 * prefill. The wizard mounts only once this is known, as it did before.
 */
export function useApplicationViewer(): ApplicationViewerState & { retry: () => void } {
  // Unknown while prerendering and hydrating; read synchronously afterwards.
  const hasCookie = React.useSyncExternalStore(noSubscription, () => hasBrowserAuthCookie(), () => null);
  const [member, setMember] = React.useState<ApplicationViewerState>({ status: "loading" });
  const [attempt, setAttempt] = React.useState(0);
  const retry = React.useCallback(() => {
    memberRequest = null;
    setMember({ status: "loading" });
    setAttempt((value) => value + 1);
  }, []);

  React.useEffect(() => {
    if (!hasCookie) return;
    let active = true;
    readMember().then(
      (viewer) => { if (active) setMember({ status: "ready", viewer }); },
      (error: unknown) => { if (active) setMember({ status: "error", message: error instanceof Error ? error.message : "회원 정보를 불러오지 못했습니다." }); },
    );
    return () => { active = false; };
  }, [hasCookie, attempt]);

  if (hasCookie === null) return { status: "loading", retry };
  if (!hasCookie) return { status: "ready", viewer: GUEST, retry };
  return { ...member, retry };
}

export function ApplicationViewerStatus({ state }: { state: Exclude<ApplicationViewerState, { status: "ready" }> & { retry: () => void } }) {
  const pathname = usePathname();
  const english = pathname === "/en" || pathname.startsWith("/en/");
  if (state.status === "error") {
    return (
      <div role="alert" className="rounded-[10px] border-2 border-[#d9362c] bg-card p-6 text-sm font-semibold text-foreground shadow-[5px_5px_0_#111111] dark:shadow-[5px_5px_0_#f2cf27]">
        <p>{english ? "We could not load your account details." : state.message}</p>
        <button type="button" onClick={state.retry} className="bauhaus-button mt-4 px-5 py-2 text-sm">
          {english ? "Try again" : "다시 시도"}
        </button>
      </div>
    );
  }
  return (
    <div role="status" className="flex min-h-[420px] flex-col items-center justify-center gap-3 rounded-[10px] border-2 border-[#111111] bg-card p-8 text-sm font-semibold text-muted-foreground shadow-[5px_5px_0_#111111] dark:border-[#f2cf27] dark:shadow-[5px_5px_0_#f2cf27]">
      <LoaderCircle className="h-7 w-7 animate-spin" aria-hidden="true" />
      <span>{english ? "Preparing the application form…" : "신청서를 준비하고 있습니다."}</span>
    </div>
  );
}
