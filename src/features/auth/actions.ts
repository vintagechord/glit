"use server";

import { redirect } from "next/navigation";
import { headers as nextHeaders } from "next/headers";
import { createHash, randomBytes } from "node:crypto";

import {
  sendPasswordResetEmail,
  sendWelcomeEmail,
  sendSignupVerificationEmail,
} from "@/lib/email";
import { createAdminClient } from "@/lib/supabase/admin";
import { isEmailLessSocialMember } from "@/lib/member-notification-email";
import { getEmailDeliveryConfiguration } from "@/lib/email-config";
import { getEmailDeliveryMode } from "@/lib/email-delivery-mode";
import {
  consumePersistentRateLimit,
  getRequestIdentifier,
} from "@/lib/request-rate-limit";
import { getAuthPageHref, getAuthReturnPath } from "./navigation";
import { SIGNUP_POLICY_VERSIONS } from "./policy";
import { createServerSupabase } from "@/lib/supabase/server";
import { buildUrl, getBaseUrl } from "@/lib/url";
import { isAuthConnectionError, logAuthError, mapAuthError } from "./errors";
import { getLoginSchema, getSignupSchema, profileSchema, getPasswordUpdateSchema, passwordUpdateSchema, getResetEmailSchema, toFieldErrors } from "./validation";
import { findAccountByEmail, SIGNUP_VERIFICATION_FLOW } from "./account-lookup";
import { signSignupToken, verifySignupToken, signRecoveryToken, verifyRecoveryToken } from "./signup-token";

export type ActionState = {
  error?: string;
  message?: string;
  fieldErrors?: Record<string, string>;
  retryAfterSeconds?: number;
  verificationPending?: boolean;
  notice?: "email_already_registered" | "email_not_registered" | "password_reset_sent";
};

// Forms on /en routes post locale=en; every customer-facing reply follows it.
const isEnglishLocale = (formData: FormData) => formData.get("locale") === "en";
const t = (english: boolean, korean: string, englishText: string) => (english ? englishText : korean);

const resetSuccessMessage = (english: boolean) => t(english, "가입한 이메일로 비밀번호 재설정 안내가 발송되었습니다. 메일함과 스팸함을 확인해주세요.", "Password reset instructions have been sent to your registered email. Check your inbox and spam folder.");
const signupPendingMessage = (english: boolean) => t(english, "입력한 이메일로 인증 메일을 발송했습니다. 메일의 버튼에서 비밀번호를 설정하면 가입이 완료됩니다.", "A verification email has been sent to the email you entered. Use its button to set your password and complete signup.");
const duplicateAccountNotice = (english: boolean): ActionState => ({ error: t(english, "이미 가입된 이메일입니다.", "This email is already registered."), notice: "email_already_registered" });
/** Same popup as a duplicate, but the signup form also offers the resend link. */
const pendingAccountNotice = (english: boolean): ActionState => ({
  error: t(english, "이미 가입 신청된 이메일입니다. 아직 이메일 인증이 완료되지 않았으니 아래에서 인증 메일을 다시 요청해주세요.", "This email already has a pending signup. Email verification is not complete yet, so request a new verification email below."),
  notice: "email_already_registered",
  verificationPending: true,
});
const missingAccountNotice = (english: boolean): ActionState => ({ error: t(english, "가입 이력이 없는 이메일입니다.", "This email has no signup history."), notice: "email_not_registered" });
const legacyPendingMessage = (english: boolean) => t(english, "이메일 인증을 완료하지 못한 계정입니다. 고객센터에 문의해주세요.", "This account has not completed email verification. Please contact support.");
const resetDeliveryError = (english: boolean) => t(english, "비밀번호 재설정 메일을 보내지 못했습니다. 잠시 후 다시 시도해주세요.", "We could not send the password reset email. Please try again shortly.");
const signupDeliveryError = (english: boolean) => t(english, "인증 메일을 보내지 못했습니다. 잠시 후 인증 메일을 다시 요청해주세요.", "We could not send the verification email. Please request another verification email shortly.");
const mailConfigurationError = (english: boolean) => t(english, "메일 발송 설정에 문제가 있어 메일을 보내지 못했습니다. 고객센터에 문의해주세요.", "An email configuration issue prevented delivery. Please contact support.");
const tooManyRequests = (english: boolean) => t(english, "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.", "Too many requests. Please wait and try again.");

