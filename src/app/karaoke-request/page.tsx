import { redirect } from "next/navigation";

import { KaraokeForm } from "@/features/karaoke/karaoke-form";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata = {
  title: "노래방 등록 요청",
};

export default async function KaraokeRequestPage() {
  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-12">
      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
        Karaoke
      </p>
      <h1 className="font-display mt-2 text-3xl text-foreground">
        노래방 등록 요청
      </h1>
      <p className="mt-3 text-sm text-muted-foreground">
        요청 접수 후 담당자가 검토하여 진행 결과를 안내드립니다.
      </p>

      <div className="mt-8 rounded-[32px] border border-border/60 bg-card/80 p-6">
        <KaraokeForm userId={user.id} />
      </div>
    </div>
  );
}
