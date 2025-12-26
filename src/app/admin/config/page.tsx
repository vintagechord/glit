import {
  updatePackageStationsFormAction,
  upsertPackageFormAction,
  upsertStationFormAction,
} from "@/features/admin/actions";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata = {
  title: "패키지/방송국 설정",
};

export default async function AdminConfigPage() {
  const supabase = await createServerSupabase();
  const { data: packages } = await supabase
    .from("packages")
    .select(
      "id, name, station_count, price_krw, description, is_active, package_stations ( station:stations ( code ) )",
    )
    .order("station_count", { ascending: true });

  const { data: stations } = await supabase
    .from("stations")
    .select("id, name, code, is_active")
    .order("name", { ascending: true });

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-12">
      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
        Admin Config
      </p>
      <h1 className="font-display mt-2 text-3xl text-foreground">
        패키지/방송국 설정
      </h1>

      <div className="mt-8 space-y-8">
        <section className="space-y-4 rounded-[32px] border border-border/60 bg-card/80 p-6">
          <h2 className="text-lg font-semibold text-foreground">
            패키지 관리
          </h2>
          <div className="space-y-4">
            {packages?.map((pkg) => {
              const stationCodes =
                pkg.package_stations
                  ?.map((row) => row.station?.code)
                  .filter(Boolean)
                  .join(", ") ?? "";

              return (
                <div
                  key={pkg.id}
                  className="rounded-2xl border border-border/60 bg-background/70 p-4"
                >
                  <form action={upsertPackageFormAction} className="grid gap-3 md:grid-cols-6">
                    <input type="hidden" name="id" value={pkg.id} />
                    <input
                      name="name"
                      defaultValue={pkg.name}
                      className="rounded-2xl border border-border/70 bg-background px-3 py-2 text-xs md:col-span-2"
                    />
                    <input
                      name="stationCount"
                      type="number"
                      defaultValue={pkg.station_count}
                      className="rounded-2xl border border-border/70 bg-background px-3 py-2 text-xs"
                    />
                    <input
                      name="priceKrw"
                      type="number"
                      defaultValue={pkg.price_krw}
                      className="rounded-2xl border border-border/70 bg-background px-3 py-2 text-xs"
                    />
                    <input
                      name="description"
                      defaultValue={pkg.description ?? ""}
                      placeholder="설명"
                      className="rounded-2xl border border-border/70 bg-background px-3 py-2 text-xs md:col-span-2"
                    />
                    <label className="flex items-center gap-2 text-xs text-muted-foreground md:col-span-1">
                      <input
                        type="checkbox"
                        name="isActive"
                        defaultChecked={pkg.is_active}
                        className="h-4 w-4 rounded border-border"
                      />
                      활성화
                    </label>
                    <button
                      type="submit"
                      className="rounded-full bg-foreground px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-background md:col-span-1"
                    >
                      저장
                    </button>
                  </form>

                  <form
                    action={updatePackageStationsFormAction}
                    className="mt-3 grid gap-3 md:grid-cols-[1fr_auto]"
                  >
                    <input type="hidden" name="packageId" value={pkg.id} />
                    <input
                      name="stationCodes"
                      defaultValue={stationCodes}
                      placeholder="방송국 코드 (쉼표로 구분)"
                      className="rounded-2xl border border-border/70 bg-background px-3 py-2 text-xs"
                    />
                    <button
                      type="submit"
                      className="rounded-full border border-border/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-foreground"
                    >
                      방송국 매핑 저장
                    </button>
                  </form>
                </div>
              );
            })}
          </div>

          <div className="rounded-2xl border border-dashed border-border/60 bg-background/70 p-4">
            <h3 className="text-sm font-semibold text-foreground">
              새 패키지 추가
            </h3>
            <form action={upsertPackageFormAction} className="mt-3 grid gap-3 md:grid-cols-6">
              <input
                name="name"
                placeholder="패키지명"
                className="rounded-2xl border border-border/70 bg-background px-3 py-2 text-xs md:col-span-2"
              />
              <input
                name="stationCount"
                type="number"
                placeholder="방송국 수"
                className="rounded-2xl border border-border/70 bg-background px-3 py-2 text-xs"
              />
              <input
                name="priceKrw"
                type="number"
                placeholder="가격"
                className="rounded-2xl border border-border/70 bg-background px-3 py-2 text-xs"
              />
              <input
                name="description"
                placeholder="설명"
                className="rounded-2xl border border-border/70 bg-background px-3 py-2 text-xs md:col-span-2"
              />
              <label className="flex items-center gap-2 text-xs text-muted-foreground md:col-span-1">
                <input
                  type="checkbox"
                  name="isActive"
                  defaultChecked
                  className="h-4 w-4"
                />
                활성화
              </label>
              <button
                type="submit"
                className="rounded-full bg-foreground px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-background md:col-span-1"
              >
                추가
              </button>
            </form>
          </div>
        </section>

        <section className="space-y-4 rounded-[32px] border border-border/60 bg-card/80 p-6">
          <h2 className="text-lg font-semibold text-foreground">
            방송국 관리
          </h2>
          <div className="space-y-3">
            {stations?.map((station) => (
              <form
                key={station.id}
                action={upsertStationFormAction}
                className="grid gap-3 rounded-2xl border border-border/60 bg-background/70 p-4 md:grid-cols-[1.2fr_1fr_1fr_auto]"
              >
                <input type="hidden" name="id" value={station.id} />
                <input
                  name="name"
                  defaultValue={station.name}
                  className="rounded-2xl border border-border/70 bg-background px-3 py-2 text-xs"
                />
                <input
                  name="code"
                  defaultValue={station.code}
                  className="rounded-2xl border border-border/70 bg-background px-3 py-2 text-xs"
                />
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    name="isActive"
                    defaultChecked={station.is_active}
                    className="h-4 w-4 rounded border-border"
                  />
                  활성화
                </label>
                <button
                  type="submit"
                  className="rounded-full bg-foreground px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-background"
                >
                  저장
                </button>
              </form>
            ))}
          </div>

          <div className="rounded-2xl border border-dashed border-border/60 bg-background/70 p-4">
            <h3 className="text-sm font-semibold text-foreground">
              새 방송국 추가
            </h3>
            <form
              action={upsertStationFormAction}
              className="mt-3 grid gap-3 md:grid-cols-[1.2fr_1fr_auto_auto]"
            >
              <input
                name="name"
                placeholder="방송국명"
                className="rounded-2xl border border-border/70 bg-background px-3 py-2 text-xs"
              />
              <input
                name="code"
                placeholder="코드"
                className="rounded-2xl border border-border/70 bg-background px-3 py-2 text-xs"
              />
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  name="isActive"
                  defaultChecked
                  className="h-4 w-4"
                />
                활성화
              </label>
              <button
                type="submit"
                className="rounded-full bg-foreground px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-background"
              >
                추가
              </button>
            </form>
          </div>
        </section>
      </div>
    </div>
  );
}