const isDuplicateAccount = (error: unknown) => {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: string; message?: string };
  return ["email_exists", "user_already_exists"].includes(value.code ?? "") || /already.*registered|already.*exists/i.test(value.message ?? "");
};

/** A duplicate signup never re-sends mail by itself (docs/auth-email-configuration.md).
 * Only a pending account from this app's own verification flow is pointed at the
 * explicit resend screen; a lookup failure keeps the plain duplicate notice. */
async function describeDuplicateSignup(email: string, english: boolean, needsVerification: boolean): Promise<ActionState> {
  if (!needsVerification) return duplicateAccountNotice(english);
  try {
    const account = await findAccountByEmail(email);
    if (account && !account.email_confirmed_at && account.signupVerificationFlow === SIGNUP_VERIFICATION_FLOW) return pendingAccountNotice(english);
  } catch (error) {
    logAuthError("duplicate signup lookup", error);
  }
  return duplicateAccountNotice(english);
}

async function sendSignupConfirmation(email: string, formData: FormData, expectedUserId: string): Promise<ActionState> {
  const english = isEnglishLocale(formData);
  const redirectTo = buildUrl(getAuthPageHref("confirm-email", String(formData.get("next") ?? ""), english), getBaseUrl());
  const admin = createAdminClient();
  // The account already exists. GoTrue leaves its password unchanged for
  // signup links. An empty password also prevents account creation if it was
  // deleted during this request. Never pass retry-supplied credentials/data.
  const { data, error } = await admin.auth.admin.generateLink({
    type: "signup", email, password: "", options: { redirectTo },
  });
  if (error) {
    if (isDuplicateAccount(error)) return duplicateAccountNotice(english);
    logAuthError("generate signup link", error);
    return { error: mapAuthError(error, "signup", english), verificationPending: true };
  }
  if (!data.properties?.hashed_token || data.properties.verification_type !== "signup" ||
      data.user?.id !== expectedUserId || data.user.email?.trim().toLowerCase() !== email.trim().toLowerCase() ||
      data.user.email_confirmed_at || data.user.app_metadata?.signupVerificationFlow !== SIGNUP_VERIFICATION_FLOW) {
    return { error: t(english, "인증 링크를 준비하지 못했습니다. 잠시 후 인증 메일을 다시 요청해주세요.", "We could not prepare the verification link. Please request another verification email shortly."), verificationPending: true };
  }
  const link = new URL(redirectTo);
  // Fragment credentials stay out of page requests and ordinary access logs.
  link.hash = new URLSearchParams({ token_hash: data.properties.hashed_token, type: "signup", signature: signSignupToken(data.properties.hashed_token) }).toString();
  try {
    const sent = await sendSignupVerificationEmail({
      email, link: link.toString(), english,
      idempotencyKey: `signup:${createHash("sha256").update(data.properties.hashed_token).digest("hex")}`,
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    });
    if (!sent.ok) {
      console.warn("[Auth] signup email not accepted", { reason: sent.reason });
      return { error: signupDeliveryError(english), verificationPending: true };
    }
  } catch (error) {
    logAuthError("signup email delivery", error);
    return { error: signupDeliveryError(english), verificationPending: true };
  }
  return { message: signupPendingMessage(english), verificationPending: true, retryAfterSeconds: 60 };
}

/** A password rule the customer can act on (same or weak password); null for
 * anything else so provider internals never reach the screen. */
const describePasswordSetupFailure = (error: unknown, english: boolean) => {
  const mapped = mapAuthError(error, "update", english);
  return mapped === mapAuthError({}, "update", english) ? null : mapped;
};

