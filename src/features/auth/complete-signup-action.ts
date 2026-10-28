"use server";

import { redirect } from "next/navigation";

import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";
import { getAuthPageHref, getAuthReturnPath } from "./navigation";
import { SIGNUP_POLICY_VERSIONS } from "./policy";
import { requiresSocialSignupCompletion } from "./social-contract";

export type CompleteSignupState = { error?: string };

export async function completeSignupAction(_previous: CompleteSignupState, formData: FormData): Promise<CompleteSignupState> {
  const english = formData.get("locale") === "en";
  const next = getAuthReturnPath(String(formData.get("next") ?? ""), english) ?? `${english ? "/en" : ""}/mypage`;
  const supabase = await createServerSupabase({ allowIncompleteSocialSignup: true });
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect(getAuthPageHref("login", next, english));

  if (requiresSocialSignupCompletion(user)) {
    const required = ["agreeAge", "agreeTerms", "agreePrivacy", "agreeRefund"];
    if (required.some((name) => formData.get(name) !== "on")) {
      return { error: english ? "Accept all required agreements to complete signup." : "가입을 완료하려면 필수 항목에 모두 동의해주세요." };
    }
    try {
      // Auth shallow-merges app_metadata keys. Send only this server-owned field
      // so concurrent changes to roles, providers, or other metadata are preserved.
      const { error } = await createAdminClient().auth.admin.updateUserById(user.id, {
        app_metadata: {
          signupConsent: {
            acceptedAt: new Date().toISOString(),
            versions: SIGNUP_POLICY_VERSIONS,
            age14OrOlder: true,
            terms: true,
            privacy: true,
            refund: true,
            marketing: formData.get("agreeMarketing") === "on",
          },
        },
      });
      if (error) return { error: english ? "Could not save your agreements. Please try again." : "동의 내용을 저장하지 못했습니다. 다시 시도해주세요." };
    } catch {
      return { error: english ? "Could not save your agreements. Please try again." : "동의 내용을 저장하지 못했습니다. 다시 시도해주세요." };
    }
  }

  // Refresh the JWT as well as server metadata before the consent gate runs again.
  const refreshErrorMessage = english ? "Your agreements were saved, but the session could not refresh. Please try again." : "동의 내용은 저장했지만 로그인 상태를 갱신하지 못했습니다. 다시 시도해주세요.";
  try {
    const { data, error } = await supabase.auth.refreshSession();
    if (error || !data.session || data.user?.id !== user.id || requiresSocialSignupCompletion(data.user)) {
      return { error: refreshErrorMessage };
    }
  } catch {
    return { error: refreshErrorMessage };
  }
  redirect(next);
}
