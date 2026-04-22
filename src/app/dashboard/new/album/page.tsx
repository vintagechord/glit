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
    description: "일반 접수와 원클릭 중 현재 상황에 맞는 방식만 고르면 바로 다음 단계로 이어집니다.",
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
      <section className="overflow-hidden rounded-[36px] border border-black/6 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(245,245,247,0.98))] p-8 shadow-[0_30px_80px_rgba(0,0,0,0.08)] dark:border-white/10 dark:bg-[linear-gradient(180deg,rgba(29,29,31,0.94),rgba(0,0,0,0.98))] dark:shadow-none">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-muted-foreground">
              Album Review
            </p>
            <h1 className="font-display mt-3 text-3xl leading-tight text-foreground sm:text-4xl">
              음반 심의 접수
            </h1>
            <p className="mt-4 max-w-2xl text-sm text-muted-foreground sm:text-base">
              접수 방식만 먼저 고르면 바로 다음 단계로 이어집니다. 비회원도
              바로 접수할 수 있고, 로그인 상태라면 진행 내역이 마이페이지에
              자동 저장됩니다.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-[11px] font-semibold uppercase tracking-[0.18em]">
            <span className="rounded-full border border-black/8 bg-white/88 px-3 py-1.5 text-[#1d1d1f] dark:border-white/10 dark:bg-white/8 dark:text-white">
              비회원 접수 가능
            </span>
            <span className="rounded-full border border-[#0071e3]/12 bg-[#eaf3ff] px-3 py-1.5 text-[#0071e3] dark:border-[#2997ff]/20 dark:bg-[#0b2a46] dark:text-[#8bc3ff]">
              로그인 시 내역 저장
            </span>
            <span className="rounded-full border border-black/8 bg-white/88 px-3 py-1.5 text-[#1d1d1f] dark:border-white/10 dark:bg-white/8 dark:text-white">
              결과 조회 지원
            </span>
          </div>
        </div>

        <div className="mt-8 grid gap-4 lg:grid-cols-[1.4fr_0.9fr]">
          <div className="grid gap-4 md:grid-cols-2">
            {processHighlights.map((item) => (
              <div
                key={item.step}
                className="rounded-[28px] border border-black/6 bg-white/90 p-5 shadow-[0_18px_40px_rgba(0,0,0,0.05)] dark:border-white/10 dark:bg-white/5 dark:shadow-none"
              >
                <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[#0071e3] dark:text-[#8bc3ff]">
                  Step {item.step}
                </p>
                <h2 className="mt-3 text-xl font-semibold tracking-[-0.03em] text-foreground">
                  {item.title}
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {item.description}
                </p>
              </div>
            ))}
          </div>

          <div className="space-y-4">
            <div className="rounded-[28px] border border-black/6 bg-white/92 p-6 shadow-[0_18px_40px_rgba(0,0,0,0.05)] dark:border-white/10 dark:bg-white/5 dark:shadow-none">
              <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-muted-foreground">
                접수 전 준비
              </p>
              <ul className="mt-4 space-y-2 text-sm text-foreground">
                {preparationChecklist.map((item) => (
                  <li key={item} className="flex gap-2">
                    <span className="mt-1 h-1.5 w-1.5 rounded-full bg-[#0071e3] dark:bg-[#8bc3ff]" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-[28px] border border-[#cfe3fb] bg-[#eaf3ff] p-6 text-[#123152] shadow-[0_18px_40px_rgba(0,113,227,0.1)] dark:border-[#1d4f7d] dark:bg-[#0b2a46] dark:text-white dark:shadow-none">
              <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-[#0071e3] dark:text-[#8bc3ff]">
                업로드 문제 대응
              </p>
              <p className="mt-3 text-sm leading-6">
                파일 업로드가 원활하지 않더라도 신청서는 사이트에서 계속
                진행하시면 됩니다. 파일만 별도로 이메일로 보내주시면 접수를
                이어서 도와드립니다.
              </p>
              <p className="mt-4 text-sm font-semibold">{APP_CONFIG.supportEmail}</p>
            </div>
          </div>
        </div>

        <div className="mt-6 rounded-[28px] border border-black/6 bg-white/90 p-6 dark:border-white/10 dark:bg-white/5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            결과 확인 방식
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {resultBenefits.map((item) => (
              <div
                key={item}
                className="rounded-2xl border border-black/6 bg-[#f5f5f7] px-4 py-4 text-sm text-[#1d1d1f] dark:border-white/10 dark:bg-black/30 dark:text-white"
              >
                {item}
              </div>
            ))}
          </div>
        </div>
      </section>

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
