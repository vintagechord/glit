import {
  deletePackageFormAction,
  deleteProfanityTermFormAction,
  deleteStationFormAction,
  updateAlbumReviewDiscountFormAction,
  updatePackageStationsFormAction,
  upsertProfanityTermFormAction,
  upsertPackageFormAction,
  upsertStationFormAction,
} from "@/features/admin/actions";
import { AdminSaveToast } from "@/components/admin/save-toast";
import { getAlbumReviewDiscountPercent } from "@/lib/album-discount-server";
import {
  getAlbumReviewDiscountPercentForPackage,
  getDiscountedAlbumPrice,
} from "@/lib/album-pricing";
import { formatCurrency } from "@/lib/format";
import { syncAlbumStationCatalog } from "@/lib/station-reviews";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata = {
  title: "패키지/방송국 설정",
};

export const dynamic = "force-dynamic";

const albumStationCodes = [
  "KBS",
  "MBC",
  "SBS",
  "TBS",
  "CBS",
  "PBC",
  "WBS",
  "BBS",
  "YTN",
  "GYEONGIN_IFM",
  "TBN",
  "ARIRANG",
  "KISS",
  "FEBC",
  "GUGAK",
];

const albumStationCodesByCount: Record<number, string[]> = {
  7: ["KBS", "MBC", "SBS", "CBS", "WBS", "TBS", "YTN"],
  10: ["KBS", "MBC", "SBS", "TBS", "CBS", "PBC", "WBS", "BBS", "YTN", "ARIRANG"],
  13: [
    "KBS",
    "MBC",
    "SBS",
    "TBS",
    "CBS",
    "PBC",
    "WBS",
    "BBS",
    "YTN",
    "GYEONGIN_IFM",
    "TBN",
    "ARIRANG",
    "KISS",
  ],
  15: [
    "KBS",
    "MBC",
    "SBS",
    "TBS",
    "CBS",
    "PBC",
    "WBS",
    "BBS",
    "YTN",
    "GYEONGIN_IFM",
    "TBN",
    "ARIRANG",
    "KISS",
    "FEBC",
    "GUGAK",
  ],
};

const albumStationCodeSet = new Set(albumStationCodes);

