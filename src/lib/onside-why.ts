/**
 * Why a musician or a label hands a review to Onside: the case the about page
 * makes, shared with llms.txt and the structured data so every place says the
 * same thing. Owner 2026-11-16: Onside is not a small review-only desk but the
 * review brand of 빈티지하우스, which also runs a beat market, an art-goods
 * store, a music studio and a repair shop; say so, and say what the service
 * does. Every line is something the site already does or the owner stated as
 * copy. No rankings, no "best", no promise about a review's outcome or about
 * airplay. Owner 2026-11-20 reworded three lines: the "since" title, the
 * family line and the offices line are the owner's exact copy.
 */
import { APP_CONFIG } from "@/lib/config";

export const ONSIDE_WHY_PATH = "/about";

export type Bilingual = { ko: string; en: string };

/** 빈티지하우스's brands, in the order the owner listed them after Onside. */
export const ONSIDE_FAMILY: Array<{
  key: string;
  name: string;
  nameEn: string;
  /** Two or three words for a label. */
  role: Bilingual;
  description: string;
  descriptionEn: string;
  /** Official site; null for Onside itself, which is this site. */
  url: string | null;
}> = [
  {
    key: "onside", name: "온사이드", nameEn: "Onside", role: { ko: "심의", en: "Review" },
    description: "2017년부터 이어온 음반·뮤직비디오 심의 대행", descriptionEn: "Album and music video review submissions since 2017", url: null,
  },
  {
    key: "watermelon", name: "워터멜론", nameEn: "Watermelon", role: { ko: "비트마켓", en: "Beat market" },
    description: "국내 유일의 비트마켓", descriptionEn: "Korea's only beat market", url: "https://www.iamwatermelon.com",
  },
  {
    key: "artmelon", name: "아트멜론", nameEn: "Artmelon", role: { ko: "아트상품 스토어", en: "Art-goods store" },
    description: "뮤지션의 음반과 굿즈 등 아트상품을 파는 스토어", descriptionEn: "A store for musicians' albums, merch and art goods", url: "https://artmelon.co.kr/",
  },
  {
    key: "vintagehouse", name: "빈티지하우스", nameEn: "Vintage House", role: { ko: "뮤직 스튜디오", en: "Music studio" },
    description: "뮤직 스튜디오", descriptionEn: "A music studio", url: "https://vhouse.co.kr",
  },
  {
    key: "machfix", name: "마하픽스", nameEn: "Machfix", role: { ko: "수리 전문점", en: "Repair shop" },
    description: "음향기기 수리 전문점", descriptionEn: "An audio equipment repair shop", url: "https://machfix.co.kr",
  },
];

const sisterNames = ONSIDE_FAMILY.slice(1).map((brand) => `${brand.role.ko} ${brand.name}`).join(", ");

export type OnsideReason = { key: "since" | "family" | "offices" | "online" | "progress" | "after"; title: Bilingual; body: Bilingual };

/** Six reasons, each a thing the service does. Not a sequence. */
export const ONSIDE_REASONS: OnsideReason[] = [
  {
    key: "since",
    title: { ko: "Since 2017", en: "Since 2017" },
    body: {
      ko: "음반 심의와 뮤직비디오 심의 접수를 2017년부터 대행해 왔습니다.",
      en: "Onside has handled album and music video review submissions since 2017.",
    },
  },
  {
    key: "family",
    title: { ko: "음악 회사가 직접 운영합니다", en: "Run by a music company" },
    body: {
      ko: `${APP_CONFIG.businessName}는 온사이드를 포함 ${sisterNames}를 함께 운영합니다.`,
      en: "Vintage House runs Onside together with the Watermelon beat market, the Artmelon art-goods store, the Vintage House music studio and the Machfix repair shop.",
    },
  },
  {
    key: "offices",
    title: { ko: "필요한 접수처를 한 번에", en: "Every office in one application" },
    body: {
      ko: "TV·라디오 방송국 15곳의 음반 심의, 영상물등급위원회 등급분류와 방송국별 뮤직비디오 심의 등 국내 가능한 모든 심의 접수가 가능합니다.",
      en: "Album reviews at 15 TV and radio stations, KMRB music video ratings, station music video reviews: every review available in Korea can be submitted here.",
    },
  },
  {
    key: "online",
    title: { ko: "온라인으로 끝나는 접수", en: "Done online" },
    body: {
      ko: "신청서, 파일 제출, 결제, 보완, 결과 확인까지 온라인으로 진행합니다. 이미 발매한 음원은 멜론·지니 앨범 링크가 신청서를 대신합니다.",
      en: "Application, files, payment, supplements and results all happen online. For a released album, its Melon or Genie link stands in for the form.",
    },
  },
  {
    key: "progress",
    title: { ko: "진행 상황이 보입니다", en: "You can see where it stands" },
    body: {
      ko: "방송국별 접수와 결과를 마이페이지와 조회 코드로 확인하고, 결과는 메일로도 안내합니다.",
      en: "Follow each station's intake and result in your account or with a lookup code; results are mailed too.",
    },
  },
  {
    key: "after",
    title: { ko: "심의가 끝난 뒤에도", en: "After the review, too" },
    body: {
      ko: "심의를 마친 곡에 맞는 라디오 프로그램과 신청 게시판을 알려드리고, 심의·발매 기록을 보관하며, 아트멜론 입점을 돕습니다.",
      en: "We point you to radio programs and request boards that fit your reviewed song, keep your review and release records, and help you onto Artmelon.",
    },
  },
];

