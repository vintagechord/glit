import type { SupabaseClient } from "@supabase/supabase-js";
import { isAuthConnectionError, mapAuthError } from "./errors";

type RecoveryAuth = Pick<SupabaseClient["auth"], "getSession" | "exchangeCodeForSession" | "verifyOtp" | "setSession">;
export type RecoveryResult = { ok: true } | { ok: false; message: string };
const expired = "세션을 확인할 수 없습니다. 링크가 만료되었거나 이미 사용되었습니다. 새 링크를 요청해주세요.";

/** Handle each credential type exactly once; never reinterpret a PKCE code as an OTP. */
export async function verifyRecoverySession(auth: RecoveryAuth, url: URL): Promise<RecoveryResult> {
  const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
  if (url.searchParams.has("error") || hash.has("error")) return { ok: false, message: expired };
  const tokenHash = url.searchParams.get("token_hash") || url.searchParams.get("token");
  const code = url.searchParams.get("code");
  const accessToken = hash.get("access_token");
  const refreshToken = hash.get("refresh_token");
  try {
    if (tokenHash) {
      const { data, error } = await auth.verifyOtp({ type: "recovery", token_hash: tokenHash });
      if (error) throw error;
      return data.session ? { ok: true } : { ok: false, message: expired };
    }
    if (code) {
      const { data, error } = await auth.exchangeCodeForSession(code);
      if (error) throw error;
      return data.session ? { ok: true } : { ok: false, message: expired };
    }
    if (accessToken || refreshToken) {
      if (!accessToken || !refreshToken) return { ok: false, message: expired };
      const { data, error } = await auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
      if (error) throw error;
      return data.session ? { ok: true } : { ok: false, message: expired };
    }
    // A successful previous visit may already have exchanged and removed the link.
    const { data, error } = await auth.getSession();
    if (error) throw error;
    return data.session ? { ok: true } : { ok: false, message: "유효한 비밀번호 재설정 링크가 아닙니다. 메일의 링크를 다시 클릭해주세요." };
  } catch (error) {
    if (isAuthConnectionError(error)) return { ok: false, message: mapAuthError(error, "update") };
    const message = error instanceof Error ? error.message : "";
    return { ok: false, message: /PKCE|code verifier|flow state/i.test(message)
      ? "메일을 요청한 동일한 브라우저에서 링크를 열어주세요. 링크가 만료되었다면 새 링크를 요청해주세요."
      : expired };
  }
}