export default async function AdminConfigPage({
  searchParams,
}: {
  searchParams?: Promise<{ saved?: string | string[] }>;
}) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const savedFlag = Array.isArray(resolvedSearchParams?.saved)
    ? resolvedSearchParams?.saved[0]
    : resolvedSearchParams?.saved;
  const supabase = await createServerSupabase();
  await syncAlbumStationCatalog(supabase);
  const albumDiscountPercent = await getAlbumReviewDiscountPercent(supabase);
  const { data: packages } = await supabase
    .from("packages")
    .select(
      "id, name, station_count, price_krw, description, is_active, package_stations ( station:stations ( code ) )",
    )
    .order("station_count", { ascending: true });

  const { data: stations } = await supabase
    .from("stations")
    .select("id, name, code, is_active")
    .in("code", albumStationCodes)
    .eq("is_active", true)
    .order("name", { ascending: true });

  const { data: profanityTerms } = await supabase
    .from("profanity_terms")
    .select("id, term, language, is_active, created_at")
    .order("created_at", { ascending: false });
  const samplePackage = packages?.find((pkg) => !pkg.name?.startsWith("[테스트]"));
  const sampleOriginalPrice = samplePackage?.price_krw ?? 0;
  const sampleDiscountPercent = getAlbumReviewDiscountPercentForPackage(
    albumDiscountPercent,
    samplePackage?.station_count ?? null,
  );
  const sampleDiscountedPrice = getDiscountedAlbumPrice(
    sampleOriginalPrice,
    albumDiscountPercent,
    samplePackage?.station_count ?? null,
  );

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-12">
      {savedFlag ? <AdminSaveToast message="저장되었습니다." /> : null}
      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
        관리자 설정
      </p>
      <h1 className="font-display mt-2 text-3xl text-foreground">
        패키지/방송국 설정
      </h1>

      <div className="mt-8 space-y-8">
        <section className="space-y-4 rounded-[32px] border border-border/60 bg-card/80 p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-foreground">
                음반 심의 일괄 할인
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                패키지 원래 금액은 유지하고, 사용자 화면과 실제 결제/입금 요청 금액에만 할인율을 적용합니다.
                3곳·7곳 패키지는 기본 할인율과 관계없이 40% 할인을 우선 적용합니다.
              </p>
            </div>
            <span className="rounded-full border border-[#1556a4]/30 bg-[#1556a4]/10 px-3 py-1 text-xs font-black text-[#1556a4] dark:border-[#3f8ad8]/40 dark:bg-[#3f8ad8]/15 dark:text-[#8bc3ff]">
              기본 {albumDiscountPercent}% · 3곳/7곳 40%
            </span>
          </div>

          <form
            action={updateAlbumReviewDiscountFormAction}
            className="grid gap-3 md:grid-cols-[1fr_auto_auto_auto]"
          >
            <label className="grid gap-1">
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                할인율(%)
              </span>
              <input
                name="discountPercent"
                type="number"
                min={0}
                max={100}
                step={1}
                defaultValue={albumDiscountPercent}
                className="rounded-2xl border border-border/70 bg-background px-3 py-2 text-sm font-semibold text-foreground"
              />
            </label>
            <button
              type="submit"
              className="self-end rounded-full bg-foreground px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-background"
            >
              할인율 저장
            </button>
            <button
              type="submit"
              name="quickDiscountPercent"
              value="50"
              className="self-end rounded-full border border-[#1556a4]/40 bg-[#1556a4]/10 px-4 py-2 text-xs font-black text-[#1556a4]"
            >
              50% 적용
            </button>
            <button
              type="submit"
              name="quickDiscountPercent"
              value="0"
              className="self-end rounded-full border border-border/70 px-4 py-2 text-xs font-semibold text-foreground"
            >
              할인 해제
            </button>
          </form>

          {sampleOriginalPrice > 0 ? (
            <div className="rounded-2xl border border-border/60 bg-background/70 p-4 text-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                사용자 노출 예시
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <span className="text-muted-foreground line-through">
                  {formatCurrency(sampleOriginalPrice)}원
                </span>
                <span className="text-lg font-black text-foreground">
                  {formatCurrency(sampleDiscountedPrice)}원
                </span>
                {sampleDiscountPercent > 0 ? (
                  <span className="rounded-full bg-[#f2cf27] px-3 py-1 text-xs font-black text-[#111111]">
                    {sampleDiscountPercent}% 할인
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}
        </section>

        <section className="space-y-4 rounded-[32px] border border-border/60 bg-card/80 p-6">
          <h2 className="text-lg font-semibold text-foreground">
            패키지 관리
          </h2>
          <div className="space-y-4">
            {packages?.map((pkg) => {
              const packageStations = (pkg.package_stations ??
                []) as Array<{
                station?: { code?: string | null } | Array<{ code?: string | null }>;
              }>;
              const stationCodes = packageStations
                .map((row) => {
                  if (!row.station) return null;
                  if (Array.isArray(row.station)) {
                    return row.station[0]?.code ?? null;
                  }
                  return row.station.code ?? null;
                })
                .filter((code): code is string => Boolean(code))
                .filter((code) => albumStationCodeSet.has(code))
                .join(", ");
              const expectedCodes =
                albumStationCodesByCount[pkg.station_count] ?? null;
              const resolvedStationCodes =
                expectedCodes && expectedCodes.length > 0
                  ? expectedCodes.join(", ")
                  : stationCodes;

              return (
                <div
                  key={pkg.id}
                  className="rounded-2xl border border-border/60 bg-background/70 p-4"
                >
                  <div className="grid gap-3 md:grid-cols-6">
                    <form
                      action={upsertPackageFormAction}
                      className="grid gap-3 md:col-span-5 md:grid-cols-5"
                    >
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
                      action={deletePackageFormAction}
                      className="flex items-center justify-end md:col-span-1"
                    >
                      <input type="hidden" name="id" value={pkg.id} />
                      <button
                        type="submit"
                        className="rounded-full border border-border/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-foreground"
                      >
                        삭제
                      </button>
                    </form>
                  </div>

                  <form
                    action={updatePackageStationsFormAction}
                    className="mt-3 grid gap-3 md:grid-cols-[1fr_auto]"
                  >
                    <input type="hidden" name="packageId" value={pkg.id} />
                    <input
                      name="stationCodes"
                      defaultValue={resolvedStationCodes}
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
              <div
                key={station.id}
                className="grid gap-3 rounded-2xl border border-border/60 bg-background/70 p-4 md:grid-cols-[1.2fr_1fr_1fr_auto_auto]"
              >
                <form
                  action={upsertStationFormAction}
                  className="grid gap-3 md:col-span-4 md:grid-cols-[1.2fr_1fr_1fr_auto]"
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
                <form
                  action={deleteStationFormAction}
                  className="flex items-center justify-end"
                >
                  <input type="hidden" name="id" value={station.id} />
                  <button
                    type="submit"
                    className="rounded-full border border-border/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-foreground"
                  >
                    삭제
                  </button>
                </form>
              </div>
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

        <section className="space-y-4 rounded-[32px] border border-border/60 bg-card/80 p-6">
          <h2 className="text-lg font-semibold text-foreground">
            욕설/비속어 관리
          </h2>
          <div className="space-y-3">
            {profanityTerms?.map((term) => (
              <div
                key={term.id}
                className="grid gap-3 rounded-2xl border border-border/60 bg-background/70 p-4 md:grid-cols-[1fr_auto]"
              >
                <form
                  action={upsertProfanityTermFormAction}
                  className="grid gap-3 md:grid-cols-[1.6fr_0.6fr_auto_auto]"
                >
                  <input type="hidden" name="id" value={term.id} />
                  <input
                    name="term"
                    defaultValue={term.term}
                    className="rounded-2xl border border-border/70 bg-background px-3 py-2 text-xs"
                  />
                  <select
                    name="language"
                    defaultValue={(term.language ?? "KO").toUpperCase()}
                    className="rounded-2xl border border-border/70 bg-background px-3 py-2 text-xs"
                  >
                    <option value="KO">한글</option>
                    <option value="EN">영문</option>
                  </select>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      name="isActive"
                      defaultChecked={term.is_active}
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
                <form
                  action={deleteProfanityTermFormAction}
                  className="flex items-center justify-end"
                >
                  <input type="hidden" name="id" value={term.id} />
                  <button
                    type="submit"
                    className="rounded-full border border-border/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-foreground"
                  >
                    삭제
                  </button>
                </form>
              </div>
            ))}
          </div>

          <div className="rounded-2xl border border-dashed border-border/60 bg-background/70 p-4">
            <h3 className="text-sm font-semibold text-foreground">
              새 욕설/비속어 추가
            </h3>
            <form
              action={upsertProfanityTermFormAction}
              className="mt-3 grid gap-3 md:grid-cols-[1.6fr_0.6fr_auto_auto]"
            >
              <input
                name="term"
                placeholder="욕설/비속어"
                className="rounded-2xl border border-border/70 bg-background px-3 py-2 text-xs"
              />
              <select
                name="language"
                defaultValue="KO"
                className="rounded-2xl border border-border/70 bg-background px-3 py-2 text-xs"
              >
                <option value="KO">한글</option>
                <option value="EN">영문</option>
              </select>
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
