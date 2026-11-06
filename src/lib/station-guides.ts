/**
 * Search-landing guides for every broadcaster Onside submits to: one page per
 * station ("KBS 음반 심의", "극동방송 심의", "Mnet 뮤직비디오 심의"...). Facts
 * come from the intake flow: album packages and their stations are read from
 * the database at render time, music video prices from
 * submission-station-selection, radio participation links from
 * radio-station-guide. Keep the prose to what the service actually does.
 */
import { getRadioStationGuide, type RadioStationGuide } from "@/lib/radio-station-guide";
import type { AlbumPackage, GuideFaq } from "@/lib/review-guides";
import { MV_BASE_ONLINE_PRICE_KRW, MV_STATION_PRICE_KRW } from "@/lib/submission-station-selection";

export type StationGroup = "뮤직비디오" | "지상파" | "보도·교통" | "종교" | "음악·지역" | "국제";

export type StationGuide = {
  /** Station code in public.stations. */
  code: string;
  /** URL segment under /guide/stations/. */
  slug: string;
  /** Name as the intake flow shows it. */
  name: string;
  /** Name used inside sentences, e.g. "KBS", "극동방송". */
  shortName: string;
  /** English name for the /en alias titles, when shortName is Korean. */
  englishName?: string;
  /** For names ending in Latin letters: whether the Korean reading ends in a
   * consonant ("Mnet" 엠넷 → true, "KBS" 케이비에스 → false). Hangul names
   * are read from the last syllable. */
  finalConsonant?: boolean;
  group: StationGroup;
  title: string;
  description: string;
  keywords: string[];
  lead: string;
  about: string[];
  /** Genre limit the station applies (CCM, 국악). */
  genreNote?: string;
  /** Album reviews are submitted to this station through a package. */
  album: boolean;
  /** Music video review prices in KRW, when the station takes them: the
   * online distribution base (영등위 등급분류 itself), an add-on to it, or a
   * per-broadcaster TV review. */
  mv?: { base?: number; online?: number; broadcast?: number };
  /** Station-specific questions; the generic ones are generated from facts. */
  faqs: GuideFaq[];
};

const mvBroadcast = (code: string) => MV_STATION_PRICE_KRW[code];

// Korean names of Latin letters that end in a consonant: L(엘) M(엠) N(엔) R(알).
const consonantLetters = /[lmnr]$/i;

/** Whether a word takes 이/은/을 (true) or 가/는/를 (false). */
function endsInConsonant(word: string, override?: boolean) {
  const last = word.trim().at(-1) ?? "";
  const code = last.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 !== 0;
  if (override !== undefined) return override;
  return consonantLetters.test(last);
}

/** The subject, topic or object particle that fits the station name. */
export function josa(guide: Pick<StationGuide, "shortName" | "finalConsonant">, kind: "이/가" | "은/는" | "을/를") {
  const consonant = endsInConsonant(guide.shortName, guide.finalConsonant);
  if (kind === "이/가") return consonant ? "이" : "가";
  if (kind === "은/는") return consonant ? "은" : "는";
  return consonant ? "을" : "를";
}

