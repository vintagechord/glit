import { redirectLegacyPaymentPage } from "@/lib/legacy-payment-redirect";

export const dynamic = "force-dynamic";

export default async function PayPage(props: { params: Promise<{ id: string }> }) {
  return redirectLegacyPaymentPage(props);
}
