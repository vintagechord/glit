import { redirect } from "next/navigation";

export default function EnglishDashboardCreditsPage() {
  // 크레딧 운영 보류: 전용 페이지 대신 마이페이지로 이동
  redirect("/en/mypage");
}
