import { redirect } from "next/navigation";

export const metadata = {
  title: "작성중 신청서",
};

export default function DashboardDraftSubmissionsPage() {
  redirect("/mypage/drafts");
}
