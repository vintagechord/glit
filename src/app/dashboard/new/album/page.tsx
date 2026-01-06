import { AlbumWizard } from "@/features/submissions/album-wizard";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata = {
  title: "음반 심의 접수",
};

const albumStationOrderByCount: Record<number, string[]> = {
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

const albumStationLabelByCode: Record<string, string> = {
  KBS: "KBS",
  MBC: "MBC",
  SBS: "SBS",
  CBS: "CBS 기독교방송",
  WBS: "WBS 원음방송",
  TBS: "TBS 교통방송",
  YTN: "YTN",
  PBC: "PBC 평화방송",
  BBS: "BBS 불교방송",
  ARIRANG: "Arirang 방송",
  GYEONGIN_IFM: "경인 iFM",
  TBN: "TBN 한국교통방송",
  KISS: "KISS 디지털 라디오 음악방송",
  FEBC: "극동방송(Only CCM)",
  GUGAK: "국악방송(Only 국악)",
};

const normalizeStations = (
  stations: Array<{ id: string; name: string; code: string }>,
  stationCount: number,
) => {
  const order = albumStationOrderByCount[stationCount];
  const stationByCode = new Map(
    stations.map((station) => [station.code, station]),
  );
  if (!order) {
    return stations.map((station) => ({
      ...station,
      name: albumStationLabelByCode[station.code] ?? station.name,
    }));
  }
  return order
    .map((code) => {
      const station = stationByCode.get(code);
      const name = albumStationLabelByCode[code] ?? station?.name ?? code;
      if (station) {
        return { ...station, name };
      }
      return { id: `station-${code}`, name, code };
    })
    .filter(Boolean);
};

export default async function AlbumSubmissionPage() {
  const supabase = await createServerSupabase();
  const profanityFilterV2Enabled = process.env.PROFANITY_FILTER_V2 === "true";
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: packageRows } = await supabase
    .from("packages")
    .select(
      "id, name, station_count, price_krw, description, package_stations ( station:stations ( id, name, code ) )",
    )
    .eq("is_active", true)
    .order("station_count", { ascending: true });

  const packages =
    packageRows?.map((pkg) => {
      const stations =
        pkg.package_stations?.flatMap((row) => {
          if (!row.station) return [];
          return Array.isArray(row.station) ? row.station : [row.station];
        }) ?? [];

      return {
        id: pkg.id,
        name: pkg.name,
        stationCount: pkg.station_count,
        priceKrw: pkg.price_krw,
        description: pkg.description,
        stations: normalizeStations(stations, pkg.station_count),
      };
    }) ?? [];

  const { data: profanityRows } = await supabase
    .from("profanity_terms")
    .select("term, language")
    .eq("is_active", true)
    .order("term", { ascending: true });

  const profanityTerms =
    profanityRows?.map((row) => ({
      term: row.term,
      language: row.language,
    })) ?? [];

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-12 text-[15px] leading-relaxed sm:text-base">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            Album Review
          </p>
          <h1 className="font-display mt-2 text-3xl text-foreground">
            음반 심의 접수
          </h1>
          <p className="mt-3 text-base text-muted-foreground">
            비회원도 접수할 수 있으며, 로그인 시 마이페이지에서 진행 상황을
            확인할 수 있습니다.
          </p>
        </div>
      </div>

      <div className="mt-8">
        <AlbumWizard
          packages={packages}
          userId={user?.id ?? null}
          profanityTerms={profanityTerms}
          profanityFilterV2Enabled={profanityFilterV2Enabled}
        />
      </div>
    </div>
  );
}
