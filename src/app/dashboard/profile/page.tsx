import { redirect } from "next/navigation";

export const metadata = {
  title: "계정 정보",
};

export default function DashboardProfilePage() {
  redirect("/mypage/profile");
}
