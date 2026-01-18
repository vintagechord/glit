export type InicisPaymentContext = "music" | "mv" | "oneclick" | "test1000";

export const parseInicisContext = (
  value: string | null | undefined,
): InicisPaymentContext | null => {
  if (!value) return null;
  const normalized = value.toLowerCase();
  if (normalized === "music" || normalized === "mv" || normalized === "oneclick" || normalized === "test1000") {
    return normalized;
  }
  return null;
};
