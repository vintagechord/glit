import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export const metadata = { title: "주문내역" };

export default function DashboardOrdersPage() { redirect("/mypage/orders"); }