// Owner, 2026-11-07: 영등위 is the review most customers ask for, so it
// leads the list and the 뮤직비디오 group comes first.
export const STATION_GUIDES: StationGuide[] = [
  {
    code: "MV_ONLINE", slug: "kmrb", name: "영상물등급위원회 (영등위)", shortName: "영등위", englishName: "Korea Media Rating Board", group: "뮤직비디오",
    title: "영등위(영상물등급위원회) 뮤직비디오 심의·등급분류 신청 방법과 비용",
    description: `영등위(영상물등급위원회) 뮤직비디오 등급분류를 온라인으로 신청하세요. 음원 유통사와 온라인 플랫폼에 올릴 뮤직비디오의 온라인 유통용 심의로, 영상 1건 ${MV_BASE_ONLINE_PRICE_KRW.toLocaleString("ko-KR")}원에 Mnet·ETN을 함께 추가할 수 있습니다. 준비물, 영상 규격, 등급 결과·심의필증·등급 이미지를 안내합니다.`,
    keywords: ["영등위 심의", "영등위 뮤직비디오 심의", "영상물등급위원회 뮤직비디오", "뮤직비디오 등급분류", "뮤비 등급분류", "영등위 등급분류 신청", "뮤직비디오 온라인 심의", "영등위 심의필증", "뮤직비디오 유통 심의"],
    lead: "영등위 뮤직비디오 심의는 영상물등급위원회가 뮤직비디오의 관람 등급을 정하는 등급분류 절차입니다. 음원 유통사와 온라인 플랫폼은 이 등급분류 결과를 요구하는 경우가 많습니다. 온사이드에서는 온라인 유통용 심의로 신청하며 Mnet·ETN을 함께 추가할 수 있습니다.",
    about: [
      "영상물등급위원회(영등위)는 영상물의 등급을 분류하는 기관입니다. 뮤직비디오 등급은 전체관람가, 12세이상관람가, 15세이상관람가, 청소년관람불가 가운데 하나로 나오며, 기준에 맞지 않으면 심의불가가 됩니다.",
      "결과가 나오면 영등위 심의필증, 영상에 넣을 등급 이미지, 등급 표시 사용 예시 PDF를 마이페이지와 조회 코드 화면에서 내려받습니다. TV에 송출하려면 이와 별도로 KBS·MBC·SBS·ETN 방송국별 뮤직비디오 심의를 받아야 합니다.",
    ],
    album: false,
    mv: { base: MV_BASE_ONLINE_PRICE_KRW },
    faqs: [
      { question: "온라인에 올릴 뮤직비디오도 영등위 심의가 필요한가요?", answer: "음원 유통사와 온라인 플랫폼은 영상물등급위원회 등급분류 결과를 요구하는 경우가 많습니다. 제출처의 요구 사항을 확인하고, 필요하면 온라인 유통용 심의로 신청하세요." },
      { question: "영등위 심의와 방송국 뮤직비디오 심의는 무엇이 다른가요?", answer: "영등위 심의는 유통사 제출과 온라인 업로드를 위한 등급분류입니다. 방송국별 뮤직비디오 심의는 TV 송출 목적이라 KBS·MBC·SBS·ETN 가운데 방송사를 골라 따로 받으며, 방송사별 제출 규격과 편성 조건을 확인합니다." },
      { question: "영등위 심의에 맞는 영상 규격은 무엇인가요?", answer: "MOV 또는 MP4, 1920×1080, 29.97fps를 권장합니다. 대용량 영상도 업로드할 수 있으며, 업로드가 어려우면 이메일 제출로 이어서 접수할 수 있습니다." },
    ],
  },
  {
    code: "KBS", slug: "kbs", name: "KBS", shortName: "KBS", group: "지상파",
    title: "KBS 음반 심의·뮤직비디오 심의 신청 방법과 비용",
    description: "KBS 음반 심의(가요 심의)를 온라인으로 신청하세요. KBS는 음반 심의 3곳 패키지(KBS·MBC·SBS)부터 모든 패키지에 포함되며, KBS 뮤직비디오 심의도 방송국별 심의로 접수합니다. 비용, 준비물, 결과 확인과 심의 후 라디오 신청곡 보내는 방법을 안내합니다.",
    keywords: ["KBS 음반 심의", "KBS 심의", "KBS 가요 심의", "KBS 방송 심의", "KBS 라디오 심의", "KBS 뮤직비디오 심의", "KBS 뮤비 심의", "KBS 심의 신청"],
    lead: "KBS 음반 심의는 KBS 라디오와 TV에서 노래를 방송하기 위해 KBS가 가사와 음원을 검토하는 절차입니다. 온사이드에서는 음반 심의 3곳 패키지(KBS·MBC·SBS)부터 모든 패키지에 KBS가 들어 있고, KBS 뮤직비디오 심의는 방송국별 심의로 따로 신청합니다.",
    about: [
      "KBS는 한국방송공사가 운영하는 공영방송으로 쿨FM·해피FM 등 라디오 채널과 TV 채널을 갖고 있습니다. 라디오 신청곡이나 TV 음악 프로그램에 노래를 내보내려면 KBS 음반 심의를 먼저 받아야 합니다.",
      "KBS 심의 결과는 곡마다 적격·부적격으로 나오며, 적격 판정을 받은 곡만 방송할 수 있습니다. 심의 통과가 편성을 보장하지는 않으므로, 적격 결과를 받은 뒤 라디오 프로그램 게시판에 신청곡을 보내는 것까지가 홍보의 한 묶음입니다.",
    ],
    album: true,
    mv: { broadcast: mvBroadcast("KBS") },
    faqs: [
      { question: "KBS 라디오와 TV 심의를 따로 받아야 하나요?", answer: "온사이드의 KBS 음반 심의는 KBS 한 곳으로 접수하며 결과도 KBS 기준으로 한 번 나옵니다. TV 송출용 뮤직비디오는 별도의 KBS 뮤직비디오 심의(방송국별 심의)를 신청합니다." },
    ],
  },
  {
    code: "MBC", slug: "mbc", name: "MBC", shortName: "MBC", group: "지상파",
    title: "MBC 음반 심의·뮤직비디오 심의 신청 방법과 비용",
    description: "MBC 음반 심의(가요 심의)를 온라인으로 신청하세요. MBC는 음반 심의 3곳 패키지(KBS·MBC·SBS)부터 모든 패키지에 포함되며, MBC 뮤직비디오 심의도 방송국별 심의로 접수합니다. 비용, 준비물, 결과 확인 방법을 안내합니다.",
    keywords: ["MBC 음반 심의", "MBC 심의", "MBC 가요 심의", "MBC 라디오 심의", "MBC 뮤직비디오 심의", "MBC 뮤비 심의", "MBC 심의 신청"],
    lead: "MBC 음반 심의는 MBC 라디오(FM4U·표준FM)와 TV에서 노래를 방송하기 위해 MBC가 가사와 음원을 검토하는 절차입니다. 온사이드에서는 3곳 패키지부터 모든 음반 심의 패키지에 MBC가 들어 있고, MBC 뮤직비디오 심의는 방송국별 심의로 신청합니다.",
    about: [
      "MBC는 문화방송이 운영하는 지상파 방송사로 FM4U와 표준FM 라디오, TV 채널을 갖고 있습니다. 별이 빛나는 밤에 같은 라디오 프로그램에 신청곡을 보내려면 MBC 음반 심의를 통과한 곡이어야 합니다.",
      "MBC 결과는 곡별 적격·부적격으로 나오며 조회 코드와 마이페이지에서 확인합니다. 심의 통과 뒤에는 MBC mini 앱이나 프로그램 게시판으로 직접 신청곡을 보낼 수 있습니다.",
    ],
    album: true,
    mv: { broadcast: mvBroadcast("MBC") },
    faqs: [],
  },
  {
    code: "SBS", slug: "sbs", name: "SBS", shortName: "SBS", group: "지상파",
    title: "SBS 음반 심의·뮤직비디오 심의 신청 방법과 비용",
    description: "SBS 음반 심의(가요 심의)를 온라인으로 신청하세요. SBS는 음반 심의 3곳 패키지(KBS·MBC·SBS)부터 모든 패키지에 포함되며, SBS 뮤직비디오 심의도 방송국별 심의로 접수합니다. 비용, 준비물, 결과 확인 방법을 안내합니다.",
    keywords: ["SBS 음반 심의", "SBS 심의", "SBS 가요 심의", "SBS 라디오 심의", "SBS 뮤직비디오 심의", "SBS 뮤비 심의", "SBS 심의 신청"],
    lead: "SBS 음반 심의는 SBS 라디오(파워FM·러브FM)와 TV에서 노래를 방송하기 위해 SBS가 가사와 음원을 검토하는 절차입니다. 온사이드에서는 3곳 패키지부터 모든 음반 심의 패키지에 SBS가 들어 있고, SBS 뮤직비디오 심의는 방송국별 심의로 신청합니다.",
    about: [
      "SBS는 서울에 본사를 둔 지상파 민영방송으로 파워FM과 러브FM 라디오, TV 채널을 운영합니다. 라디오 음악 프로그램과 TV 음악 방송에 노래를 내보내려면 SBS 음반 심의를 거쳐야 합니다.",
      "SBS 결과는 곡별 적격·부적격으로 나옵니다. 적격을 받은 곡은 SBS 고릴라 앱이나 프로그램 게시판에서 직접 신청곡으로 보낼 수 있습니다.",
    ],
    album: true,
    mv: { broadcast: mvBroadcast("SBS") },
    faqs: [],
  },
  {
    code: "TBS", slug: "tbs", name: "TBS 교통방송", shortName: "TBS 교통방송", group: "보도·교통",
    title: "TBS 교통방송 음반 심의 신청 방법과 비용",
    description: "TBS 교통방송 음반 심의를 온라인으로 신청하세요. TBS는 음반 심의 7곳 패키지부터 포함됩니다. 비용, 준비물, 접수 일정과 결과 확인 방법을 안내합니다.",
    keywords: ["TBS 음반 심의", "TBS 심의", "교통방송 심의", "TBS 라디오 심의", "TBS 가요 심의"],
    lead: "TBS 교통방송 음반 심의는 TBS 라디오에서 노래를 방송하기 위해 TBS가 가사와 음원을 검토하는 절차입니다. 온사이드에서는 7곳 패키지부터 TBS가 들어 있어 KBS·MBC·SBS와 함께 한 번에 접수합니다.",
    about: [
      "TBS 교통방송은 서울 지역의 교통·생활 정보 라디오로 TBS FM과 영어 채널 TBS eFM을 운영합니다. 출퇴근 시간대 청취자가 많은 라디오라 가요 홍보에서 자주 포함되는 방송국입니다.",
      "TBS 결과는 다른 방송국과 마찬가지로 조회 코드와 마이페이지에서 방송국별로 확인하며, 결과 안내 메일도 보냅니다.",
    ],
    album: true,
    faqs: [],
  },
  {
    code: "YTN", slug: "ytn", name: "YTN", shortName: "YTN", group: "보도·교통",
    title: "YTN 라디오 음반 심의 신청 방법과 비용",
    description: "YTN 라디오 음반 심의를 온라인으로 신청하세요. YTN은 음반 심의 7곳 패키지부터 포함됩니다. 비용, 준비물, 접수 일정과 결과 확인 방법을 안내합니다.",
    keywords: ["YTN 음반 심의", "YTN 심의", "YTN 라디오 심의", "YTN 가요 심의"],
    lead: "YTN 음반 심의는 YTN 라디오에서 노래를 방송하기 위해 YTN이 가사와 음원을 검토하는 절차입니다. 온사이드에서는 7곳 패키지부터 YTN이 들어 있습니다.",
    about: [
      "YTN은 보도 전문 채널로 YTN 라디오를 함께 운영합니다. 뉴스 사이사이의 음악 프로그램에 노래가 나가려면 YTN 음반 심의를 통과해야 합니다.",
      "YTN 결과는 조회 코드와 마이페이지에서 방송국별로 확인합니다.",
    ],
    album: true,
    faqs: [],
  },
  {
    code: "CBS", slug: "cbs", name: "CBS 기독교방송", shortName: "CBS", group: "종교",
    title: "CBS 기독교방송 음반 심의 신청 방법과 비용",
    description: "CBS 기독교방송 음반 심의를 온라인으로 신청하세요. CBS는 음반 심의 7곳 패키지부터 포함되며, 가요와 팝을 소개하는 음악FM 프로그램이 많습니다. 비용, 준비물, 결과 확인과 심의 후 신청곡 보내는 방법을 안내합니다.",
    keywords: ["CBS 음반 심의", "CBS 심의", "기독교방송 심의", "CBS 라디오 심의", "CBS 음악FM 심의", "CBS 가요 심의"],
    lead: "CBS 음반 심의는 CBS 기독교방송 라디오에서 노래를 방송하기 위해 CBS가 가사와 음원을 검토하는 절차입니다. 온사이드에서는 7곳 패키지부터 CBS가 들어 있습니다. CBS 음악FM은 가요와 팝을 폭넓게 소개해 일반 가요도 접수합니다.",
    about: [
      "CBS 기독교방송은 음악FM과 표준FM 라디오를 운영합니다. 음악FM에는 가요와 팝을 함께 소개하는 아침·낮 프로그램이 있어, 종교 방송이지만 일반 가요의 라디오 홍보에서 빠지지 않는 방송국입니다.",
      "CBS 결과는 조회 코드와 마이페이지에서 확인하며, 적격을 받은 곡은 CBS 레인보우 앱이나 프로그램의 사연·신청곡 게시판으로 직접 신청할 수 있습니다.",
    ],
    album: true,
    faqs: [
      { question: "CBS는 기독교 음악만 심의하나요?", answer: "아닙니다. CBS 음악FM은 가요와 팝을 폭넓게 방송하므로 일반 가요도 음반 심의를 접수합니다. CCM 전용 접수는 극동방송입니다." },
    ],
  },
  {
    code: "WBS", slug: "wbs", name: "WBS 원음방송", shortName: "WBS 원음방송", group: "종교",
    title: "WBS 원음방송 음반 심의 신청 방법과 비용",
    description: "WBS 원음방송 음반 심의를 온라인으로 신청하세요. 원음방송은 음반 심의 7곳 패키지부터 포함되며, 앨범당 최대 3곡을 골라 심의합니다. 비용, 준비물, 결과 확인 방법을 안내합니다.",
    keywords: ["원음방송 심의", "WBS 심의", "WBS 음반 심의", "원음방송 음반 심의", "원음방송 라디오 심의"],
    lead: "WBS 원음방송 음반 심의는 원음방송 라디오에서 노래를 방송하기 위해 원음방송이 가사와 음원을 검토하는 절차입니다. 온사이드에서는 7곳 패키지부터 원음방송이 들어 있습니다.",
    about: [
      "WBS 원음방송은 원불교가 운영하는 라디오 방송으로 음악 프로그램을 통해 가요를 소개합니다.",
      "원음방송은 앨범 전체가 아니라 앨범당 최대 3곡을 골라 심의합니다. 4곡 이상인 앨범은 접수 과정에서 심의곡 3곡을 정하며, 결과도 그 곡들에 대해 나옵니다.",
    ],
    album: true,
    faqs: [
      { question: "원음방송은 왜 3곡만 심의하나요?", answer: "원음방송은 앨범당 최대 3곡까지 접수를 받습니다. 4곡 이상인 앨범은 타이틀곡을 포함해 심의곡 3곡을 정해 접수하고, 결과도 그 3곡에 대해 나옵니다." },
    ],
  },
  {
    code: "PBC", slug: "pbc", name: "PBC 평화방송", shortName: "PBC 평화방송", group: "종교",
    title: "PBC 가톨릭평화방송 음반 심의 신청 방법과 비용",
    description: "PBC 가톨릭평화방송(cpbc) 음반 심의를 온라인으로 신청하세요. 평화방송은 음반 심의 10곳 패키지부터 포함됩니다. 비용, 준비물, 결과 확인 방법을 안내합니다.",
    keywords: ["평화방송 심의", "PBC 심의", "cpbc 심의", "가톨릭평화방송 음반 심의", "PBC 음반 심의"],
    lead: "PBC 평화방송 음반 심의는 cpbc 가톨릭평화방송 라디오에서 노래를 방송하기 위해 평화방송이 가사와 음원을 검토하는 절차입니다. 온사이드에서는 10곳 패키지부터 평화방송이 들어 있습니다.",
    about: [
      "cpbc 가톨릭평화방송(PBC)은 천주교가 운영하는 라디오·TV 방송입니다. 라디오 음악 프로그램에서 가요도 소개합니다.",
      "평화방송 결과는 조회 코드와 마이페이지에서 방송국별로 확인합니다.",
    ],
    album: true,
    faqs: [],
  },
  {
    code: "BBS", slug: "bbs", name: "BBS 불교방송", shortName: "BBS 불교방송", group: "종교",
    title: "BBS 불교방송 음반 심의 신청 방법과 비용",
    description: "BBS 불교방송 음반 심의를 온라인으로 신청하세요. 불교방송은 음반 심의 10곳 패키지부터 포함됩니다. 비용, 준비물, 결과 확인 방법을 안내합니다.",
    keywords: ["불교방송 심의", "BBS 심의", "BBS 음반 심의", "불교방송 음반 심의", "불교방송 라디오 심의"],
    lead: "BBS 불교방송 음반 심의는 불교방송 라디오에서 노래를 방송하기 위해 불교방송이 가사와 음원을 검토하는 절차입니다. 온사이드에서는 10곳 패키지부터 불교방송이 들어 있습니다.",
    about: [
      "BBS 불교방송은 불교계가 운영하는 라디오·TV 방송으로, 라디오 음악 프로그램에서 가요를 소개합니다.",
      "불교방송 결과는 조회 코드와 마이페이지에서 방송국별로 확인합니다.",
    ],
    album: true,
    faqs: [],
  },
  {
    code: "ARIRANG", slug: "arirang", name: "Arirang 방송", shortName: "Arirang", finalConsonant: true, group: "국제",
    title: "Arirang 아리랑 라디오 음반 심의 신청 방법과 비용",
    description: "Arirang 방송(아리랑 라디오) 음반 심의를 온라인으로 신청하세요. Arirang은 음반 심의 10곳 패키지부터 포함되며, 영어로 K-pop을 소개하는 라디오 프로그램이 있습니다. 비용, 준비물, 결과 확인과 Send Message로 신청곡 보내는 방법을 안내합니다.",
    keywords: ["아리랑 라디오 심의", "Arirang 심의", "아리랑 방송 음반 심의", "Arirang Radio 심의", "아리랑 심의"],
    lead: "Arirang 음반 심의는 아리랑 라디오에서 노래를 방송하기 위해 Arirang이 가사와 음원을 검토하는 절차입니다. 온사이드에서는 10곳 패키지부터 Arirang이 들어 있습니다. 영어로 방송하는 채널이라 해외 청취자에게 K-pop을 알리려는 팀에 맞습니다.",
    about: [
      "Arirang은 영어로 방송하는 국제 방송으로, Arirang Radio에 K-POPPIN’, Radio’n Us처럼 K-pop과 아티스트를 영어로 소개하는 프로그램이 있습니다.",
      "적격을 받은 뒤에는 각 프로그램의 Send Message 게시판에 영문 곡명·아티스트명과 짧은 신청 이유를 보내고, Tracklist에서 방송 여부를 확인합니다.",
    ],
    album: true,
    faqs: [
      { question: "Arirang은 영어 가사 곡만 심의하나요?", answer: "한국어 가사 곡도 접수합니다. 다만 신청곡 게시판은 영어로 운영되므로, 심의 후 신청곡을 보낼 때는 영문 곡명과 아티스트명을 준비하세요." },
    ],
  },
  {
    code: "KISS", slug: "kiss", name: "KISS 디지털 라디오 음악방송", shortName: "KISS", group: "음악·지역",
    title: "KISS 디지털 라디오 음악방송 음반 심의 신청 방법과 비용",
    description: "KISS 디지털 라디오 음악방송 음반 심의를 온라인으로 신청하세요. KISS는 음반 심의 13곳 패키지부터 포함됩니다. 비용, 준비물, 결과 확인 방법을 안내합니다.",
    keywords: ["KISS 라디오 심의", "KISS 음반 심의", "디지털 라디오 음악방송 심의", "KISS 심의"],
    lead: "KISS 음반 심의는 KISS 디지털 라디오 음악방송에서 노래를 방송하기 위해 KISS가 가사와 음원을 검토하는 절차입니다. 온사이드에서는 13곳 패키지부터 KISS가 들어 있습니다.",
    about: [
      "KISS 디지털 라디오 음악방송은 음악 전문 디지털 라디오 채널입니다. 13곳 패키지부터 경인 iFM·TBN과 함께 접수해 라디오 노출 범위를 넓힐 때 선택합니다.",
      "KISS 결과는 조회 코드와 마이페이지에서 방송국별로 확인합니다.",
    ],
    album: true,
    faqs: [],
  },
  {
    code: "GYEONGIN_IFM", slug: "gyeongin-ifm", name: "경인 iFM", shortName: "경인 iFM", group: "음악·지역",
    title: "경인방송 iFM 음반 심의 신청 방법과 비용",
    description: "경인방송 iFM 음반 심의를 온라인으로 신청하세요. 경인 iFM은 음반 심의 13곳 패키지부터 포함되는 인천·경기 지역 라디오입니다. 비용, 준비물, 결과 확인 방법을 안내합니다.",
    keywords: ["경인방송 심의", "iFM 심의", "경인 iFM 음반 심의", "경인방송 라디오 심의", "인천 라디오 심의"],
    lead: "경인 iFM 음반 심의는 경인방송 라디오에서 노래를 방송하기 위해 경인방송이 가사와 음원을 검토하는 절차입니다. 온사이드에서는 13곳 패키지부터 경인 iFM이 들어 있습니다.",
    about: [
      "경인방송 iFM은 인천·경기 지역을 대상으로 하는 라디오 방송으로 음악 프로그램에서 가요를 소개합니다.",
      "경인 iFM 결과는 조회 코드와 마이페이지에서 방송국별로 확인합니다.",
    ],
    album: true,
    faqs: [],
  },
  {
    code: "TBN", slug: "tbn", name: "TBN 한국교통방송", shortName: "TBN 한국교통방송", group: "보도·교통",
    title: "TBN 한국교통방송 음반 심의 신청 방법과 비용",
    description: "TBN 한국교통방송 음반 심의를 온라인으로 신청하세요. TBN은 음반 심의 13곳 패키지부터 포함되며 지역별 교통방송 채널을 갖고 있습니다. 비용, 준비물, 결과 확인 방법을 안내합니다.",
    keywords: ["TBN 심의", "TBN 음반 심의", "한국교통방송 심의", "TBN 라디오 심의", "교통방송 가요 심의"],
    lead: "TBN 음반 심의는 TBN 한국교통방송 라디오에서 노래를 방송하기 위해 TBN이 가사와 음원을 검토하는 절차입니다. 온사이드에서는 13곳 패키지부터 TBN이 들어 있습니다.",
    about: [
      "TBN 한국교통방송은 도로교통공단이 운영하는 교통 전문 라디오로 전국에 지역별 채널을 두고 있습니다. 운전자 청취자가 많아 지역 라디오 노출을 넓힐 때 포함합니다.",
      "TBN 결과는 조회 코드와 마이페이지에서 방송국별로 확인합니다.",
    ],
    album: true,
    faqs: [],
  },
  {
    code: "FEBC", slug: "febc", name: "극동방송(Only CCM)", shortName: "극동방송", group: "종교",
    title: "극동방송 CCM 음반 심의 신청 방법과 비용",
    description: "극동방송 음반 심의를 온라인으로 신청하세요. 극동방송은 CCM 음반만 접수하며 음반 심의 15곳 패키지에 포함됩니다. CCM 심의 비용, 준비물, 결과 확인 방법을 안내합니다.",
    keywords: ["극동방송 심의", "극동방송 음반 심의", "CCM 심의", "CCM 방송 심의", "FEBC 심의", "찬양 음반 심의"],
    lead: "극동방송 음반 심의는 극동방송 라디오에서 CCM을 방송하기 위해 극동방송이 가사와 음원을 검토하는 절차입니다. 온사이드에서는 15곳 패키지에 극동방송이 들어 있으며, 장르가 CCM인 음반만 접수합니다.",
    about: [
      "극동방송은 기독교 선교 방송으로 CCM(기독교 음악) 중심으로 편성합니다. 일반 가요는 극동방송에 접수하지 않으므로, CCM 앨범인지 먼저 확인합니다.",
      "극동방송 결과는 조회 코드와 마이페이지에서 방송국별로 확인합니다.",
    ],
    genreNote: "극동방송은 CCM 음반만 접수합니다. 일반 가요라면 15곳 패키지 대신 13곳 패키지를 고르는 편이 맞습니다.",
    album: true,
    faqs: [
      { question: "일반 가요도 극동방송에 심의 신청할 수 있나요?", answer: "극동방송은 CCM 음반만 접수합니다. 일반 가요는 극동방송과 국악방송이 빠진 13곳 패키지까지 선택하세요." },
      { question: "CCM 앨범은 어떤 패키지를 고르나요?", answer: "극동방송이 포함된 15곳 패키지를 선택합니다. 접수 전에 장르 적합성을 확인하며, 궁금한 점은 신청 전에 문의하면 안내합니다." },
    ],
  },
  {
    code: "GUGAK", slug: "gugak", name: "국악방송(Only 국악)", shortName: "국악방송", group: "음악·지역",
    title: "국악방송 음반 심의 신청 방법과 비용",
    description: "국악방송 음반 심의를 온라인으로 신청하세요. 국악방송은 국악 음반만 접수하며 음반 심의 15곳 패키지에 포함됩니다. 국악 심의 비용, 준비물, 결과 확인 방법을 안내합니다.",
    keywords: ["국악방송 심의", "국악방송 음반 심의", "국악 심의", "국악 방송 심의", "국악 음반 라디오 심의"],
    lead: "국악방송 음반 심의는 국악방송 라디오에서 국악을 방송하기 위해 국악방송이 가사와 음원을 검토하는 절차입니다. 온사이드에서는 15곳 패키지에 국악방송이 들어 있으며, 국악 음반만 접수합니다.",
    about: [
      "국악방송은 국악 전문 라디오 방송으로 전통 국악과 창작 국악, 퓨전 국악을 소개합니다. 일반 가요는 국악방송에 접수하지 않습니다.",
      "국악방송 결과는 조회 코드와 마이페이지에서 방송국별로 확인합니다.",
    ],
    genreNote: "국악방송은 국악 음반만 접수합니다. 국악이 아니라면 13곳 패키지까지가 맞습니다.",
    album: true,
    faqs: [
      { question: "퓨전 국악이나 국악 크로스오버도 국악방송에 접수할 수 있나요?", answer: "국악 요소가 중심인 음반이면 접수합니다. 경계가 애매하면 신청 전에 문의해 주시면 장르 적합성을 먼저 확인해 드립니다." },
    ],
  },
  {
    code: "ETN", slug: "etn", name: "ETN 연예TV", shortName: "ETN", group: "뮤직비디오",
    title: "ETN 뮤직비디오 심의 신청 방법과 비용",
    description: "ETN 연예TV 뮤직비디오 심의를 온라인으로 신청하세요. ETN은 온라인 유통용 심의의 추가 옵션과 방송국별 뮤직비디오 심의 두 경로로 선택할 수 있습니다. 비용, 영상 규격, 결과 자료를 안내합니다.",
    keywords: ["ETN 뮤직비디오 심의", "ETN 심의", "ETN 뮤비 심의", "연예TV 뮤직비디오 심의", "ETN 뮤비 등급"],
    lead: "ETN 뮤직비디오 심의는 ETN 연예TV에서 뮤직비디오를 방송하기 위한 절차입니다. 온사이드에서는 온라인 유통용 심의를 신청하면서 ETN을 추가 옵션으로 고르거나, TV 송출용 방송국별 심의에서 ETN을 선택할 수 있습니다.",
    about: [
      "ETN 연예TV는 연예·음악 전문 케이블 채널로 뮤직비디오를 방송합니다. 음반 심의 대상은 아니고 뮤직비디오 심의만 접수합니다.",
      "온라인 유통용 심의(영상물등급위원회 등급분류)에 ETN을 추가하면 한 번의 신청으로 유통용 결과와 ETN 결과를 함께 받습니다.",
    ],
    album: false,
    mv: { online: mvBroadcast("ETN"), broadcast: mvBroadcast("ETN") },
    faqs: [
      { question: "ETN은 음반 심의도 받나요?", answer: "아닙니다. ETN은 뮤직비디오 심의만 접수합니다. 노래 자체의 방송 심의는 KBS·MBC·SBS 등 음반 심의 패키지로 신청하세요." },
    ],
  },
  {
    code: "MNET", slug: "mnet", name: "Mnet", shortName: "Mnet", finalConsonant: true, group: "뮤직비디오",
    title: "Mnet 뮤직비디오 심의 신청 방법과 비용",
    description: "Mnet 뮤직비디오 심의를 온라인으로 신청하세요. Mnet은 온라인 유통용 뮤직비디오 심의의 추가 옵션으로 선택합니다. 비용, 영상 규격, 결과 자료를 안내합니다.",
    keywords: ["Mnet 뮤직비디오 심의", "엠넷 심의", "Mnet 심의", "엠넷 뮤비 심의", "Mnet 뮤비 등급"],
    lead: "Mnet 뮤직비디오 심의는 Mnet에서 뮤직비디오를 방송하기 위한 절차입니다. 온사이드에서는 온라인 유통용 심의(영상물등급위원회 등급분류)를 신청하면서 Mnet을 추가 옵션으로 선택합니다.",
    about: [
      "Mnet은 음악 전문 채널로 뮤직비디오와 음악 프로그램을 방송합니다. 음반 심의 대상은 아니고 뮤직비디오 심의만 접수합니다.",
      "온라인 유통용 심의에 Mnet을 추가하면 한 번의 신청으로 유통용 등급분류 결과와 Mnet 결과를 함께 받습니다.",
    ],
    album: false,
    mv: { online: mvBroadcast("MNET") },
    faqs: [
      { question: "Mnet은 음반 심의도 받나요?", answer: "아닙니다. Mnet은 뮤직비디오 심의만 접수합니다. 노래 자체의 방송 심의는 KBS·MBC·SBS 등 음반 심의 패키지로 신청하세요." },
    ],
  },
];

