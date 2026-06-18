import { redirect } from "next/navigation";

export const metadata = {
  // 크레딧 운영 보류: 전용 페이지 제목 숨김
  // title: "마이페이지 - 크레딧",
  title: "마이페이지",
};

export default async function MyPageCreditsPage() {
  // 크레딧 운영 보류: 전용 페이지 내용 숨김
  /*
  기존 구현은 CreditsPageView를 통해 보유 크레딧과 크레딧 안내를 표시했습니다.
  운영 재개 시 defaultDashboardTabs의 크레딧 메뉴와 함께 복구합니다.
  */
  redirect("/mypage");
}
