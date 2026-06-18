import { redirect } from "next/navigation";

export const metadata = {
  // 크레딧 운영 보류: 전용 페이지 제목 숨김
  // title: "크레딧",
  title: "마이페이지",
};

type ShellConfig = {
  fallbackPath?: string;
};

export async function CreditsPageView(config?: ShellConfig) {
  // 크레딧 운영 보류: 전용 페이지 내용 숨김
  /*
  기존 크레딧 페이지는 노래방 등록 추천을 위한 보유 크레딧과 적립 안내를
  DashboardShell 안에서 표시했습니다. 운영 재개 시 이전 구현을 복구하고
  마이페이지 탭의 크레딧 메뉴를 다시 연결합니다.
  */
  redirect(config?.fallbackPath ?? "/mypage");
}

export default function DashboardCreditsPage() {
  redirect("/mypage");
}