export const STATION_GROUPS: StationGroup[] = ["뮤직비디오", "지상파", "보도·교통", "종교", "음악·지역", "국제"];

/** Schedules as the album and music video guides state them. */
export const ALBUM_SCHEDULE = "자료와 결제가 확인되면 접수합니다. 서울권 방송국은 보통 3영업일, 경기권은 7영업일 이내 접수를 목표로 하며, 결과는 방송국 일정에 따라 최대 3주 정도 걸릴 수 있습니다.";
export const MV_SCHEDULE = "자료와 결제를 확인한 뒤 접수하며, 일정은 제출처와 보완 여부에 따라 달라집니다.";
export const stationSchedule = (guide: StationGuide) => (guide.album ? ALBUM_SCHEDULE : MV_SCHEDULE);

/** One line on how the station is applied for and what it costs (hub cards, llms.txt). */
export function stationSummary(guide: StationGuide, packages: AlbumPackage[]) {
  const cheapest = packagesIncluding(guide.code, packages)[0];
  const parts = [
    guide.album && cheapest ? `음반 심의 ${cheapest.name}(${won(cheapest.priceKrw)})부터 포함` : "",
    guide.mv?.base ? `온라인 유통용 등급분류 ${won(guide.mv.base)} · Mnet·ETN 추가 가능` : "",
    guide.mv?.online ? `온라인 유통용 뮤직비디오 심의 추가 ${won(guide.mv.online)}` : "",
    guide.mv?.broadcast && !guide.album ? `방송국별 뮤직비디오 심의 ${won(guide.mv.broadcast)}` : "",
  ];
  return parts.filter(Boolean).join(" · ") || "뮤직비디오 심의";
}