const checkAuthRateLimit = async ({
  namespace,
  email,
  ipLimit,
  emailLimit,
  windowMs,
  onUnavailable,
}: {
  namespace: string;
  email: string;
  ipLimit: number;
  emailLimit: number;
  windowMs: number;
  onUnavailable?: "deny" | "memory";
}) => {
  const requestHeaders = await nextHeaders();
  const requestIdentifier = getRequestIdentifier(requestHeaders);
  const byIp = await consumePersistentRateLimit({
    namespace: `${namespace}-ip`,
    identifier: requestIdentifier,
    limit: ipLimit,
    windowMs,
    onUnavailable,
  });
  const byEmail = await consumePersistentRateLimit({
    namespace: `${namespace}-email`,
    identifier: email,
    limit: emailLimit,
    windowMs,
    onUnavailable,
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
  const english = isEnglishLocale(formData);
  const nextRaw = (formData.get("next") || "").toString().trim();
  const parsed = getLoginSchema(english).safeParse({
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
    // Login sends no mail; a limiter outage must not read as "too many requests".
    onUnavailable: "memory",
  });
  if (!rateLimit.allowed) {
    return {
      error: t(english, "로그인 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.", "Too many login attempts. Please wait and try again."),
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
      return { error: mapAuthError(error, "login", english) };
    }
  } catch (error) {
    logAuthError("login", error);
    return { error: mapAuthError(error, "login", english) };
  }

  const safeNext = getAuthReturnPath(parsed.data.next, english);
  redirect(safeNext ?? (english ? "/en/mypage" : "/mypage"));
}

export async function signupAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const english = isEnglishLocale(formData);
  const emailMode = getEmailDeliveryMode();
  if (emailMode === "invalid") return { error: mailConfigurationError(english) };
  const needsVerification = emailMode === "transactional";
  if (needsVerification && !getEmailDeliveryConfiguration().ok) return { error: mailConfigurationError(english) };
  // Transactional signup sets the real password only after mailbox ownership
  // is proved. A pre-registered account cannot activate a known password.
  const temporaryPassword = needsVerification ? randomBytes(32).toString("base64url") : null;
  const parsed = getSignupSchema(english).safeParse({
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
    // Shared office/mobile-carrier addresses sign up in bursts; the per-email
    // limit below is the real abuse guard.
    ipLimit: 30,
    emailLimit: 3,
    windowMs: 60 * 60 * 1_000,
  });
  if (!rateLimit.allowed) {
    return {
      error: t(english, "회원가입 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.", "Too many sign-up requests. Please wait and try again."),
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
      if (isDuplicateAccount(error)) return await describeDuplicateSignup(parsed.data.email, english, needsVerification);
      logAuthError("signup", error);
      return { error: mapAuthError(error, "signup", english) };
    }

    if (needsVerification) return await sendSignupConfirmation(parsed.data.email, formData, data.user.id);

    const emailResult = await sendWelcomeEmail({
      email: parsed.data.email,
      name: parsed.data.name,
    });

    if (!emailResult.ok && !emailResult.skipped) {
      console.warn("Welcome email failed", emailResult);
    }

    return {
      message: t(english, "회원가입이 완료되었습니다. 로그인해 주세요.", "Your account has been created. Please log in."),
    };
  } catch (error) {
    logAuthError("signup", error);
    return { error: mapAuthError(error, "signup", english) };
  }
}

export async function resendSignupAction(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const english = isEnglishLocale(formData);
  if (!getEmailDeliveryConfiguration().ok) return { error: mailConfigurationError(english) };
  const parsed = getResetEmailSchema(english).safeParse(formData.get("email"));
  if (!parsed.success) return { fieldErrors: { email: t(english, "유효한 이메일을 입력해주세요.", "Enter a valid email address.") } };
  const rateLimit = await checkAuthRateLimit({ namespace: "signup-confirmation", email: parsed.data, ipLimit: 10, emailLimit: 3, windowMs: 60 * 60 * 1000 });
  if (!rateLimit.allowed) return { error: tooManyRequests(english), retryAfterSeconds: rateLimit.retryAfterSeconds };
  try {
    const account = await findAccountByEmail(parsed.data);
    // Only accounts created with an unknowable temporary password may enter
    // this flow. Confirming legacy pending credentials before replacing them
    // could activate a password chosen by someone who did not own the inbox.
    if (account && !account.email_confirmed_at && account.signupVerificationFlow === SIGNUP_VERIFICATION_FLOW) return await sendSignupConfirmation(account.email, formData, account.id);
    if (!account) return missingAccountNotice(english);
    if (account.email_confirmed_at) return duplicateAccountNotice(english);
    return { error: legacyPendingMessage(english) };
  } catch (error) {
    logAuthError("resend signup", error);
    return { error: t(english, "인증 메일 요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.", "We could not process the verification email request. Please try again shortly.") };
  }
}

export async function confirmSignupAction(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const english = isEnglishLocale(formData);
  const invalidLink = t(english, "유효한 가입 인증 링크가 아닙니다. 인증 메일을 다시 요청해주세요.", "This signup verification link is invalid. Please request another verification email.");
  const token = String(formData.get("token_hash") ?? "").trim();
  const signature = String(formData.get("signature") ?? "");
  if (formData.get("type") !== "signup" || !/^[a-zA-Z0-9_-]{16,512}$/.test(token) || !/^[a-f0-9]{64}$/.test(signature)) {
    return { error: invalidLink };
  }
  const password = getPasswordUpdateSchema(english).safeParse({ newPassword: formData.get("newPassword"), confirmPassword: formData.get("confirmPassword") });
  if (!password.success) return { fieldErrors: toFieldErrors(password.error.flatten().fieldErrors) };
  const requestHeaders = await nextHeaders();
  const limit = await consumePersistentRateLimit({ namespace: "signup-verify-ip", identifier: getRequestIdentifier(requestHeaders), limit: 15, windowMs: 15 * 60 * 1000 });
  if (!limit.allowed) return { error: tooManyRequests(english), retryAfterSeconds: limit.retryAfterSeconds };
  try {
    if (!verifySignupToken(token, signature)) return { error: invalidLink };
    // An isolated, nonpersistent client keeps the OTP session off browser
    // cookies. No GET or page render consumes this one-use credential.
    const client = createAdminClient();
    const { data, error } = await client.auth.verifyOtp({ type: "signup", token_hash: token });
    if (error || !data.session) {
      logAuthError("verify signup", error);
      return { error: t(english, "인증 링크가 만료되었거나 이미 사용되었습니다. 인증 메일을 다시 요청해주세요.", "This verification link has expired or has already been used. Please request another verification email.") };
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
      const reason = updateError ? describePasswordSetupFailure(updateError, english) : null;
      return { error: reason
        ? (english
          ? `Your email was verified, but the password was not set. ${reason} Use password reset to choose a new password.`
          : `이메일은 확인했지만 비밀번호를 설정하지 못했습니다. ${reason} 비밀번호 찾기로 새 비밀번호를 설정해주세요.`)
        : t(english, "이메일은 확인했지만 비밀번호 설정을 완료하지 못했습니다. 비밀번호 찾기로 새 비밀번호를 설정해주세요.", "Your email was verified, but password setup could not be completed. Use password reset to choose a new password.") };
    }
    // OTP consumption makes this completion one-use. Delivery failure must not
    // undo a completed account; the shared outbox owns safe delivery retries.
    if (data.user?.id && data.user.email) {
      try {
        const welcome = await sendWelcomeEmail({ email: data.user.email, idempotencyKey: `welcome:${data.user.id}`, english });
        if (!welcome.ok) console.warn("[Auth] welcome email not accepted", { reason: welcome.reason });
      } catch (error) { logAuthError("welcome delivery", error); }
    }
    return { message: t(english, "이메일 확인과 비밀번호 설정이 완료되었습니다. 새 비밀번호로 로그인해주세요.", "Email verification and password setup are complete. Please log in with your new password.") };
  } catch (error) {
    logAuthError("confirm signup", error);
    return { error: t(english, "가입 확인을 완료하지 못했습니다. 비밀번호 찾기 또는 인증 메일 재요청을 이용해주세요.", "We could not complete signup verification. Use password reset or request another verification email.") };
  }
}

export async function resetPasswordAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const english = isEnglishLocale(formData);
  const resetConfigurationError = t(english, "메일 발송 설정에 문제가 있어 재설정 메일을 보내지 못했습니다. 고객센터에 문의해주세요.", "An email service configuration issue prevented us from sending the reset email. Please contact support.");
  const emailMode = getEmailDeliveryMode();
  if (emailMode === "manual") {
    return { error: t(english, "현재 이메일 자동 발송을 제공하지 않습니다. 비밀번호 재설정은 고객센터에 문의해주세요.", "Automated email is not available yet. Contact support for password reset help.") };
  }
  if (emailMode === "invalid") {
    return { error: resetConfigurationError };
  }
  const email = String(formData.get("resetEmail") || "").trim();
  if (!email) {
    return { fieldErrors: { resetEmail: t(english, "이메일을 입력해주세요.", "Enter your email address.") } };
  }
  const parsed = getResetEmailSchema(english).safeParse(email);
  if (!parsed.success) {
    return { fieldErrors: { resetEmail: t(english, "유효한 이메일을 입력해주세요.", "Enter a valid email address.") } };
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
      error: t(english, "재설정 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.", "Too many password reset requests. Please wait and try again."),
      retryAfterSeconds: rateLimit.retryAfterSeconds,
    };
  }

  try {
    const redirectTo = buildUrl(getAuthPageHref("reset-password", String(formData.get("next") ?? ""), english), getBaseUrl());
    // A configured sender owns this attempt. Falling back after a failed send
    // generates another token and masks delivery/configuration errors with the
    // built-in provider's project-wide email quota.
    const delivery = getEmailDeliveryConfiguration();
    if (!delivery.ok) {
      console.error("[Email] password reset sender unavailable", { diagnostic: delivery.diagnostic });
      return { error: resetConfigurationError };
    }
    const account = await findAccountByEmail(parsed.data);
    if (!account) return missingAccountNotice(english);
    if (!account.email_confirmed_at) {
      // Recovery verification confirms an unconfirmed GoTrue account before
      // changing its password. Only our unknowable-password signup flow is
      // safe for pending accounts; legacy pending credentials stay inactive.
      if (account.signupVerificationFlow === SIGNUP_VERIFICATION_FLOW) {
        return await sendSignupConfirmation(account.email, formData, account.id);
      }
      return { error: legacyPendingMessage(english) };
    }
    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.generateLink({
      type: "recovery",
      email: account.email,
      options: { redirectTo },
    });
    if (error) {
      logAuthError("generate recovery link", error);
      return { error: mapAuthError(error, "reset", english) };
    }
    const tokenHash = data?.properties?.hashed_token;
    if (!tokenHash || data.properties?.verification_type !== "recovery" ||
        data.user?.id !== account.id || !data.user.email_confirmed_at ||
        data.user.email?.trim().toLowerCase() !== account.email.trim().toLowerCase()) {
      logAuthError("generate recovery link", { code: "missing_recovery_token" });
      return { error: resetDeliveryError(english) };
    }
    // Sign only confirmed-account tokens. The page collects a new password
    // before any OTP verification; even JavaScript link scanners cannot
    // consume credentials. Fragment tokens stay out of request/referrer logs.
    const recoveryUrl = new URL(redirectTo);
    recoveryUrl.hash = new URLSearchParams({ token_hash: tokenHash, type: "recovery", signature: signRecoveryToken(tokenHash) }).toString();
    const emailResult = await sendPasswordResetEmail({
      email: account.email,
      english,
      link: recoveryUrl.toString(),
      idempotencyKey: `recovery:${createHash("sha256").update(tokenHash).digest("hex")}`,
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    });
    if (!emailResult.ok) {
      console.warn("[Auth] recovery email not accepted", { reason: emailResult.reason });
      return { error: resetDeliveryError(english) };
    }
    return { message: resetSuccessMessage(english), notice: "password_reset_sent", retryAfterSeconds: 60 };
  } catch (error) {
    logAuthError("password reset", error);
    // Account lookup or provider outages are distinct from "no such account":
    // the customer would otherwise wait for mail that was never requested.
    return { error: t(english, "비밀번호 재설정 요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.", "We could not process your password reset request. Please try again shortly.") };
  }
}

