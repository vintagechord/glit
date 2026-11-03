import { SIGN_IN_METHOD_TONES, signInMethodLabel } from "@/lib/admin/member-sign-in";

/** The member's sign-up method, then any other linked sign-in methods. */
export function SignInMethodBadges({ signupProvider, providers }: { signupProvider: string | null; providers: string[] }) {
  if (!signupProvider) return <span className="text-muted-foreground">-</span>;
  const linked = providers.filter((provider) => provider !== signupProvider);
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className={`rounded-[6px] border-2 border-[#111111] px-2 py-0.5 text-[11px] font-black ${SIGN_IN_METHOD_TONES[signupProvider] ?? "bg-white text-[#111111]"}`}>
        {signInMethodLabel(signupProvider)}
      </span>
      {linked.length ? (
        <span className="text-[11px] font-semibold text-muted-foreground">+ 연결 {linked.map(signInMethodLabel).join(", ")}</span>
      ) : null}
    </span>
  );
}
