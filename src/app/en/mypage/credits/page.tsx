import { redirect } from "next/navigation";

export { metadata } from "@/app/mypage/credits/page";

export default async function EnglishMyPageCreditsPage() {
  // 크레딧 운영 보류: 영문 전용 페이지 내용 숨김
  /*
  기존 구현은 CreditsPageView를 통해 보유 크레딧과 크레딧 안내를 표시했습니다.
  운영 재개 시 영문 마이페이지 탭과 함께 복구합니다.
  */
  redirect("/en/mypage");
}
