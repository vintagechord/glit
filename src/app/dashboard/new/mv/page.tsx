import { redirect } from "next/navigation";

import { MvWizard } from "@/features/submissions/mv-wizard";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata = {
  title: "MV 심의 접수",
};

export default async function MvSubmissionPage() {
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
            MV Review
          </p>
          <h1 className="font-display mt-2 text-3xl text-foreground">
            MV 심의 접수
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            유통용/방송용 MV 심의를 선택하고 파일 업로드를 진행합니다.
          </p>
        </div>
      </div>

      <div className="mt-8">
        <MvWizard packages={packages} userId={user.id} />
      </div>
    </div>
  );
}
