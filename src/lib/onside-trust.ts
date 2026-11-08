/**
 * Facts a visitor checks before trusting a review agency with an album: who
 * runs it, how it is registered, how payment, receipts and refunds work, and
 * how progress is shown. Every line restates something already public on the
 * site (about page, footer, terms and refund policy, guides), so the guides,
 * the about page and llms.txt can repeat it without making new claims. Keep
 * numbers, rankings and customer counts out unless the owner approves them as
 * copy.
 */
import { APP_CONFIG } from "@/lib/config";

/** Date the public guide content was last reviewed; shown on the guides and used as sitemap lastmod. */
export const GUIDE_CONTENT_UPDATED = "2026-11-09";

export const formatKoreanDate = (isoDate: string) => {
  const [year, month, day] = isoDate.split("-").map(Number);
  return `${year}년 ${month}월 ${day}일`;
};

export type TrustFact = { label: string; value: string };

export const ONSIDE_TRUST_FACTS: TrustFact[] = [
  { label: "운영", value: `${APP_CONFIG.businessName} · 2017년부터 음반·뮤직비디오 심의 대행` },
  { label: "정식 등록", value: "통신판매업 · 대중문화예술기획업 · 음반·음악영상물제작업" },
  { label: "결제·증빙", value: "카드 결제·무통장 입금 · 세금계산서·현금영수증·거래내역서 발급" },
  { label: "환불", value: "방송국·기관 접수 전 전액 환불 · 접수하지 않은 방송국 부분 취소 가능" },
  { label: "진행 확인", value: "방송국별 진행 상황과 결과를 마이페이지·조회 코드로 확인 · 결과 안내 메일" },
];
