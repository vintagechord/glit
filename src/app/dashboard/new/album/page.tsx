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
    title: "접수 방식 선택",
    description: "일반 접수와 원클릭 중 현재 상황에 맞는 방식만 고르면 바로 다음 단계로 이동합니다.",
  },
  {
    step: "02",
    title: "신청서 작성",
    description: "앨범 기본 정보, 접수자 정보, 트랙 정보와 가사를 한 번에 정리해 제출합니다.",
  },
  {
    step: "03",
    title: "파일 제출 및 결제",
    description: "파일 업로드 후 무통장 또는 카드 결제를 진행하고, 접수 상태가 즉시 기록됩니다.",
  },
  {
    step: "04",
    title: "결과 확인",
    description: "마이페이지 또는 비회원 조회 코드로 방송국별 진행 상태와 결과를 한 화면에서 확인합니다.",
  },
];

const preparationChecklist = [
  "앨범명, 아티스트명, 발매일, 장르, 유통사, 제작사",
  "트랙별 제목, 작·편곡자, 작사가, 전체 가사",
  "접수자 이름, 이메일, 연락처",
  "원클릭 접수 시 멜론 링크와 음원 파일",
];

const resultBenefits = [
  "로그인 접수는 마이페이지에 자동 저장됩니다.",
  "비회원 접수도 조회 코드로 진행 상황과 결과를 확인할 수 있습니다.",
  "방송국별 접수 상태, 트랙 결과, 수정 요청 여부를 한 번에 확인할 수 있습니다.",
];

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
    <div className="mx-auto w-full max-w-6xl px-6 py-12 text-[15px] leading-relaxed sm:text-base">
      <AlbumIntroPanel
        processHighlights={processHighlights}
        preparationChecklist={preparationChecklist}
        resultBenefits={resultBenefits}
        supportEmail={APP_CONFIG.supportEmail}
      />

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
