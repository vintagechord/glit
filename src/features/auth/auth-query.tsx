"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";

export type AuthQuery = { next?: string; signup?: string; socialError?: string };

const EMPTY: AuthQuery = {};
const AuthQueryContext = React.createContext<AuthQuery>(EMPTY);

function AuthQueryReader({ children }: { children: React.ReactNode }) {
  const params = useSearchParams();
  const value = React.useMemo<AuthQuery>(() => ({
    next: params.get("next") ?? undefined,
    signup: params.get("signup") ?? undefined,
    socialError: params.get("social_error") ?? undefined,
  }), [params]);
  return <AuthQueryContext.Provider value={value}>{children}</AuthQueryContext.Provider>;
}

/**
 * Sign-in pages are static, so their query (`next`, `signup`, `social_error`)
 * is read in the browser. The prerendered HTML is the same form with an empty
 * query; hydration swaps in the real values before anyone can submit.
 */
export function AuthQueryProvider({ children }: { children: React.ReactNode }) {
  return (
    <React.Suspense fallback={<AuthQueryContext.Provider value={EMPTY}>{children}</AuthQueryContext.Provider>}>
      <AuthQueryReader>{children}</AuthQueryReader>
    </React.Suspense>
  );
}

export function useAuthQuery() {
  return React.useContext(AuthQueryContext);
}

export function SignupSuccessNotice({ english = false }: { english?: boolean }) {
  if (useAuthQuery().signup !== "success") return null;
  return (
    <div className="rounded-[8px] border-2 border-[#111111] bg-[#f2cf27] px-4 py-3 text-sm font-semibold text-[#111111] dark:border-[#f2cf27]">
      {english ? "Signup complete" : "가입 완료"}
    </div>
  );
}
