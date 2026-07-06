import type { PostgrestError } from "@supabase/supabase-js";

import type { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

const isMissingRelationError = (error: PostgrestError | null) => {
  const message = error?.message?.toLowerCase() ?? "";
  return (
    error?.code === "42P01" ||
    error?.code === "42703" ||
    message.includes("does not exist") ||
    message.includes("schema cache")
  );
};

const deleteByColumn = async (
  admin: AdminClient,
  table: string,
  column: string,
  values: string[],
) => {
  if (values.length === 0) return null;

  const { error } = await admin.from(table).delete().in(column, values);
  if (error && !isMissingRelationError(error)) {
    return error;
  }
  return null;
};

export const deleteSubmissionRelations = async (
  admin: AdminClient,
  submissionIds: string[],
) => {
  const ids = Array.from(new Set(submissionIds.filter(Boolean)));
  if (ids.length === 0) return null;

  const { data: promotions, error: promotionLoadError } = await admin
    .from("karaoke_promotions")
    .select("id")
    .in("submission_id", ids);

  if (promotionLoadError && !isMissingRelationError(promotionLoadError)) {
    return promotionLoadError;
  }

  const promotionIds = ((promotions ?? []) as Array<{ id?: string | null }>)
    .map((row) => row.id)
    .filter((id): id is string => Boolean(id));

  for (const table of [
    "karaoke_promotion_recommendations",
    "karaoke_promotion_contributions",
  ]) {
    const error = await deleteByColumn(admin, table, "promotion_id", promotionIds);
    if (error) return error;
  }

  for (const table of [
    "karaoke_promotions",
    "magazine_requests",
    "submission_payments",
    "submission_events",
    "station_reviews",
    "album_tracks",
    "submission_files",
  ]) {
    const error = await deleteByColumn(admin, table, "submission_id", ids);
    if (error) return error;
  }

  return null;
};
