"use server";

import { redirect } from "next/navigation";
import { headers as nextHeaders } from "next/headers";
import { randomBytes } from "node:crypto";

import {
  sendPasswordResetEmail,
  sendWelcomeEmail,
  sendSignupVerificationEmail,
  sendAccountIdEmail,
} from "@/lib/email";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEmailDeliveryConfiguration } from "@/lib/email-config";
import { getEmailDeliveryMode } from "@/lib/email-delivery-mode";
import {
  consumeRateLimit,
  getRequestIdentifier,
} from "@/lib/request-rate-limit";
import { getAuthPageHref, getAuthReturnPath } from "./navigation";
import { SIGNUP_POLICY_VERSIONS } from "./policy";
import { createServerSupabase } from "@/lib/supabase/server";
import { buildUrl, getBaseUrl } from "@/lib/url";
import { isAuthConnectionError, logAuthError, mapAuthError } from "./errors";
import { loginSchema, signupSchema, profileSchema, passwordUpdateSchema, resetEmailSchema, toFieldErrors } from "./validation";
import { findAccountByEmail, SIGNUP_VERIFICATION_FLOW } from "./account-lookup";
import { signSignupToken, verifySignupToken } from "./signup-token";

export type ActionState = {
  error?: string;
  message?: string;
  fieldErrors?: Record<string, string>;
  retryAfterSeconds?: number;
  verificationPending?: boolean;
};

const resetSuccessMessage = "가입된 이메일이라면 비밀번호 재설정 메일을 보냈습니다. 메일함을 확인해주세요.";
const signupPendingMessage = "이메일 확인이 필요한 계정이면 인증 메일을 보냈습니다. 메일의 버튼으로 확인을 완료해주세요. 이미 가입했거나 메일이 오지 않으면 비밀번호 찾기 또는 고객센터를 이용해주세요.";
const accountLookupMessage = "가입된 이메일이라면 아이디 안내를 보내드립니다. 메일함과 스팸함을 확인해주세요.";
const mailConfigurationError = "메일 발송 설정에 문제가 있어 메일을 보내지 못했습니다. 고객센터에 문의해주세요.";

const isDuplicateAccount = (error: unknown) => {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: string; message?: string };
  return ["email_exists", "user_already_exists"].includes(value.code ?? "") || /already.*registered|already.*exists/i.test(value.message ?? "");
};

async function sendSignupConfirmation(email: string, formData: FormData): Promise<ActionState> {
  const english = formData.get("locale") === "en";
  const redirectTo = buildUrl(getAuthPageHref("confirm-email", String(formData.get("next") ?? ""), english), getBaseUrl());
  const admin = createAdminClient();
  // The account already exists. GoTrue leaves its password unchanged for
  // signup links. An empty password also prevents account creation if it was
  // deleted during this request. Never pass retry-supplied credentials/data.
  const { data, error } = await admin.auth.admin.generateLink({
    type: "signup", email, password: "", options: { redirectTo },
  });
  if (error) {
    if (isDuplicateAccount(error)) return { message: signupPendingMessage, verificationPending: true, retryAfterSeconds: 60 };
    logAuthError("generate signup link", error);
    return { error: mapAuthError(error, "signup"), verificationPending: true };
  }
  if (!data.properties?.hashed_token || data.properties.verification_type !== "signup") {
    return { error: "인증 링크를 준비하지 못했습니다. 잠시 후 인증 메일을 다시 요청해주세요.", verificationPending: true };
  }
  const link = new URL(redirectTo);
  // Fragment credentials stay out of page requests and ordinary access logs.
  link.hash = new URLSearchParams({ token_hash: data.properties.hashed_token, type: "signup", signature: signSignupToken(data.properties.hashed_token) }).toString();
  const sent = await sendSignupVerificationEmail({ email, link: link.toString() });
  if (!sent.ok) return {
    error: sent.reason === "configuration" ? mailConfigurationError : "인증 메일을 보내지 못했습니다. 아래에서 인증 메일을 다시 요청해주세요.",
    verificationPending: true, retryAfterSeconds: sent.retryAfterSeconds,
  };
  return { message: signupPendingMessage, verificationPending: true, retryAfterSeconds: 60 };
}

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
  return {
    allowed: byIp.allowed && byEmail.allowed,
    retryAfterSeconds: Math.max(byIp.retryAfterSeconds, byEmail.retryAfterSeconds),
  };
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

  const rateLimit = await checkAuthRateLimit({
    namespace: "login",
    email: parsed.data.email,
    ipLimit: 20,
    emailLimit: 10,
    windowMs: 15 * 60 * 1_000,
  });
  if (!rateLimit.allowed) {
    return {
      error: "로그인 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
      retryAfterSeconds: rateLimit.retryAfterSeconds,
    };
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

  const english = formData.get("locale") === "en";
  const safeNext = getAuthReturnPath(parsed.data.next, english);
  redirect(safeNext ?? (english ? "/en/mypage" : "/mypage"));
}

