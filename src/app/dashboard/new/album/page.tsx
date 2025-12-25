import { redirect } from "next/navigation";

import { AlbumWizard } from "@/features/submissions/album-wizard";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata = {
  title: "음반 심의 접수",
};

export default async function AlbumSubmissionPage() {
  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: packageRows } = await supabase
    .from("packages")
    .select(
      "id, name, station_count, price_krw, description, package_stations ( station:stations ( id, name, code ) )",
    )
    .eq("is_active", true)
    .order("station_count", { ascending: true });

  const packages =
    packageRows?.map((pkg) => ({
      id: pkg.id,
      name: pkg.name,
      stationCount: pkg.station_count,
      priceKrw: pkg.price_krw,
      description: pkg.description,
      stations:
        pkg.package_stations
          ?.map((row) => row.station)
          .filter(Boolean) ?? [],
    })) ?? [];

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-12">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            Album Review
          </p>
          <h1 className="font-display mt-2 text-3xl text-foreground">
            음반 심의 접수
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            STEP01~05 중 현재는 패키지 선택과 신청서/파일 업로드까지 진행할 수
            있습니다.
          </p>
        </div>
      </div>

      <div className="mt-8">
        <AlbumWizard packages={packages} userId={user.id} />
      </div>
    </div>
  );
}
