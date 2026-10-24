export type RecoveryCredential = { token: string; signature: string };

/** Read credentials only. Legacy URL/session exchanges must never run on page load. */
export function readRecoveryCredential(url: URL): RecoveryCredential | null {
  if (["token_hash", "token", "type", "signature", "code", "error"].some(key => url.searchParams.has(key))) return null;
  const hash = new URLSearchParams(url.hash.slice(1));
  const token = hash.get("token_hash") ?? "";
  const signature = hash.get("signature") ?? "";
  if (hash.has("error") || hash.get("type") !== "recovery" || !/^[a-zA-Z0-9_-]{16,512}$/.test(token) || !/^[a-f0-9]{64}$/.test(signature)) return null;
  return { token, signature };
}
