import { PasswordRecoveryForm } from "@/features/auth/password-recovery-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "비밀번호 재설정", referrer: "no-referrer" as const, robots: { index: false, follow: false } };

export default async function ResetPasswordPage({ searchParams }: { searchParams?: Promise<{ next?: string }> }) {
  const query = await searchParams;
  return <div className="mx-auto flex w-full max-w-5xl flex-1 items-center justify-center px-6 py-16">
    <div className="w-full max-w-xl rounded-[10px] border-2 border-border bg-card p-8 shadow-[6px_6px_0_#111111]">
      <PasswordRecoveryForm nextPath={query?.next} />
    </div>
  </div>;
}
