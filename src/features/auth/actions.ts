"use server";

import { redirect } from "next/navigation";
import { headers as nextHeaders } from "next/headers";

import {
  sendPasswordResetEmail,
  sendWelcomeEmail,
} from "@/lib/email";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  consumeRateLimit,
  getRequestIdentifier,
} from "@/lib/request-rate-limit";
import { getSafeInternalPath } from "@/lib/safe-internal-path";
import { createServerSupabase } from "@/lib/supabase/server";
import { buildUrl, getBaseUrl } from "@/lib/url";
import { isAuthConnectionError, logAuthError, mapAuthError } from "./errors";
import { loginSchema, signupSchema, profileSchema, passwordUpdateSchema, resetEmailSchema, toFieldErrors } from "./validation";

export type ActionState = {
  error?: string;
  message?: string;
  fieldErrors?: Record<string, string>;
};

const resetSuccessMessage = "가입된 이메일이라면 비밀번호 재설정 메일을 보냈습니다. 메일함을 확인해주세요.";

const checkAuthRateLimit = async ({
  namespace,
  email,
  ipLimit,
  emailLimit,
  windowMs,
}: {
  namespace: string;
  email: string;
  ipLimit: number;
  emailLimit: number;
  windowMs: number;
}) => {
  const requestHeaders = await nextHeaders();
  const requestIdentifier = getRequestIdentifier(requestHeaders);
  const byIp = consumeRateLimit({
    namespace: `${namespace}-ip`,
    identifier: requestIdentifier,
    limit: ipLimit,
    windowMs,
  });
  const byEmail = consumeRateLimit({
    namespace: `${namespace}-email`,
    identifier: email,
    limit: emailLimit,
    windowMs,
  });
  return byIp.allowed && byEmail.allowed;
};