export async function completePasswordRecoveryAction(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const english = isEnglishLocale(formData);
  const token = String(formData.get("token_hash") ?? "").trim();
  const signature = String(formData.get("signature") ?? "");
  const invalidLink = t(english, "유효하지 않거나 만료된 재설정 링크입니다. 비밀번호 찾기에서 새 메일을 요청해주세요.", "This reset link is invalid or expired. Request a new password reset email.");
  const incomplete = t(english, "비밀번호 변경을 완료하지 못했습니다. 새 재설정 메일을 요청해주세요.", "We could not update your password. Request a new reset email.");
  if (formData.get("type") !== "recovery" || !/^[a-zA-Z0-9_-]{16,512}$/.test(token) || !/^[a-f0-9]{64}$/.test(signature)) return { error: invalidLink };
  const password = getPasswordUpdateSchema(english).safeParse({ newPassword: formData.get("newPassword"), confirmPassword: formData.get("confirmPassword") });
  if (!password.success) return { fieldErrors: toFieldErrors(password.error.flatten().fieldErrors) };
  const requestHeaders = await nextHeaders();
  const limit = await consumePersistentRateLimit({ namespace: "recovery-verify-ip", identifier: getRequestIdentifier(requestHeaders), limit: 15, windowMs: 15 * 60 * 1000 });
  if (!limit.allowed) return { error: tooManyRequests(english), retryAfterSeconds: limit.retryAfterSeconds };
  try {
    if (!verifyRecoveryToken(token, signature)) return { error: invalidLink };
    const client = createAdminClient();
    const { data, error } = await client.auth.verifyOtp({ type: "recovery", token_hash: token });
    if (error || !data.session) {
      logAuthError("verify recovery", error);
      return { error: invalidLink };
    }
    let updateError;
    let signOutError;
    try {
      ({ error: updateError } = await client.auth.updateUser({ password: password.data.newPassword }));
    } finally {
      ({ error: signOutError } = await createAdminClient().auth.admin.signOut(data.session.access_token, "global"));
    }
    if (updateError || signOutError) {
      logAuthError("finish recovery", updateError ?? signOutError);
      const reason = updateError ? describePasswordSetupFailure(updateError, english) : null;
      return { error: reason
        ? (english
          ? `${reason} This reset link has been used, so request a new email from password reset.`
          : `${reason} 이 재설정 링크는 사용되었으므로 비밀번호 찾기에서 새 메일을 요청해주세요.`)
        : incomplete };
    }
    return { message: t(english, "비밀번호가 변경되었습니다. 새 비밀번호로 로그인해주세요.", "Your password has been updated. Please log in with your new password.") };
  } catch (error) {
    logAuthError("complete recovery", error);
    return { error: incomplete };
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
    notificationEmail: formData.get("notificationEmail") ?? undefined,
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
    const hasNotificationEmail = formData.has("notificationEmail");
    if (hasNotificationEmail && !isEmailLessSocialMember(user)) {
      return { error: "이 계정은 계정 이메일로 심의 안내를 받습니다. 프로필을 새로고침해주세요." };
    }
    const { error } = await supabase.from("profiles").upsert({
      user_id: user.id,
      name: parsed.data.name,
      company: parsed.data.company ?? "",
      phone: parsed.data.phone,
      ...(hasNotificationEmail ? { notification_email: parsed.data.notificationEmail || null } : {}),
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
