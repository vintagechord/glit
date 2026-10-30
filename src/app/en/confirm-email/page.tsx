import { ConfirmEmailForm } from "@/features/auth/confirm-email-form";

export const metadata = { title: "Verify your signup email", referrer: "no-referrer" as const, robots: { index: false, follow: false } };

export default async function EnglishConfirmEmailPage({ searchParams }: { searchParams?: Promise<{ next?: string }> }) {
  const query = await searchParams;
  return <div className="mx-auto flex w-full max-w-5xl flex-1 items-center justify-center px-6 py-16">
    <div className="w-full max-w-xl space-y-7 rounded-[10px] border-2 border-border bg-card p-8 shadow-[6px_6px_0_#111111]">
      <h1 className="text-center font-display text-3xl font-black">Verify your signup email</h1>
      <ConfirmEmailForm nextPath={query?.next} />
    </div>
  </div>;
}
