type AuthError = { name?: string; code?: string | number; status?: number; message?: string; cause?: unknown };

const readError = (error: unknown): AuthError =>
  error !== null && typeof error === "object" ? error as AuthError : {};

export function isAuthConnectionError(error: unknown): boolean {
  const value = readError(error);
  const cause = readError(value.cause);
  return /fetch failed|failed to fetch|networkerror|network request failed|timed? ?out/i.test(value.message ?? "") ||
    /^(ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT)$/.test(String(value.code ?? cause.code ?? "")) ||
    value.name === "AuthRetryableFetchError" || value.name === "TimeoutError";
}

export function mapAuthError(error: unknown, operation: "login" | "signup" | "reset" | "update"): string {
  const value = readError(error);
  const message = (value.message ?? "").toLowerCase();
  const code = String(value.code ?? "");
  if (isAuthConnectionError(error)) {
    return "인증 서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요. 문제가 계속되면 고객센터에 문의해주세요.";
  }
  if (value.name === "SupabaseConfigurationError" || message.includes("missing supabase") || message.includes("missing supabase_service")) {
    return "인증 서비스 설정을 확인하고 있습니다. 잠시 후 다시 시도해주세요.";
  }
  if (value.status === 429 || /rate limit|too many/.test(message) || /over_.*rate_limit/.test(code)) {
    return "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.";
  }
  if (operation === "login") {
    if (code === "email_not_confirmed" || /email not confirmed|email confirmation/.test(message)) {
      return "이메일 인증 후 로그인해주세요. 인증 메일이 없다면 고객센터에 문의해주세요.";
    }
    if ((value.status ?? 0) >= 500) return "인증 서버에 일시적인 문제가 있습니다. 잠시 후 다시 시도해주세요.";
    return "이메일 또는 비밀번호를 확인해주세요.";
  }
  if (operation === "signup" && /already|registered|exists|duplicate/.test(`${message} ${code}`)) {
    return "이미 가입된 이메일입니다. 로그인 또는 비밀번호 재설정을 이용해주세요.";
  }
  if (/invalid email/.test(message) || code === "email_address_invalid") {
    return "올바른 이메일 주소를 입력해주세요.";
  }
  if (code === "weak_password" || /weak password|password should|password must|password.*least/.test(message)) {
    return "비밀번호는 8자 이상으로 입력하고, 너무 단순한 비밀번호는 피해주세요.";
  }
  if (code === "same_password") return "현재 비밀번호와 다른 새 비밀번호를 입력해주세요.";
  if (operation === "reset") return "비밀번호 재설정 메일을 보낼 수 없습니다. 잠시 후 다시 시도해주세요.";
  if (operation === "update") return "비밀번호를 변경할 수 없습니다. 잠시 후 다시 시도해주세요.";
  return "회원가입을 완료할 수 없습니다. 입력 내용을 다시 확인해주세요.";
}

export function logAuthError(operation: string, error: unknown) {
  const value = readError(error);
  // Do not log provider payloads, addresses, passwords, or recovery links.
  console.error(`[Auth] ${operation}`, {
    kind: isAuthConnectionError(error) ? "connection" : value.name === "SupabaseConfigurationError" ? "configuration" : "provider",
    status: typeof value.status === "number" ? value.status : undefined,
  });
}
