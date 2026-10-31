/**
 * Search-landing guides for the review types people look up ("음반심의",
 * "뮤직비디오 심의", "방송국 심의", "라디오 심의"). Facts here must match the
 * intake flow, FAQ and pricing: packages and stations come from the database
 * at render time, MV prices from submission-station-selection.
 */
import { MV_BASE_ONLINE_PRICE_KRW, MV_STATION_PRICE_KRW } from "@/lib/submission-station-selection";

export type GuideSection = { heading: string; paragraphs?: string[]; bullets?: string[] };
export type GuideFaq = { question: string; answer: string };
export type ReviewGuide = {
  slug: string;
  menuLabel: string;
  title: string;
  h1: string;
  description: string;
  keywords: string[];
  lead: string;
  facts: Array<{ label: string; value: string }>;
  sections: GuideSection[];
  pricing: "album" | "mv" | "both";
  cta: { label: string; href: string; secondary?: { label: string; href: string } };
  faqs: GuideFaq[];
  related: string[];
  serviceType: string;
};

export type AlbumPackage = { name: string; stationCount: number; priceKrw: number; stations: string[] };

/** Used when the database is unreachable during a build or revalidation. */
export const FALLBACK_ALBUM_PACKAGES: AlbumPackage[] = [
  { name: "3곳 패키지", stationCount: 3, priceKrw: 50_000, stations: ["KBS", "MBC", "SBS"] },
  { name: "7곳 패키지", stationCount: 7, priceKrw: 70_000, stations: ["KBS", "MBC", "SBS", "TBS 교통방송", "YTN", "CBS 기독교방송", "WBS 원음방송"] },
  { name: "10곳 패키지", stationCount: 10, priceKrw: 100_000, stations: ["KBS", "MBC", "SBS", "TBS 교통방송", "YTN", "CBS 기독교방송", "PBC 평화방송", "WBS 원음방송", "BBS 불교방송", "Arirang 방송"] },
  { name: "13곳 패키지", stationCount: 13, priceKrw: 130_000, stations: ["KBS", "MBC", "SBS", "TBS 교통방송", "YTN", "CBS 기독교방송", "PBC 평화방송", "WBS 원음방송", "BBS 불교방송", "KISS 디지털 라디오 음악방송", "경인 iFM", "TBN 한국교통방송", "Arirang 방송"] },
  { name: "15곳 패키지", stationCount: 15, priceKrw: 150_000, stations: ["KBS", "MBC", "SBS", "TBS 교통방송", "YTN", "CBS 기독교방송", "PBC 평화방송", "WBS 원음방송", "BBS 불교방송", "KISS 디지털 라디오 음악방송", "Arirang 방송", "경인 iFM", "TBN 한국교통방송", "극동방송(Only CCM)", "국악방송(Only 국악)"] },
];

export const MV_PRICE_ROWS = [
  { label: "온라인 유통용 기본(영상물등급위원회 등급분류)", priceKrw: MV_BASE_ONLINE_PRICE_KRW },
  { label: "온라인 유통용 추가: Mnet", priceKrw: MV_STATION_PRICE_KRW.MNET },
  { label: "온라인 유통용 추가: ETN", priceKrw: MV_STATION_PRICE_KRW.ETN },
  { label: "방송사 심의: KBS", priceKrw: MV_STATION_PRICE_KRW.KBS },
  { label: "방송사 심의: MBC", priceKrw: MV_STATION_PRICE_KRW.MBC },
  { label: "방송사 심의: SBS", priceKrw: MV_STATION_PRICE_KRW.SBS },
  { label: "방송사 심의: ETN", priceKrw: MV_STATION_PRICE_KRW.ETN },
];

const commonSchedule = "자료와 결제가 확인되면 접수합니다. 서울권 방송국은 보통 3영업일, 경기권은 7영업일 이내 접수를 목표로 하며, 결과는 방송국 일정에 따라 최대 3주 정도 걸릴 수 있습니다.";