export async function signupAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const emailMode = getEmailDeliveryMode();
  if (emailMode === "invalid") return { error: mailConfigurationError };
  const needsVerification = emailMode === "transactional";
  if (needsVerification && !getEmailDeliveryConfiguration().ok) return { error: mailConfigurationError };
  // Transactional signup sets the real password only after mailbox ownership
  // is proved. A pre-registered account cannot activate a known password.
  const temporaryPassword = needsVerification ? randomBytes(32).toString("base64url") : null;
  const parsed = signupSchema.safeParse({
    name: (formData.get("name") || "").toString().trim() || undefined,
    company: (formData.get("company") || "").toString().trim() || undefined,
    phone: (formData.get("phone") || "").toString().trim() || undefined,
    email: formData.get("email"),
    password: temporaryPassword ?? formData.get("password"),
    confirmPassword: temporaryPassword ?? formData.get("confirmPassword"),
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

  const rateLimit = await checkAuthRateLimit({
    namespace: "signup",
    email: parsed.data.email,
    ipLimit: 5,
    emailLimit: 3,
    windowMs: 60 * 60 * 1_000,
  });
  if (!rateLimit.allowed) {
    return {
      error: "회원가입 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
      retryAfterSeconds: rateLimit.retryAfterSeconds,
    };
  }

  try {
    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.createUser({
      email: parsed.data.email,
      password: parsed.data.password,
      email_confirm: !needsVerification,
      app_metadata: {
        signupConsent: {
          acceptedAt: new Date().toISOString(),
          versions: SIGNUP_POLICY_VERSIONS,
          age14OrOlder: true,
          terms: true,
          privacy: true,
          refund: true,
          marketing: parsed.data.agreeMarketing === "on",
        },
        emailOwnershipVerifiedAtSignup: false,
        ...(needsVerification ? { signupVerificationFlow: SIGNUP_VERIFICATION_FLOW } : {}),
      },
      user_metadata: {
        name: parsed.data.name ?? "",
        company: parsed.data.company ?? "",
        phone: parsed.data.phone ?? "",
        marketingConsent: parsed.data.agreeMarketing === "on",
      },
    });

    if (error || !data.user) {
      if (needsVerification && isDuplicateAccount(error)) {
        const existing = await findAccountByEmail(parsed.data.email);
        if (existing && !existing.email_confirmed_at && existing.signupVerificationFlow === SIGNUP_VERIFICATION_FLOW) return await sendSignupConfirmation(existing.email, formData);
        return { message: signupPendingMessage, verificationPending: true, retryAfterSeconds: 60 };
      }
      logAuthError("signup", error);
      return { error: mapAuthError(error, "signup") };
    }

    if (needsVerification) return await sendSignupConfirmation(parsed.data.email, formData);

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

export async function resendSignupAction(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  if (!getEmailDeliveryConfiguration().ok) return { error: mailConfigurationError };
  const parsed = resetEmailSchema.safeParse(formData.get("email"));
  if (!parsed.success) return { fieldErrors: { email: "유효한 이메일을 입력해주세요." } };
  const rateLimit = await checkAuthRateLimit({ namespace: "signup-confirmation", email: parsed.data, ipLimit: 10, emailLimit: 3, windowMs: 60 * 60 * 1000 });
  if (!rateLimit.allowed) return { error: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.", retryAfterSeconds: rateLimit.retryAfterSeconds };
  try {
    const account = await findAccountByEmail(parsed.data);
    // Only accounts created with an unknowable temporary password may enter
    // this flow. Confirming legacy pending credentials before replacing them
    // could activate a password chosen by someone who did not own the inbox.
    if (account && !account.email_confirmed_at && account.signupVerificationFlow === SIGNUP_VERIFICATION_FLOW) return await sendSignupConfirmation(account.email, formData);
    return { message: signupPendingMessage, verificationPending: true, retryAfterSeconds: 60 };
  } catch (error) {
    logAuthError("resend signup", error);
    return { error: "인증 메일 요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요." };
  }
}

export async function confirmSignupAction(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const token = String(formData.get("token_hash") ?? "").trim();
  const signature = String(formData.get("signature") ?? "");
  if (formData.get("type") !== "signup" || !/^[a-zA-Z0-9_-]{16,512}$/.test(token) || !/^[a-f0-9]{64}$/.test(signature)) {
    return { error: "유효한 가입 인증 링크가 아닙니다. 인증 메일을 다시 요청해주세요." };
  }
  const password = passwordUpdateSchema.safeParse({ newPassword: formData.get("newPassword"), confirmPassword: formData.get("confirmPassword") });
  if (!password.success) return { fieldErrors: toFieldErrors(password.error.flatten().fieldErrors) };
  const requestHeaders = await nextHeaders();
  const limit = consumeRateLimit({ namespace: "signup-verify-ip", identifier: getRequestIdentifier(requestHeaders), limit: 15, windowMs: 15 * 60 * 1000 });
  if (!limit.allowed) return { error: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.", retryAfterSeconds: limit.retryAfterSeconds };
  try {
    if (!verifySignupToken(token, signature)) return { error: "유효한 가입 인증 링크가 아닙니다. 인증 메일을 다시 요청해주세요." };
    // An isolated, nonpersistent client keeps the OTP session off browser
    // cookies. No GET or page render consumes this one-use credential.
    const client = createAdminClient();
    const { data, error } = await client.auth.verifyOtp({ type: "signup", token_hash: token });
    if (error || !data.session) {
      logAuthError("verify signup", error);
      return { error: "인증 링크가 만료되었거나 이미 사용되었습니다. 인증 메일을 다시 요청해주세요." };
    }
    let updateError;
    let signOutError;
    try {
      ({ error: updateError } = await client.auth.updateUser({ password: password.data.newPassword }));
    } finally {
      ({ error: signOutError } = await createAdminClient().auth.admin.signOut(data.session.access_token, "global"));
    }
    if (updateError || signOutError) {
      logAuthError("finish signup", updateError ?? signOutError);
      return { error: "이메일은 확인했지만 비밀번호 설정을 완료하지 못했습니다. 비밀번호 찾기로 새 비밀번호를 설정해주세요." };
    }
    return { message: "이메일 확인과 비밀번호 설정이 완료되었습니다. 새 비밀번호로 로그인해주세요." };
  } catch (error) {
    logAuthError("confirm signup", error);
    return { error: "가입 확인을 완료하지 못했습니다. 비밀번호 찾기 또는 인증 메일 재요청을 이용해주세요." };
  }
}

export async function findAccountIdAction(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  if (!getEmailDeliveryConfiguration().ok) return { error: mailConfigurationError };
  const parsed = resetEmailSchema.safeParse(formData.get("email"));
  if (!parsed.success) return { fieldErrors: { email: "유효한 이메일을 입력해주세요." } };
  const limit = await checkAuthRateLimit({ namespace: "account-id", email: parsed.data, ipLimit: 10, emailLimit: 3, windowMs: 60 * 60 * 1000 });
  if (!limit.allowed) return { error: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.", retryAfterSeconds: limit.retryAfterSeconds };
  try {
    const account = await findAccountByEmail(parsed.data);
    if (account) {
      const english = formData.get("locale") === "en";
      try {
        const result = await sendAccountIdEmail({ email: account.email, link: buildUrl(getAuthPageHref("login", String(formData.get("next") ?? ""), english), getBaseUrl()) });
        if (!result.ok) console.warn("[Auth] account ID email not accepted", { reason: result.reason });
      } catch (error) {
        logAuthError("account ID delivery", error);
      }
    }
    // Identical response on absent accounts and recipient-specific failures.
    return { message: accountLookupMessage, retryAfterSeconds: 60 };
  } catch (error) {
    logAuthError("account ID lookup", error);
    return { error: "아이디 안내 요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요." };
  }
}

export async function resetPasswordAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const emailMode = getEmailDeliveryMode();
  if (emailMode === "manual") {
    return { error: "현재 이메일 자동 발송을 제공하지 않습니다. 비밀번호 재설정은 고객센터에 문의해주세요." };
  }
  if (emailMode === "invalid") {
    return { error: "메일 발송 설정에 문제가 있어 재설정 메일을 보내지 못했습니다. 고객센터에 문의해주세요." };
  }
  const email = String(formData.get("resetEmail") || "").trim();
  if (!email) {
    return { fieldErrors: { resetEmail: "이메일을 입력해주세요." } };
  }
  const parsed = resetEmailSchema.safeParse(email);
  if (!parsed.success) {
    return { fieldErrors: { resetEmail: "유효한 이메일을 입력해주세요." } };
  }

  const rateLimit = await checkAuthRateLimit({
    namespace: "password-reset",
    email: parsed.data,
    ipLimit: 10,
    emailLimit: 5,
    windowMs: 60 * 60 * 1_000,
  });
  if (!rateLimit.allowed) {
    return {
      error: "재설정 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
      retryAfterSeconds: rateLimit.retryAfterSeconds,
    };
  }

  try {
    const english = formData.get("locale") === "en";
    const redirectTo = buildUrl(getAuthPageHref("reset-password", String(formData.get("next") ?? ""), english), getBaseUrl());
    // A configured sender owns this attempt. Falling back after a failed send
    // generates another token and masks delivery/configuration errors with the
    // built-in provider's project-wide email quota.
    const delivery = getEmailDeliveryConfiguration();
    if (!delivery.ok) {
        console.error("[Email] password reset sender unavailable", { diagnostic: delivery.diagnostic });
        return { error: "메일 발송 설정에 문제가 있어 재설정 메일을 보내지 못했습니다. 고객센터에 문의해주세요." };
    }
      const admin = createAdminClient();
      const { data, error } = await admin.auth.admin.generateLink({
        type: "recovery",
        email: parsed.data,
        options: { redirectTo },
      });
      if (error) {
        logAuthError("generate recovery link", error);
        if (error.code === "user_not_found") {
          return { message: resetSuccessMessage, retryAfterSeconds: 60 };
        }
        return { error: mapAuthError(error, "reset") };
      }
      const tokenHash = data?.properties?.hashed_token;
      if (!tokenHash) {
        logAuthError("generate recovery link", { code: "missing_recovery_token" });
        return { error: "비밀번호 재설정 링크를 준비하지 못했습니다. 잠시 후 다시 시도해주세요." };
      }
      // Verify on our recovery screen so a simple link-prefetch request does
      // not consume the one-time token at the mail provider's redirect URL.
      const recoveryUrl = new URL(redirectTo);
      recoveryUrl.searchParams.set("token_hash", tokenHash);
      recoveryUrl.searchParams.set("type", "recovery");
      const emailResult = await sendPasswordResetEmail({
        email: parsed.data,
        link: recoveryUrl.toString(),
      });
      if (emailResult.ok) {
        return { message: resetSuccessMessage, retryAfterSeconds: 60 };
      }
      return {
        error: emailResult.reason === "configuration"
          ? "메일 발송 설정에 문제가 있어 재설정 메일을 보내지 못했습니다. 고객센터에 문의해주세요."
          : emailResult.reason === "rate_limit"
            ? "메일 발송 서비스가 잠시 혼잡합니다. 잠시 후 다시 시도해주세요."
            : "재설정 메일을 보내지 못했습니다. 잠시 후 다시 시도해주세요. 문제가 계속되면 고객센터에 문의해주세요.",
        retryAfterSeconds: emailResult.retryAfterSeconds,
      };
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

  try {
    const supabase = await createServerSupabase();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError && isAuthConnectionError(userError)) {
      return { error: "인증 서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요." };
    }
    if (userError || !user) return { error: "로그인이 필요합니다." };
    const { error } = await supabase.from("profiles").upsert({
      user_id: user.id,
      name: parsed.data.name,
      company: parsed.data.company ?? "",
      phone: parsed.data.phone,
    }, { onConflict: "user_id" });
    if (error) {
      logAuthError("update profile", error);
      return { error: "프로필 저장에 실패했습니다. 잠시 후 다시 시도해주세요." };
    }
    return { message: "프로필이 저장되었습니다." };
  } catch (error) {
    logAuthError("update profile", error);
    return { error: "프로필 저장에 실패했습니다. 연결 상태를 확인하고 다시 시도해주세요." };
  }
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
