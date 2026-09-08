import { redirectLegacyPaymentPage } from "@/lib/legacy-payment-redirect";

export default async function EnglishPayPage(props: { params: Promise<{ id: string }> }) {
  return redirectLegacyPaymentPage(props, "en");
}
