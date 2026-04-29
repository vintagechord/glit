export type CardPaymentProvider = "inicis" | "mobilians";

const normalizePaymentProvider = (
  value?: string | null,
): CardPaymentProvider | null => {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "inicis" || normalized === "kginicis") return "inicis";
  if (
    normalized === "mobilians" ||
    normalized === "mobilpay" ||
    normalized === "kgmobilians" ||
    normalized === "kgfinancial"
  ) {
    return "mobilians";
  }
  return null;
};

export const getServerCardPaymentProvider = (): CardPaymentProvider =>
  normalizePaymentProvider(process.env.PAYMENT_PROVIDER) ??
  normalizePaymentProvider(process.env.NEXT_PUBLIC_PAYMENT_PROVIDER) ??
  "mobilians";

export const getClientCardPaymentProvider = (): CardPaymentProvider =>
  normalizePaymentProvider(process.env.NEXT_PUBLIC_PAYMENT_PROVIDER) ??
  "mobilians";

