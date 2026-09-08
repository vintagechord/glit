import { SubmissionOrdersPageView } from "@/app/dashboard/orders/page";
export const dynamic = "force-dynamic";
export const metadata = { title: "마이페이지 - 주문내역" };
export default async function MyPageOrdersPage() { return SubmissionOrdersPageView(); }