export async function loginAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const nextRaw = (formData.get("next") || "").toString().trim();
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    next: nextRaw || undefined,
  });

  if (!parsed.success) {
    return {
      fieldErrors: toFieldErrors(parsed.error.flatten().fieldErrors),
    };
  }

  if (
    !(await checkAuthRateLimit({
      namespace: "login",
      email: parsed.data.email,
      ipLimit: 20,
      emailLimit: 10,
      windowMs: 15 * 60 * 1_000,
    }))
  ) {
    return { error: "로그인 요청이 너무 많습니다. 잠시 후 다시 시도해주세요." };
  }

  try {
    const supabase = await createServerSupabase();
    const { error } = await supabase.auth.signInWithPassword({
      email: parsed.data.email,
      password: parsed.data.password,
    });
    if (error) {
      logAuthError("login", error);
      return { error: mapAuthError(error, "login") };
    }
  } catch (error) {
    logAuthError("login", error);
    return { error: mapAuthError(error, "login") };
  }

  const internalNext = getSafeInternalPath(parsed.data.next);
  const nextPathname = internalNext?.split(/[?#]/, 1)[0];
  const safeNext =
    internalNext &&
    nextPathname !== "/login" &&
    !nextPathname?.startsWith("/login/") &&
    nextPathname !== "/en/login" &&
    !nextPathname?.startsWith("/en/login/")
      ? internalNext
      : null;

  redirect(safeNext ?? "/mypage");
}

export async function signupAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = signupSchema.safeParse({
    name: (formData.get("name") || "").toString().trim() || undefined,
    company: (formData.get("company") || "").toString().trim() || undefined,
    phone: (formData.get("phone") || "").toString().trim() || undefined,
    email: formData.get("email"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
    agreeAge: formData.get("agreeAge"),
    agreeTerms: formData.get("agreeTerms"),
    agreePrivacy: formData.get("agreePrivacy"),
    agreeRefund: formData.get("agreeRefund"),
    agreeMarketing: formData.get("agreeMarketing") || undefined,
  });

  if (!parsed.success) {
    return {
      fieldErrors: toFieldErrors(parsed.error.flatten().fieldErrors),
    };
  }

  if (
    !(await checkAuthRateLimit({
      namespace: "signup",
      email: parsed.data.email,
      ipLimit: 5,
      emailLimit: 3,
      windowMs: 60 * 60 * 1_000,
    }))
  ) {
    return { error: "회원가입 요청이 너무 많습니다. 잠시 후 다시 시도해주세요." };
  }

  try {
    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.createUser({
      email: parsed.data.email,
      password: parsed.data.password,
      email_confirm: true,
      user_metadata: {
        name: parsed.data.name ?? "",
        company: parsed.data.company ?? "",
        phone: parsed.data.phone ?? "",
        marketingConsent: parsed.data.agreeMarketing === "on",
      },
    });

    if (error || !data.user) {
      logAuthError("signup", error);
      return { error: mapAuthError(error, "signup") };
    }

    const emailResult = await sendWelcomeEmail({
      email: parsed.data.email,
      name: parsed.data.name,
    });

    if (!emailResult.ok && !emailResult.skipped) {
      console.warn("Welcome email failed", emailResult);
    }

    return {
      message: "회원가입이 완료되었습니다. 로그인해 주세요.",
    };
  } catch (error) {
    logAuthError("signup", error);
    return { error: mapAuthError(error, "signup") };
  }
}

export async function resetPasswordAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = String(formData.get("resetEmail") || "").trim();
  if (!email) {
    return { fieldErrors: { resetEmail: "이메일을 입력해주세요." } };
  }
  const parsed = resetEmailSchema.safeParse(email);
  if (!parsed.success) {
    return { fieldErrors: { resetEmail: "유효한 이메일을 입력해주세요." } };
  }

  if (
    !(await checkAuthRateLimit({
      namespace: "password-reset",
      email: parsed.data,
      ipLimit: 10,
      emailLimit: 5,
      windowMs: 60 * 60 * 1_000,
    }))
  ) {
    return { error: "재설정 요청이 너무 많습니다. 잠시 후 다시 시도해주세요." };
  }

  try {
    const redirectTo = buildUrl("/reset-password", getBaseUrl());
    // The custom sender is optional. A transport failure reaching Supabase,
    // however, also prevents the default sender; do not repeat that request.
    if (process.env.RESEND_API_KEY?.trim()) {
      try {
        const admin = createAdminClient();
        const { data, error } = await admin.auth.admin.generateLink({
          type: "recovery",
          email: parsed.data,
          options: { redirectTo },
        });
        if (error) {
          logAuthError("generate recovery link", error);
          if (isAuthConnectionError(error)) return { error: mapAuthError(error, "reset") };
          if (error.code === "user_not_found") return { message: resetSuccessMessage };
        } else {
          const actionLink = data?.properties?.action_link;
          if (actionLink) {
            const emailResult = await sendPasswordResetEmail({ email: parsed.data, link: actionLink });
            if (emailResult.ok) return { message: resetSuccessMessage };
          }
        }
      } catch (error) {
        logAuthError("custom recovery mail", error);
        if (isAuthConnectionError(error)) return { error: mapAuthError(error, "reset") };
      }
    }

    const supabase = await createServerSupabase();
    const { error } = await supabase.auth.resetPasswordForEmail(parsed.data, { redirectTo });
    if (error) {
      logAuthError("default recovery mail", error);
      return { error: mapAuthError(error, "reset") };
    }
    return { message: resetSuccessMessage };
  } catch (error) {
    logAuthError("password reset", error);
    return { error: mapAuthError(error, "reset") };
  }
}

export async function updateProfileAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = profileSchema.safeParse({
    name: formData.get("name"),
    company: formData.get("company") || undefined,
    phone: formData.get("phone"),
  });

  if (!parsed.success) {
    return {
      fieldErrors: toFieldErrors(parsed.error.flatten().fieldErrors),
    };
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { error: "로그인이 필요합니다." };
  }

  const { error } = await supabase.from("profiles").upsert(
    {
      user_id: user.id,
      name: parsed.data.name,
      company: parsed.data.company ?? "",
      phone: parsed.data.phone,
    },
    { onConflict: "user_id" },
  );

  if (error) {
    return { error: "프로필 저장에 실패했습니다." };
  }

  return { message: "프로필이 저장되었습니다." };
}

export async function updatePasswordAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = passwordUpdateSchema.safeParse({
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    return {
      fieldErrors: toFieldErrors(parsed.error.flatten().fieldErrors),
    };
  }

  try {
    const supabase = await createServerSupabase();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError && isAuthConnectionError(userError)) return { error: mapAuthError(userError, "update") };
    if (userError || !user) return { error: "로그인이 필요합니다." };
    const { error } = await supabase.auth.updateUser({ password: parsed.data.newPassword });
    if (error) return { error: mapAuthError(error, "update") };
    return { message: "비밀번호가 변경되었습니다." };
  } catch (error) {
    logAuthError("update password", error);
    return { error: mapAuthError(error, "update") };
  }
}

export async function signOutAction() {
  const supabase = await createServerSupabase();
  await supabase.auth.signOut();
  redirect("/");
}
