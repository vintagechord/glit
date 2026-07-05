import { createServerSupabase } from "@/lib/supabase/server";

export type SubmissionCartItem = {
  id: string;
  type: string;
  status: string;
  payment_status: string | null;
  title: string | null;
  artist_name: string | null;
  amount_krw: number | null;
  payment_method?: string | null;
  is_oneclick?: boolean | null;
  created_at: string | null;
  updated_at: string | null;
  package?:
    | { name?: string | null; station_count?: number | null }
    | Array<{ name?: string | null; station_count?: number | null }>
    | null;
};

type QueryError = {
  code?: string;
  message?: string;
};

const CART_PAYMENT_FILTER =
  "payment_status.is.null,payment_status.in.(UNPAID,PAYMENT_PENDING)";

const CART_SELECT =
  "id, type, status, payment_status, payment_method, title, artist_name, amount_krw, is_oneclick, created_at, updated_at, user_deleted_at, package:packages ( name, station_count )";
const CART_LEGACY_SELECT =
  "id, type, status, payment_status, payment_method, title, artist_name, amount_krw, is_oneclick, created_at, updated_at, package:packages ( name, station_count )";

const isMissingUserDeletedAt = (error?: QueryError | null) =>
  Boolean(
    error &&
      (error.code === "42703" ||
        error.message?.toLowerCase().includes("user_deleted_at")),
  );

const buildCartQuery = (
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  userId: string,
  select: string,
  includeUserVisibility = true,
) => {
  let query = supabase
    .from("submissions")
    .select(select)
    .eq("user_id", userId)
    .in("status", ["SUBMITTED", "WAITING_PAYMENT"])
    .or(CART_PAYMENT_FILTER);

  if (includeUserVisibility) {
    query = query.is("user_deleted_at", null);
  }

  return query.order("updated_at", { ascending: false }).limit(200);
};

export const getSubmissionCartItems = async (
  userId: string,
): Promise<{ items: SubmissionCartItem[]; error: QueryError | null }> => {
  const supabase = await createServerSupabase();
  const primary = await buildCartQuery(supabase, userId, CART_SELECT);

  if (!primary.error) {
    return {
      items: ((primary.data ?? []) as unknown[]).map(
        (row) => row as SubmissionCartItem,
      ),
      error: null,
    };
  }

  if (!isMissingUserDeletedAt(primary.error)) {
    return { items: [], error: primary.error };
  }

  const fallback = await buildCartQuery(
    supabase,
    userId,
    CART_LEGACY_SELECT,
    false,
  );

  if (fallback.error) {
    return { items: [], error: fallback.error };
  }

  return {
    items: ((fallback.data ?? []) as unknown[]).map(
      (row) => row as SubmissionCartItem,
    ),
    error: null,
  };
};

export const getSubmissionCartCount = async (userId: string) => {
  const { items, error } = await getSubmissionCartItems(userId);
  if (error) {
    return { count: 0, totalAmountKrw: 0, error };
  }

  const totalAmountKrw = items.reduce((sum, item) => {
    const amount = Math.round(Number(item.amount_krw ?? 0));
    return Number.isFinite(amount) && amount > 0 ? sum + amount : sum;
  }, 0);

  return { count: items.length, totalAmountKrw, error: null };
};
