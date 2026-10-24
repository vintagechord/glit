import { AccountEmailForm } from "@/features/auth/account-email-form";

export const metadata = { title: "아이디 찾기" };

export default async function FindIdPage({ searchParams }: { searchParams?: Promise<{ next?: string }> }) {
  const query = await searchParams;
  return <div className="mx-auto flex w-full max-w-5xl flex-1 items-center justify-center px-6 py-16">
    <div className="w-full max-w-xl space-y-7 rounded-[10px] border-2 border-border bg-card p-8 shadow-[6px_6px_0_#111111]">
      <h1 className="text-center font-display text-3xl font-black">아이디 찾기</h1>
      <AccountEmailForm purpose="account" nextPath={query?.next} />
    </div>
  </div>;
}