export const getStationGuide = (slug: string) => STATION_GUIDES.find((guide) => guide.slug === slug) ?? null;
export const getStationGuideByCode = (code: string) => STATION_GUIDES.find((guide) => guide.code === code.trim().toUpperCase()) ?? null;

export const won = (value: number) => `${value.toLocaleString("ko-KR")}원`;

/** Album packages that submit to this station, cheapest first. */
export const packagesIncluding = (code: string, packages: AlbumPackage[]) =>
  packages.filter((pkg) => pkg.stationCodes.includes(code)).sort((a, b) => a.priceKrw - b.priceKrw);

/** The radio participation guide, when the station has one (KBS, MBC, SBS, CBS, Arirang...). */
export const stationRadioGuide = (guide: StationGuide): RadioStationGuide | null =>
  guide.album ? getRadioStationGuide({ stationCode: guide.code, stationName: guide.name }) : null;

const joinStations = (stations: string[]) => stations.join("·");

/** Station-specific questions first, then the ones every station page answers from facts. */
export function stationFaqs(guide: StationGuide, packages: AlbumPackage[]): GuideFaq[] {
  const faqs: GuideFaq[] = [...guide.faqs];
  const short = guide.shortName;
  const including = packagesIncluding(guide.code, packages);
  const cheapest = including[0];
  if (guide.album && cheapest) {
    faqs.push({
      question: `${short} 음반 심의만 따로 신청할 수 있나요?`,
      answer: `온사이드는 방송국 패키지 단위로 접수합니다. ${short}${josa(guide, "은/는")} ${cheapest.name}(${won(cheapest.priceKrw)}, ${joinStations(cheapest.stations)})부터 포함되며, 그보다 큰 패키지에도 모두 들어 있습니다. 앨범 1건 기준이고 부가세가 포함된 금액입니다.`,
    });
  }
  if (guide.mv?.base) {
    // 영등위 is the online distribution review itself: no add-on price and no broadcast airing.
    faqs.push(
      {
        question: `${short} 뮤직비디오 심의 비용은 얼마인가요?`,
        answer: `온라인 유통용 심의(영상물등급위원회 등급분류)는 영상 1건 ${won(guide.mv.base)}이며 부가세가 포함된 금액입니다. Mnet(${won(MV_STATION_PRICE_KRW.MNET)})·ETN(${won(MV_STATION_PRICE_KRW.ETN)})을 함께 추가할 수 있습니다.`,
      },
      {
        question: `${short} 심의 결과로 무엇을 받나요?`,
        answer: `등급 결과와 영등위 심의필증, 영상에 넣을 등급 이미지, 등급 표시 사용 예시 PDF를 마이페이지와 조회 코드 화면에서 내려받습니다. 결과가 나오면 안내 메일도 보냅니다. ${MV_SCHEDULE}`,
      },
    );
    return faqs;
  }
  if (guide.mv?.online) {
    faqs.push({
      question: `${short} 뮤직비디오 심의 비용은 얼마인가요?`,
      answer: `온라인 유통용 심의 기본 ${won(MV_BASE_ONLINE_PRICE_KRW)}(영상물등급위원회 등급분류)에 ${short} 추가 ${won(guide.mv.online)}이 더해집니다.${guide.mv.broadcast ? ` TV 송출용 방송국별 심의에서 ${short}${josa(guide, "을/를")} 고르면 영상 1건에 ${won(guide.mv.broadcast)}입니다.` : ""}`,
    });
  } else if (guide.mv?.broadcast) {
    faqs.push({
      question: `${short} 뮤직비디오 심의도 신청할 수 있나요?`,
      answer: `가능합니다. 뮤직비디오 심의에서 방송국별 심의(TV 송출용)를 고르고 ${short}${josa(guide, "을/를")} 선택하면 영상 1건에 ${won(guide.mv.broadcast)}입니다. 온라인 유통용 등급분류와는 별도의 절차입니다.`,
    });
  }
  faqs.push({
    question: `${short} 심의 결과는 어떻게 확인하나요?`,
    answer: guide.album
      ? `접수 후 발급되는 조회 코드나 마이페이지에서 방송국별로 확인합니다. ${short} 결과가 나오면 안내 메일도 보내며, 결과는 방송국 내부 일정에 따라 최대 3주 정도 걸릴 수 있습니다.`
      : `접수 후 발급되는 조회 코드나 마이페이지에서 확인합니다. ${short} 결과가 나오면 안내 메일도 보냅니다. ${MV_SCHEDULE}`,
  });
  faqs.push({
    question: `${short} 심의를 통과하면 방송에 나오나요?`,
    answer: guide.album
      ? `심의 적격은 방송에 내보내도 된다는 판정이고, 실제 편성은 ${short}${josa(guide, "이/가")} 결정합니다. 적격을 받은 뒤 라디오 프로그램의 신청곡 게시판에 직접 신청하면 방송될 기회가 생깁니다.`
      : `심의 결과는 방송에 내보내도 된다는 판정이고, 실제 편성은 ${short}${josa(guide, "이/가")} 결정합니다.`,
  });
  return faqs;
}

/** Guides shown as "함께 보면 좋은 방송국": same group first, then the rest. */
export function relatedStationGuides(guide: StationGuide, limit = 4): StationGuide[] {
  const others = STATION_GUIDES.filter((item) => item.slug !== guide.slug);
  return [...others.filter((item) => item.group === guide.group), ...others.filter((item) => item.group !== guide.group)].slice(0, limit);
}
