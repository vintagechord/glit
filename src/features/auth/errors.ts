type AuthError = { name?: string; code?: string | number; status?: number; message?: string; cause?: unknown };

const readError = (error: unknown): AuthError =>
  error !== null && typeof error === "object" ? error as AuthError : {};

const t = (english: boolean, korean: string, englishText: string) => (english ? englishText : korean);

export function isAuthConnectionError(error: unknown): boolean {
  const value = readError(error);
  const cause = readError(value.cause);
  return /fetch failed|failed to fetch|networkerror|network request failed|timed? ?out/i.test(value.message ?? "") ||
    /^(ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT)$/.test(String(value.code ?? cause.code ?? "")) ||
    value.name === "AuthRetryableFetchError" || value.name === "TimeoutError";
}

export function mapAuthError(error: unknown, operation: "login" | "signup" | "reset" | "update", english = false): string {
  const value = readError(error);
  const message = (value.message ?? "").toLowerCase();
  const code = String(value.code ?? "");
  if (isAuthConnectionError(error)) {
    return t(english, "인증 서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요. 문제가 계속되면 고객센터에 문의해주세요.", "We could not connect to the authentication service. Please try again shortly. If the problem continues, contact support.");
  }
  if (value.name === "SupabaseConfigurationError" || message.includes("missing supabase") || message.includes("missing supabase_service")) {
    return t(english, "인증 서비스 설정을 확인하고 있습니다. 잠시 후 다시 시도해주세요.", "We are checking the authentication service configuration. Please try again shortly.");
  }
  if (operation === "reset" && (code === "over_email_send_rate_limit" || /email.*rate limit/.test(message))) {
    return t(english, "메일 발송 서비스의 전송 한도에 도달했습니다. 잠시 후 다시 시도하거나 고객센터에 문의해주세요.", "The email service has reached its sending limit. Please try again later or contact support.");
  }
  if (value.status === 429 || /rate limit|too many/.test(message) || /over_.*rate_limit/.test(code)) {
    return t(english, "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.", "Too many requests. Please wait and try again.");
  }
  if (operation === "login") {
    if (code === "email_not_confirmed" || /email not confirmed|email confirmation/.test(message)) {
      return t(english, "이메일 인증 후 로그인해주세요. 인증 메일이 없다면 고객센터에 문의해주세요.", "Verify your email before logging in. If you cannot find the verification email, contact support.");
    }
    if ((value.status ?? 0) >= 500) return t(english, "인증 서버에 일시적인 문제가 있습니다. 잠시 후 다시 시도해주세요.", "The authentication service is temporarily unavailable. Please try again shortly.");
    return t(english, "이메일 또는 비밀번호를 확인해주세요.", "Check your email or password.");
  }
  if (operation === "signup" && /already|registered|exists|duplicate/.test(`${message} ${code}`)) {
    return t(english, "이미 가입된 이메일입니다. 로그인 또는 비밀번호 재설정을 이용해주세요.", "This email is already registered. Please log in or reset your password.");
  }
  if (/invalid email/.test(message) || code === "email_address_invalid") {
    return t(english, "올바른 이메일 주소를 입력해주세요.", "Enter a valid email address.");
  }
  if (code === "same_password") return t(english, "현재 비밀번호와 다른 새 비밀번호를 입력해주세요.", "Choose a new password that differs from your current password.");
  if (code === "weak_password" || /weak password|password should|password must|password.*least/.test(message)) {
    return t(english, "비밀번호는 8자 이상으로 입력하고, 너무 단순한 비밀번호는 피해주세요.", "Use at least 8 characters and avoid a password that is too simple.");
  }
  if (operation === "reset") return t(english, "비밀번호 재설정 메일을 보낼 수 없습니다. 잠시 후 다시 시도해주세요.", "We could not send the password reset email. Please try again shortly.");
  if (operation === "update") return t(english, "비밀번호를 변경할 수 없습니다. 잠시 후 다시 시도해주세요.", "We could not update your password. Please try again shortly.");
  return t(english, "회원가입을 완료할 수 없습니다. 입력 내용을 다시 확인해주세요.", "We could not complete your sign-up. Please check your details.");
}

export function logAuthError(operation: string, error: unknown) {
  const value = readError(error);
  // Do not log provider payloads, addresses, passwords, or recovery links.
  console.error(`[Auth] ${operation}`, {
    kind: isAuthConnectionError(error) ? "connection" : value.name === "SupabaseConfigurationError" ? "configuration" : "provider",
    status: typeof value.status === "number" ? value.status : undefined,
    code: typeof value.code === "string" && /^[a-z_]{1,64}$/.test(value.code) ? value.code : undefined,
  });
}