export const REVIEW_GUIDES: ReviewGuide[] = [
  {
    slug: "album-review",
    menuLabel: "음반 심의",
    title: "음반 심의(앨범 심의) 신청 방법·비용·준비물",
    h1: "음반 심의(앨범 심의) 안내",
    description:
      "음반심의·앨범심의를 온라인으로 신청하는 방법을 안내합니다. KBS·MBC·SBS 등 방송국 3곳부터 15곳까지 패키지 비용, 발매 전·후 준비물, 접수 일정과 결과 확인 방법을 확인하세요.",
    keywords: ["음반심의", "음반 심의", "앨범심의", "앨범 심의", "음원 심의", "가요 심의", "음반심의 비용", "음반심의 대행", "방송 심의 신청"],
    lead:
      "새 노래를 라디오나 TV에서 방송하려면 방송국마다 따로 진행하는 음반 심의(앨범 심의)를 거쳐야 합니다. 각 방송사는 가사와 음원을 검토해 방송에 적합한지 판정합니다. 온사이드는 2017년부터 이 접수를 대행하며, 한 번의 온라인 신청으로 여러 방송국에 접수하고 방송국별 결과를 한곳에서 확인할 수 있게 돕습니다.",
    facts: [
      { label: "대상", value: "라디오·TV 방송을 원하는 신곡·앨범 (발매 전·후 모두 가능)" },
      { label: "접수처", value: "KBS·MBC·SBS를 포함한 방송국 3곳~15곳" },
      { label: "비용", value: "방송국 패키지별 금액 · 앨범 1건 기준" },
      { label: "기간", value: "접수 3~7영업일 이내 목표 · 결과 최대 약 3주" },
    ],
    sections: [
      {
        heading: "음반 심의란 무엇인가요?",
        paragraphs: [
          "음반 심의는 방송사가 노래를 방송에 내보내기 전에 가사와 음원을 검토하는 절차입니다. 흔히 앨범 심의, 가요 심의, 음원 방송 심의라고도 부르며 모두 같은 절차를 뜻합니다.",
          "심의 기준과 일정은 방송사마다 다르기 때문에 방송하려는 방송국마다 따로 접수해야 합니다. 결과는 방송국별로 나오며, 심의를 통과해도 실제 방송 편성이 보장되는 것은 아닙니다.",
        ],
      },
      {
        heading: "발매 전 신청과 발매 후 신청",
        bullets: [
          "발매 전: 신청서(HWP 또는 DOC), WAV 음원 또는 전체 음원 ZIP, 앨범 정보, 트랙별 크레딧, 전체 가사와 외국어 가사 번역을 준비합니다.",
          "발매 후: 멜론 또는 지니 앨범 링크로 추가금 없이 접수합니다. 신청서는 앨범 링크로 대신하고, 심의용 WAV 음원 또는 전체 음원 ZIP을 첨부합니다.",
          "정확한 발매일이 있으면 가장 안정적입니다. 임의 발매일은 일부 방송사에서 보완을 요청할 수 있습니다.",
        ],
      },
      {
        heading: "온사이드 음반 심의 진행 순서",
        bullets: [
          "1. 온라인 신청서 작성: 앨범 정보·가사·크레딧을 입력하고 음원과 신청서를 올립니다.",
          "2. 방송국 패키지 선택: 3곳·7곳·10곳·13곳·15곳 중 방송하려는 범위를 고릅니다.",
          "3. 결제: 카드 결제나 무통장 입금 중 선택합니다. 현금영수증과 세금계산서 발급이 가능합니다.",
          `4. 방송국 접수: ${commonSchedule}`,
          "5. 결과 확인: 방송국별 결과가 마이페이지와 조회 코드 화면에 순서대로 표시되고, 안내 메일로도 알려드립니다.",
        ],
      },
      {
        heading: "가사 제출과 심의 준비 팁",
        bullets: [
          "코러스, 나레이션, 반복되는 후렴까지 포함한 전체 가사를 제출해야 합니다.",
          "외국어 가사는 한국어 번역을 함께 제출합니다.",
          "정식 CD로 발매한 앨범은 실제 CD가 필요할 수 있습니다. 디지털 음반은 심의용 CD와 가사집 제작을 지원합니다.",
          "극동방송은 CCM, 국악방송은 국악 중심이라 장르 적합성을 먼저 확인합니다.",
        ],
      },
    ],
    pricing: "album",
    cta: { label: "음반 심의 신청하기", href: "/dashboard/new/album", secondary: { label: "결과 조회", href: "/track" } },
    faqs: [
      { question: "음반 심의와 앨범 심의는 다른 절차인가요?", answer: "같은 절차입니다. 방송사에 노래의 방송 적합성 판정을 받는 심의를 음반 심의, 앨범 심의, 가요 심의 등으로 부릅니다." },
      { question: "이미 발매된 앨범도 음반 심의를 받을 수 있나요?", answer: "가능합니다. 멜론 또는 지니 앨범 링크를 입력하면 추가금 없이 접수하며, 심의용 WAV 음원 또는 전체 음원 ZIP을 첨부하면 됩니다." },
      { question: "음반 심의 비용은 어떻게 계산되나요?", answer: "선택한 방송국 패키지 금액이 앨범 1건마다 적용됩니다. 여러 앨범을 함께 신청하면 앨범 수만큼 계산되며, 결제 전 화면에서 총액을 확인할 수 있습니다." },
      { question: "음반 심의 결과는 얼마나 걸리나요?", answer: "서울권 방송국은 보통 3영업일, 경기권은 7영업일 이내 접수를 목표로 합니다. 결과는 방송국 내부 일정에 따라 최대 3주 정도 걸릴 수 있습니다." },
      { question: "심의를 통과하면 방송에 나오나요?", answer: "아닙니다. 심의 결과는 방송에 내보내도 된다는 판정이며, 실제 방송 편성은 각 방송사가 결정합니다." },
    ],
    related: ["broadcast-review", "radio-review", "mv-review"],
    serviceType: "음반 심의 대행",
  },
  {
    slug: "mv-review",
    menuLabel: "뮤직비디오 심의",
    title: "뮤직비디오 심의(뮤비 심의)·등급분류 신청 방법과 비용",
    h1: "뮤직비디오 심의(뮤비 심의) 안내",
    description:
      "뮤직비디오 심의(뮤비 심의)를 온라인으로 신청하세요. 온라인 유통용 영상물등급위원회 등급분류와 KBS·MBC·SBS·ETN 방송사 뮤직비디오 심의의 차이, 영상 규격, 비용과 결과 자료를 안내합니다.",
    keywords: ["뮤직비디오심의", "뮤직비디오 심의", "뮤비심의", "뮤비 심의", "뮤직비디오 등급분류", "영상물등급위원회 뮤직비디오", "MV 심의", "뮤직비디오 방송 심의"],
    lead:
      "뮤직비디오는 공개하려는 곳에 따라 필요한 심의가 다릅니다. 음원 유통사와 온라인 플랫폼에 올릴 영상은 영상물등급위원회 등급분류 결과를 요구하는 경우가 많고, TV에 송출하려면 방송사별 뮤직비디오 심의를 받아야 합니다. 온사이드는 두 가지를 모두 온라인으로 접수하고 결과 자료를 내려받을 수 있게 안내합니다.",
    facts: [
      { label: "온라인 유통용", value: "영상물등급위원회 등급분류 · Mnet·ETN 추가 선택" },
      { label: "방송사 심의", value: "KBS·MBC·SBS·ETN 중 선택" },
      { label: "영상 규격", value: "MOV 또는 MP4 · 1920×1080 · 29.97fps 권장" },
      { label: "결과 자료", value: "등급 결과·필증·등급 표기 이미지와 사용 안내" },
    ],
    sections: [
      {
        heading: "온라인 유통용과 방송사 심의의 차이",
        paragraphs: [
          "온라인 유통용 뮤직비디오 심의는 유통사 제출과 플랫폼 업로드를 위한 절차입니다. 영상물등급위원회의 등급분류 결과와 필증, 영상에 표시할 등급 표기 자료를 받습니다.",
          "방송사 뮤직비디오 심의는 TV 송출을 위한 절차로, 방송사마다 제출 규격과 편성 조건이 다릅니다. 방송하려는 방송사를 골라 각각 접수합니다.",
        ],
      },
      {
        heading: "뮤직비디오 심의 준비물",
        bullets: [
          "영상 파일: MOV 또는 MP4를 권장합니다.",
          "해상도와 프레임: 1920×1080, 29.97fps를 권장합니다.",
          "신청 정보: 작품명, 아티스트, 감독·출연 정보와 줄거리 등 신청서 항목",
          "목적 구분: 온라인 유통용인지 TV 송출용인지 선택합니다. TV 송출용은 방송사별 제출 규격과 편성 조건을 확인합니다.",
          "대용량 영상도 업로드할 수 있으며, 업로드가 어려우면 이메일 제출로 이어서 접수할 수 있습니다.",
        ],
      },
      {
        heading: "온사이드 뮤직비디오 심의 진행 순서",
        bullets: [
          "1. 신청서 작성과 영상 업로드",
          "2. 심의 종류 선택: 온라인 유통용(추가로 Mnet·ETN 선택 가능) 또는 방송사 심의(KBS·MBC·SBS·ETN)",
          "3. 결제: 카드 결제 또는 무통장 입금, 현금영수증·세금계산서 발급 가능",
          "4. 접수와 진행 안내: 자료 확인 후 접수하며, 제출처와 보완 여부에 따라 일정이 달라집니다.",
          "5. 결과 확인: 등급 결과와 필증, 등급 표기 이미지와 사용 안내를 마이페이지에서 내려받습니다.",
        ],
      },
    ],
    pricing: "mv",
    cta: { label: "뮤직비디오 심의 신청하기", href: "/dashboard/new/mv", secondary: { label: "결과 조회", href: "/track" } },
    faqs: [
      { question: "뮤직비디오를 유튜브나 음원 사이트에 올리려면 어떤 심의가 필요한가요?", answer: "온라인 유통용 심의를 선택하세요. 유통사와 플랫폼은 영상물등급위원회 등급분류 결과를 요구하는 경우가 많으며, 온사이드에서 등급 결과와 필증, 등급 표기 자료를 받을 수 있습니다." },
      { question: "MV 온라인용과 TV 송출용은 무엇이 다른가요?", answer: "온라인용은 유통사 제출·업로드 목적입니다. TV 송출용은 방송사별 편성, 제출 규격, 로고·등급분류 조건을 별도로 확인합니다." },
      { question: "뮤직비디오 심의 비용은 얼마인가요?", answer: `온라인 유통용 기본 ${MV_BASE_ONLINE_PRICE_KRW.toLocaleString("ko-KR")}원에 Mnet·ETN을 추가할 수 있고, 방송사 심의는 방송사별 금액이 더해집니다. 아래 비용 표와 결제 화면에서 총액을 확인할 수 있습니다.` },
      { question: "영상 규격이 다르면 심의를 받을 수 없나요?", answer: "MOV 또는 MP4, 1920×1080, 29.97fps를 권장합니다. 방송사 송출용은 방송사별 규격 확인이 필요하며, 접수 전에 보완이 필요한지 안내드립니다." },
    ],
    related: ["broadcast-review", "album-review", "radio-review"],
    serviceType: "뮤직비디오 심의 대행",
  },
  {
    slug: "broadcast-review",
    menuLabel: "방송국 심의",
    title: "방송국 심의(방송 심의) 안내 · KBS·MBC·SBS 심의 신청",
    h1: "방송국 심의(방송 심의) 안내",
    description:
      "KBS·MBC·SBS 등 방송국 심의를 한 번에 신청하는 방법을 안내합니다. 음반 방송 심의와 뮤직비디오 방송사 심의의 차이, 접수 가능한 방송국과 패키지 비용, 결과 확인 방법을 정리했습니다.",
    keywords: ["방송국심의", "방송국 심의", "방송심의", "방송 심의", "KBS 심의", "MBC 심의", "SBS 심의", "지상파 심의", "방송사 심의"],
    lead:
      "방송국 심의는 방송사가 노래나 뮤직비디오를 방송에 내보내도 되는지 판단하는 절차입니다. 지상파 3사(KBS·MBC·SBS)와 종교·교통·지역 방송사는 각자 기준과 일정으로 심의하므로, 방송하려는 곳마다 접수해야 합니다. 온사이드에서는 여러 방송국을 한 번에 선택해 신청할 수 있습니다.",
    facts: [
      { label: "음반 방송 심의", value: "라디오·TV에서 노래를 방송하기 위한 심의" },
      { label: "MV 방송사 심의", value: "TV에 뮤직비디오를 송출하기 위한 심의" },
      { label: "접수 가능 방송국", value: "KBS·MBC·SBS 포함 음반 15곳, MV 4곳" },
      { label: "결과", value: "방송국별로 마이페이지와 조회 코드로 안내" },
    ],
    sections: [
      {
        heading: "방송국 심의가 필요한 경우",
        bullets: [
          "신곡이나 앨범을 라디오·TV 방송에서 틀고 싶을 때: 음반 방송 심의",
          "뮤직비디오를 TV 음악 채널이나 방송 프로그램에 송출하고 싶을 때: 뮤직비디오 방송사 심의",
          "음원 유통이나 온라인 플랫폼 공개만 목적이라면 방송국 심의 대신 뮤직비디오 온라인 유통용 심의를 확인하세요.",
        ],
      },
      {
        heading: "음반 방송 심의 접수 방송국",
        paragraphs: [
          "KBS·MBC·SBS, TBS 교통방송, YTN, CBS 기독교방송, WBS 원음방송, PBC 평화방송, BBS 불교방송, Arirang 방송, KISS 디지털 라디오 음악방송, 경인 iFM, TBN 한국교통방송, 극동방송(CCM), 국악방송(국악)에 접수할 수 있습니다. 방송국 수에 따라 3곳·7곳·10곳·13곳·15곳 패키지 중에서 고릅니다.",
        ],
      },
      {
        heading: "뮤직비디오 방송사 심의 접수 방송사",
        paragraphs: [
          "TV 송출용 뮤직비디오는 KBS·MBC·SBS·ETN 중 원하는 방송사를 골라 접수합니다. 방송사별로 제출 규격과 편성 조건이 다르므로 신청 단계에서 함께 확인합니다.",
        ],
      },
      {
        heading: "방송국 심의 결과와 일정",
        bullets: [
          commonSchedule,
          "결과는 방송국별로 따로 나오며, 나온 순서대로 마이페이지와 조회 코드 화면에 표시됩니다.",
          "심의 결과는 방송 적합성 판정이며 실제 방송 편성을 보장하지 않습니다.",
        ],
      },
    ],
    pricing: "both",
    cta: { label: "방송국 심의 신청하기", href: "/dashboard/new", secondary: { label: "음반 심의 안내", href: "/guide/album-review" } },
    faqs: [
      { question: "KBS·MBC·SBS만 심의받을 수 있나요?", answer: "가능합니다. 음반 심의는 KBS·MBC·SBS로 구성된 3곳 패키지를 선택하면 되고, 뮤직비디오 방송사 심의는 원하는 방송사만 골라 신청합니다." },
      { question: "국악방송, 극동방송 신청도 가능한가요?", answer: "가능합니다. 국악방송은 국악, 극동방송은 CCM 중심이라 장르 적합성을 먼저 확인합니다. 두 방송사는 15곳 패키지에 포함됩니다." },
      { question: "심의 결과가 늦어지는 이유는 무엇인가요?", answer: "방송사 내부 일정과 심의 물량에 따라 지연될 수 있습니다. 진행 현황은 조회 코드 또는 마이페이지에서 방송국별로 업데이트됩니다." },
      { question: "긴급 심의가 가능한가요?", answer: "일정과 방송국 조건에 따라 다릅니다. 긴급 접수는 추가 비용이 발생할 수 있어 신청 전 고객센터로 문의해 주세요." },
    ],
    related: ["album-review", "radio-review", "mv-review"],
    serviceType: "방송국 심의 대행",
  },
  {
    slug: "radio-review",
    menuLabel: "라디오 심의",
    title: "라디오 심의 신청 안내 · 라디오 방송국 음반 심의",
    h1: "라디오 심의 안내",
    description:
      "라디오에서 노래를 틀기 위한 라디오 심의를 온라인으로 신청하세요. KBS·MBC·SBS 라디오와 CBS·BBS·PBC·WBS·TBS·TBN·경인 iFM·KISS·극동방송·국악방송 등 접수 방송국과 패키지별 비용을 안내합니다.",
    keywords: ["라디오심의", "라디오 심의", "라디오 음반 심의", "라디오 방송 심의", "CBS 심의", "TBN 심의", "극동방송 심의", "국악방송 심의"],
    lead:
      "라디오 심의는 라디오 방송국에서 노래를 방송하기 위해 받는 음반 심의입니다. 라디오는 지상파 3사 외에도 종교·교통·지역 방송국이 많아, 어느 방송국에 접수하느냐에 따라 방송될 수 있는 범위가 달라집니다. 온사이드에서는 방송국 3곳부터 15곳까지 한 번에 접수할 수 있습니다.",
    facts: [
      { label: "대상", value: "라디오 방송을 원하는 신곡·앨범" },
      { label: "접수 방송국", value: "KBS·MBC·SBS 라디오와 종교·교통·지역 방송국" },
      { label: "비용", value: "방송국 수별 패키지 · 앨범 1건 기준" },
      { label: "결과", value: "방송국별 결과를 마이페이지·조회 코드로 확인" },
    ],
    sections: [
      {
        heading: "라디오 심의를 받을 수 있는 방송국",
        bullets: [
          "지상파: KBS, MBC, SBS",
          "보도·교통: YTN, TBS 교통방송, TBN 한국교통방송",
          "종교: CBS 기독교방송, PBC 평화방송, BBS 불교방송, WBS 원음방송, 극동방송(CCM)",
          "음악·지역·해외: KISS 디지털 라디오 음악방송, 경인 iFM, Arirang 방송, 국악방송(국악)",
        ],
      },
      {
        heading: "라디오 심의 패키지 고르는 방법",
        bullets: [
          "주요 방송국 위주라면 KBS·MBC·SBS 3곳 패키지",
          "라디오 노출을 넓히려면 교통·보도·종교 방송이 포함된 7곳·10곳 패키지",
          "지역·디지털 라디오까지 포함하려면 13곳 패키지",
          "CCM이나 국악이라면 극동방송·국악방송이 포함된 15곳 패키지",
        ],
      },
      {
        heading: "라디오 심의 준비물과 일정",
        bullets: [
          "발매 전: 신청서, WAV 음원 또는 전체 음원 ZIP, 앨범 정보, 크레딧, 전체 가사와 번역",
          "발매 후: 멜론 또는 지니 앨범 링크와 심의용 음원 파일",
          commonSchedule,
        ],
      },
    ],
    pricing: "album",
    cta: { label: "라디오 심의 신청하기", href: "/dashboard/new/album", secondary: { label: "방송국 심의 안내", href: "/guide/broadcast-review" } },
    faqs: [
      { question: "라디오 심의와 음반 심의는 같은 건가요?", answer: "라디오 방송을 위한 음반 심의를 흔히 라디오 심의라고 부릅니다. 온사이드에서는 음반 심의 신청에서 라디오 방송국이 포함된 패키지를 고르면 됩니다." },
      { question: "CCM이나 국악도 라디오 심의를 받을 수 있나요?", answer: "가능합니다. 극동방송은 CCM, 국악방송은 국악 중심으로 심의하며 두 방송사는 15곳 패키지에 포함됩니다. 장르 적합성을 먼저 확인합니다." },
      { question: "라디오 심의 결과는 어디서 확인하나요?", answer: "접수 후 발급되는 조회 코드나 마이페이지에서 방송국별 결과를 확인할 수 있고, 결과가 나오면 안내 메일도 보내드립니다." },
    ],
    related: ["album-review", "broadcast-review", "mv-review"],
    serviceType: "라디오 심의 대행",
  },
];

export const getReviewGuide = (slug: string) => REVIEW_GUIDES.find((guide) => guide.slug === slug) ?? null;
