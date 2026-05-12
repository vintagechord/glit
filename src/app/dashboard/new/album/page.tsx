import { AlbumIntroPanel } from "@/features/submissions/album-intro-panel";
import { AlbumWizard } from "@/features/submissions/album-wizard";
import { APP_CONFIG } from "@/lib/config";
import { createServerSupabase } from "@/lib/supabase/server";
import { getServerSessionUser } from "@/lib/supabase/server-user";

export const metadata = {
  title: "음반 심의 접수",
};

const albumStationOrderByCount: Record<number, string[]> = {
  3: ["KBS", "MBC", "SBS"],
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

const processHighlights = [
  {
    step: "01",
    title: "패키지 선택",
    description: "심의를 보낼 방송국 수를 선택합니다.",
  },
  {
    step: "02",
    title: "정보 입력",
    description: "앨범, 곡, 가사 정보를 입력합니다.",
  },
  {
    step: "03",
    title: "파일·결제",
    description: "음원 파일을 올리고 결제를 진행합니다.",
  },
  {
    step: "04",
    title: "결과 확인",
    description: "발급된 코드나 마이페이지에서 확인합니다.",
  },
];

const preparationChecklist = [
  "앨범명, 아티스트명, 발매일",
  "곡 제목, 가사, 작사·작곡 정보",
  "접수자 이름, 이메일, 연락처",
  "원클릭은 멜론 링크",
];

const resultBenefits = [
  "회원은 마이페이지에서 확인",
  "비회원은 접수 코드로 확인",
  "방송국별 상태와 트랙 결과 확인",
];

const isTestPackage = (name?: string | null) => name?.startsWith("[테스트]") ?? false;

const sortPackagesForDisplay = <
  T extends { name?: string | null; stationCount: number; priceKrw: number },
>(
  packages: T[],
) =>
  [...packages].sort((a, b) => {
    const aIsTest = isTestPackage(a.name);
    const bIsTest = isTestPackage(b.name);
    if (aIsTest !== bIsTest) return aIsTest ? 1 : -1;
    return a.stationCount - b.stationCount || a.priceKrw - b.priceKrw;
  });

export default async function AlbumSubmissionPage() {
  const supabase = await createServerSupabase();
  const profanityFilterV2Enabled = process.env.PROFANITY_FILTER_V2 === "true";
  const user = await getServerSessionUser(supabase);

  const { data: joinedPackageRows, error: packageJoinError } = await supabase
    .from("packages")
    .select(
      "id, name, station_count, price_krw, description, package_stations ( station:stations ( id, name, code ) )",
    )
    .eq("is_active", true)
    .order("station_count", { ascending: true });

  const packagesFromJoin =
    joinedPackageRows?.map((pkg) => {
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

  let packages = packagesFromJoin;

  if (packageJoinError || packagesFromJoin.length === 0) {
    const { data: fallbackPackageRows } = await supabase
      .from("packages")
      .select("id, name, station_count, price_krw, description")
      .eq("is_active", true)
      .order("station_count", { ascending: true });

    packages =
      fallbackPackageRows?.map((pkg) => ({
        id: pkg.id,
        name: pkg.name,
        stationCount: pkg.station_count,
        priceKrw: pkg.price_krw,
        description: pkg.description,
        stations: normalizeStations([], pkg.station_count),
      })) ?? [];
  }

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
    <div className="mx-auto w-full max-w-6xl px-4 py-8 text-[15px] leading-relaxed sm:px-6 sm:py-12 sm:text-base">
      <AlbumIntroPanel
        processHighlights={processHighlights}
        preparationChecklist={preparationChecklist}
        resultBenefits={resultBenefits}
        supportEmail={APP_CONFIG.supportEmail}
      />

      <div className="mt-8">
        <AlbumWizard
          packages={sortPackagesForDisplay(packages)}
          userId={user?.id ?? null}
          userEmail={user?.email ?? null}
          profanityTerms={profanityTerms}
          profanityFilterV2Enabled={profanityFilterV2Enabled}
        />
      </div>
    </div>
  );
}
