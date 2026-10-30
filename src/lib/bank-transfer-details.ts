/** Shared rules for the depositor name and expected deposit date collected
 * with a bank-transfer order. Dates are calendar days in Korea (KST). */
export const BANK_DEPOSITOR_NAME_MAX = 40;
export const BANK_DEPOSIT_MAX_DAYS = 14;
export const BANK_DEPOSIT_DEFAULT_DAYS = 3;

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export const toKstDateString = (date: Date) => new Date(date.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);

export const addDays = (dateString: string, days: number) => {
  const base = new Date(`${dateString}T00:00:00+09:00`);
  return toKstDateString(new Date(base.getTime() + days * 86_400_000));
};

export const getBankDepositDateRange = (now = new Date()) => {
  const today = toKstDateString(now);
  return { min: today, max: addDays(today, BANK_DEPOSIT_MAX_DAYS), suggested: addDays(today, BANK_DEPOSIT_DEFAULT_DAYS) };
};

export const normalizeDepositorName = (value: string | null | undefined) =>
  (value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();

export const isValidDepositorName = (value: string) =>
  value.length >= 1 && value.length <= BANK_DEPOSITOR_NAME_MAX && !/[<>]/.test(value);

/** The customer promises to deposit on this day; the order is due at the end of it (KST). */
export const parseDepositDueAt = (dateString: string, now = new Date()): Date | null => {
  if (!datePattern.test(dateString)) return null;
  const due = new Date(`${dateString}T23:59:59+09:00`);
  if (!Number.isFinite(due.valueOf()) || toKstDateString(new Date(due.getTime() - 86_399_000)) !== dateString) return null;
  const { min, max } = getBankDepositDateRange(now);
  if (dateString < min || dateString > max) return null;
  return due;
};

export const formatDepositDue = (value: string | null | undefined) => {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf())) return null;
  return toKstDateString(date);
};

export const isDepositOverdue = (value: string | null | undefined, now = new Date()) => {
  if (!value) return false;
  const date = new Date(value);
  return Number.isFinite(date.valueOf()) && date.getTime() < now.getTime();
};
