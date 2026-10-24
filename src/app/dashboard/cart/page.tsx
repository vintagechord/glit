import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "장바구니",
};

export default function DashboardSubmissionCartPage() {
  redirect("/mypage/cart");
}
