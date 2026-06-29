import { redirect } from "next/navigation";

export { metadata } from "@/app/mypage/credits/page";

export default function DashboardCreditsPage() {
  redirect("/mypage/credits");
}