/** From application to airplay requests; this one is a sequence. */
export const ONSIDE_FLOW: Bilingual[] = [
  { ko: "온라인 신청·결제", en: "Apply and pay online" },
  { ko: "방송국·영등위 접수", en: "Submitted to stations and KMRB" },
  { ko: "결과 확인·필증 수령", en: "Results and certificate" },
  { ko: "방송 신청 방법 안내", en: "How to request airplay" },
];

export const ONSIDE_WHY_FAQS: Array<{ question: string; answer: string; questionEn: string; answerEn: string }> = [
  {
    question: "음반 심의 대행이란 무엇인가요?",
    answer: "방송에 음악을 내보내려면 방송국마다 음반 심의를 받아야 합니다. 온사이드는 방송국별 신청과 음원·가사 자료 제출, 결과 확인을 대신 진행하는 음반 심의 대행 서비스입니다.",
    questionEn: "What is an album review agency?",
    answerEn: "Each Korean broadcaster reviews a song before airing it. Onside files the applications, audio and lyrics with each station for you and reports the results.",
  },
  {
    question: "온사이드는 어떤 회사가 운영하나요?",
    answer: `${APP_CONFIG.businessName}가 운영합니다. ${sisterNames}를 함께 운영하는 음악 회사이며, 온사이드는 2017년부터 이어온 심의 브랜드입니다.`,
    questionEn: "Who runs Onside?",
    answerEn: "Vintage House Co., Ltd., a music company that also runs the Watermelon beat market, the Artmelon store, a music studio and the Machfix repair shop. Onside has been its review brand since 2017.",
  },
  {
    question: "뮤직비디오 심의도 대행하나요?",
    answer: "네. 온라인 유통용 영상물등급위원회 등급분류와 KBS·MBC·SBS 방송국별 뮤직비디오 심의를 접수하고, 결과와 필증을 내려받을 수 있게 안내합니다.",
    questionEn: "Do you handle music video reviews?",
    answerEn: "Yes: KMRB ratings for online distribution and station reviews at KBS, MBC and SBS, with the result and certificate available to download.",
  },
  {
    question: "심의 대행 비용과 기간은 어떻게 되나요?",
    answer: "비용은 방송국 수와 심의 종류에 따라 다르며 심의 비용 안내에서 확인할 수 있습니다. 자료와 결제가 확인되면 접수하고, 결과는 방송국 일정에 따라 최대 약 3주가 걸릴 수 있습니다.",
    questionEn: "What does it cost and how long does it take?",
    answerEn: "The cost depends on the number of stations and the review type; see the pricing guide. We submit once files and payment are confirmed, and results can take up to about three weeks depending on each station.",
  },
  {
    question: "비회원도 심의를 신청할 수 있나요?",
    answer: "네. 비회원도 신청할 수 있고, 조회 코드로 진행 상황과 결과를 확인합니다.",
    questionEn: "Can I apply without an account?",
    answerEn: "Yes. Guests can apply and follow progress and results with a lookup code.",
  },
];
