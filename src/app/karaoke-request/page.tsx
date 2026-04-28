import { KaraokeTabs } from "@/features/karaoke/karaoke-tabs";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata = {
  title: "노래방 등록",
};

export default async function KaraokeRequestPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: promotions } = await supabase
    .from("karaoke_promotions")
    .select(
      "id, credits_balance, credits_required, tj_enabled, ky_enabled, reference_url, submission:submissions ( id, title, artist_name, melon_url )",
    )
    .eq("status", "ACTIVE")
    .gt("credits_balance", 0)
    .order("credits_balance", { ascending: false })
    .limit(12);

  let creditBalance = 0;
  let requests: Array<{
    id: string;
    title: string;
    artist: string | null;
    file_path?: string | null;
    status: string;
    created_at: string;
    updated_at: string | null;
  }> = [];
  if (user) {
    const { data: creditRow } = await supabase
      .from("karaoke_credits")
      .select("balance")
      .eq("user_id", user.id)
      .maybeSingle();
    creditBalance = creditRow?.balance ?? 0;

    const { data: requestRows } = await supabase
      .from("karaoke_requests")
      .select("id, title, artist, file_path, status, created_at, updated_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    requests = requestRows ?? [];
  }

  const normalizedPromotions =
    promotions?.map((promotion) => ({
      ...promotion,
      submission: Array.isArray(promotion.submission)
        ? promotion.submission[0]
        : promotion.submission,
    })) ?? [];

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-12">
      <p className="bauhaus-kicker">
        Karaoke
      </p>
      <h1 className="font-display mt-4 text-3xl font-black text-foreground">
        노래방 등록
      </h1>
      <p className="mt-3 text-sm font-semibold text-muted-foreground">
        비회원도 요청할 수 있으며, 추천 참여로 크레딧을 적립할 수 있습니다.
      </p>

      <div className="mt-8 rounded-[10px] border-2 border-[#111111] bg-card p-6 shadow-[8px_8px_0_#111111] dark:border-[#f2cf27] dark:shadow-[8px_8px_0_#f2cf27]">
        <KaraokeTabs
          userId={user?.id ?? null}
          promotions={normalizedPromotions}
          creditBalance={creditBalance}
          requests={requests}
        />
      </div>
    </div>
  );
}
