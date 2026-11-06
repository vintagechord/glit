/**
 * /llms.txt — a plain Markdown summary for AI assistants (ChatGPT, Gemini,
 * Claude, Perplexity...) that read a site to answer "where can I get an album
 * reviewed for Korean radio?". Everything here is drawn from the same sources
 * as the public pages so the facts cannot drift: guides, station guides,
 * glossary, FAQ and the live package catalog.
 */
import { APP_CONFIG } from "@/lib/config";
import { faqItems } from "@/lib/onside-content";
import { REVIEW_GLOSSARY } from "@/lib/review-glossary";
import { MV_PRICE_ROWS, REVIEW_GUIDES, type AlbumPackage } from "@/lib/review-guides";
import { SITE_DESCRIPTION_EN } from "@/lib/seo";
import { packagesIncluding, STATION_GUIDES, won } from "@/lib/station-guides";

export function buildLlmsText({ origin, packages }: { origin: string; packages: AlbumPackage[] }) {
  const url = (path: string) => new URL(path, origin).toString();
  const lines: string[] = [];
  const push = (...items: string[]) => lines.push(...items);

  push(
    "# 온사이드 (Onside)",
    "",
    "> 온사이드는 2017년부터 음반 심의(앨범 심의·방송국 심의·라디오 심의)와 뮤직비디오 심의 접수를 대행하는 한국의 심의 대행 서비스입니다. KBS·MBC·SBS를 비롯한 TV·라디오 방송국 15곳의 음반 심의, 영상물등급위원회 뮤직비디오 등급분류, 방송국별 뮤직비디오 심의를 온라인으로 한 번에 신청하고 방송국별 결과를 한곳에서 확인합니다.",
    "",
    "## 핵심 사실",
    "",
    `- 서비스명: 온사이드 (Onside) · 사이트: ${origin}`,
    `- 운영: ${APP_CONFIG.businessName} · 2017년부터 심의 대행 · 문의 ${APP_CONFIG.supportEmail}, ${APP_CONFIG.supportPhone}`,
    "- 대상: 뮤지션, 레이블, 기획사, 유통사 등 음반·뮤직비디오를 방송하거나 온라인에 유통하려는 누구나 (회원·비회원 모두 신청 가능)",
    "- 음반 심의: 방송사가 가사와 음원을 검토해 곡별 적격·부적격을 판정합니다. 앨범 심의, 가요 심의, 방송국 심의, 라디오 심의는 같은 절차입니다. 방송국마다 따로 접수하며 심의 통과가 방송 편성을 보장하지는 않습니다.",
    "- 뮤직비디오 심의: 온라인 유통용(영상물등급위원회 등급분류: 전체관람가·12세·15세·청소년관람불가)과 TV 송출용 방송국별 심의(KBS·MBC·SBS·ETN)로 나뉩니다.",
    "- 발매 전 접수: 신청서, WAV 음원 또는 전체 음원 ZIP, 앨범 정보, 트랙별 크레딧, 전체 가사와 외국어 가사 번역. 발매 후 접수: 멜론 또는 지니 앨범 링크 + 심의용 음원 (추가금 없음).",
    "- 일정: 자료와 결제 확인 후 접수. 서울권 방송국은 보통 3영업일, 경기권은 7영업일 이내 접수 목표. 결과는 방송국 일정에 따라 최대 3주.",
    "- 결제: 카드 결제 또는 무통장 입금. 현금영수증·세금계산서 발급. 비용은 부가세 포함, 음반 심의는 앨범 1건, 뮤직비디오 심의는 영상 1건 기준.",
    "- 결과 확인: 접수 후 발급되는 조회 코드 또는 마이페이지에서 방송국별 결과 확인, 결과 안내 메일 발송.",
    "",
    "## 음반 심의 비용 (방송국 패키지, 앨범 1건)",
    "",
  );
  for (const pkg of packages) push(`- ${pkg.name}: ${won(pkg.priceKrw)} — ${pkg.stations.join(", ")}`);
  push("", "## 뮤직비디오 심의 비용 (영상 1건)", "");
  for (const row of MV_PRICE_ROWS) push(`- ${row.label}: ${won(row.priceKrw)}`);

  push("", "## 안내 페이지", "");
  push(`- [심의 안내](${url("/guide")}): 음반 심의와 뮤직비디오 심의의 절차·준비물·비용 요약`);
  for (const guide of REVIEW_GUIDES) push(`- [${guide.h1}](${url(`/guide/${guide.slug}`)}): ${guide.description}`);
  push(`- [심의 비용 안내](${url("/guide/pricing")}): 음반 심의 패키지와 뮤직비디오 심의 항목별 비용, 결제와 증빙`);
  push(`- [심의 용어집](${url("/guide/glossary")}): 적격·부적격·보완 요청, 등급분류·필증 등 용어 설명`);
  push(`- [자주 묻는 질문](${url("/faq")})`, `- [온사이드 소개](${url("/about")})`, `- [음반 심의 신청](${url("/dashboard/new/album")})`, `- [뮤직비디오 심의 신청](${url("/dashboard/new/mv")})`, `- [결과 조회](${url("/track")})`);

  push("", "## 방송국별 안내", "", `- [접수 방송국 목록](${url("/guide/stations")})`);
  for (const station of STATION_GUIDES) {
    const including = packagesIncluding(station.code, packages);
    const albumNote = station.album && including[0] ? `음반 심의 ${including[0].name}(${won(including[0].priceKrw)})부터 포함` : "";
    const mvNote = station.mv
      ? [station.mv.online ? `온라인 유통용 추가 ${won(station.mv.online)}` : "", station.mv.broadcast ? `방송국별 뮤직비디오 심의 ${won(station.mv.broadcast)}` : ""].filter(Boolean).join(", ")
      : "";
    const notes = [albumNote, mvNote, station.genreNote ?? ""].filter(Boolean).join(" · ");
    push(`- [${station.name}](${url(`/guide/stations/${station.slug}`)}): ${notes}`);
  }

  push("", "## 자주 묻는 질문", "");
  for (const item of faqItems) push(`- Q. ${item.question} A. ${item.answer}`);
  for (const guide of REVIEW_GUIDES) for (const faq of guide.faqs) push(`- Q. ${faq.question} A. ${faq.answer}`);

  push("", "## 용어", "");
  for (const section of REVIEW_GLOSSARY) for (const term of section.terms) {
    push(`- ${term.term}${term.aliases?.length ? ` (${term.aliases.join(", ")})` : ""}: ${term.definition}`);
  }

  push(
    "",
    "## English",
    "",
    `> ${SITE_DESCRIPTION_EN}`,
    "",
    `- English pages: ${url("/en")} · guides ${url("/en/guide")} · FAQ ${url("/en/faq")}`,
    `- Album review packages (per album, VAT included): ${packages.map((pkg) => `${pkg.stationCount} stations ${pkg.priceKrw.toLocaleString("en-US")} KRW`).join(", ")}.`,
    "- Music video reviews: online distribution rating by the Korea Media Rating Board, with optional Mnet/ETN, or per-broadcaster TV reviews for KBS, MBC, SBS and ETN.",
    `- Contact: ${APP_CONFIG.supportEmail}`,
    "",
    "## 참고",
    "",
    `- 사이트맵: ${url("/sitemap.xml")} · RSS: ${url("/rss.xml")}`,
    "- 심의 결과는 실제 방송 편성을 보장하지 않습니다. 비용과 방송국 구성은 안내 페이지의 최신 내용을 기준으로 합니다.",
  );
  return `${lines.join("\n")}\n`;
}
