import type { SupabaseClient } from "@supabase/supabase-js";

const albumStationCodesByCount: Record<number, string[]> = {
  7: ["KBS", "MBC", "SBS", "CBS", "WBS", "TBS", "YTN"],
  10: [
    "KBS",
    "MBC",
    "SBS",
    "TBS",
    "CBS",
    "PBC",
    "WBS",
    "BBS",
    "YTN",
    "ARIRANG",
  ],
  13: [
    "KBS",
    "MBC",
    "SBS",
    "TBS",
    "CBS",
    "PBC",
    "WBS",
    "BBS",
    "YTN",
    "GYEONGIN_IFM",
    "TBN",
    "ARIRANG",
    "KISS",
  ],
  15: [
    "KBS",
    "MBC",
    "SBS",
    "TBS",
    "CBS",
    "PBC",
    "WBS",
    "BBS",
    "YTN",
    "GYEONGIN_IFM",
    "TBN",
    "ARIRANG",
    "KISS",
    "FEBC",
    "GUGAK",
  ],
};

export const stationNameByCode: Record<string, string> = {
  KBS: "KBS",
  MBC: "MBC",
  SBS: "SBS",
  CBS: "CBS 기독교방송",
  WBS: "WBS 원음방송",
  TBS: "TBS 교통방송",
  YTN: "YTN",
  PBC: "PBC 평화방송",
  BBS: "BBS 불교방송",
  ARIRANG: "Arirang 방송",
  GYEONGIN_IFM: "경인 iFM",
  TBN: "TBN 한국교통방송",
  KISS: "KISS 디지털 라디오 음악방송",
  FEBC: "극동방송(Only CCM)",
  GUGAK: "국악방송(Only 국악)",
};

const shouldSuppressError = (message?: string | null) => {
  if (!message) return false;
  const lowered = message.toLowerCase();
  return (
    lowered.includes("invalid api key") ||
    lowered.includes("jwt") ||
    lowered.includes("permission") ||
    lowered.includes("row level security")
  );
};

export function getPackageStationCodes(
  stationCount?: number | null,
  packageName?: string | null,
): string[] {
  let resolved = stationCount ?? null;
  if (!resolved && packageName) {
    const match = packageName.match(/(\d+)/);
    if (match) {
      const parsed = Number(match[1]);
      if (Number.isFinite(parsed)) resolved = parsed;
    }
  }
  const codes = resolved ? albumStationCodesByCount[resolved] : null;
  return codes && codes.length ? codes : [];
}

export function getPackageStations(
  stationCount?: number | null,
  packageName?: string | null,
): Array<{ code: string; name: string }> {
  const codes = getPackageStationCodes(stationCount, packageName);
  return codes.map((code) => ({ code, name: stationNameByCode[code] ?? code }));
}

export async function syncAlbumStationCatalog(client: SupabaseClient) {
  const stationRows = Object.entries(stationNameByCode).map(([code, name]) => ({
    code,
    name,
    is_active: true,
  }));

  const { error: stationUpsertError } = await client
    .from("stations")
    .upsert(stationRows, { onConflict: "code" });

  if (stationUpsertError) {
    if (!shouldSuppressError(stationUpsertError.message)) {
      console.warn("Failed to sync stations", stationUpsertError);
    }
    return;
  }

  const counts = Object.keys(albumStationCodesByCount).map((value) =>
    Number(value),
  );
  const { data: packages, error: packageError } = await client
    .from("packages")
    .select("id, station_count")
    .in("station_count", counts);

  if (packageError) {
    if (!shouldSuppressError(packageError.message)) {
      console.warn("Failed to load packages", packageError);
    }
    return;
  }

  const expectedCodes = Array.from(
    new Set(
      Object.values(albumStationCodesByCount).flatMap((codes) => codes),
    ),
  );
  const { data: stations, error: stationError } = await client
    .from("stations")
    .select("id, code")
    .in("code", expectedCodes);

  if (stationError) {
    if (!shouldSuppressError(stationError.message)) {
      console.warn("Failed to load stations", stationError);
    }
    return;
  }

  const stationMap = new Map(
    (stations ?? []).map((station) => [station.code, station.id]),
  );

  const rows =
    packages?.flatMap((pkg) => {
      const codes = albumStationCodesByCount[pkg.station_count] ?? [];
      return codes
        .map((code) => stationMap.get(code))
        .filter((id): id is string => Boolean(id))
        .map((stationId) => ({
          package_id: pkg.id,
          station_id: stationId,
        }));
    }) ?? [];

  if (rows.length === 0) return;

  const { error: deleteError } = await client
    .from("package_stations")
    .delete()
    .in(
      "package_id",
      (packages ?? []).map((pkg) => pkg.id),
    );

  if (deleteError && !shouldSuppressError(deleteError.message)) {
    console.warn("Failed to reset package stations", deleteError);
  }

  const { error: insertError } = await client
    .from("package_stations")
    .insert(rows);

  if (insertError && !shouldSuppressError(insertError.message)) {
    console.warn("Failed to sync package stations", insertError);
  }
}

export async function ensureAlbumStationReviews(
  client: SupabaseClient,
  submissionId: string,
  stationCount?: number | null,
  packageName?: string | null,
) {
  const expectedCodes = getPackageStationCodes(stationCount, packageName);
  if (!expectedCodes || expectedCodes.length === 0) return;

  const { data: stations, error: stationError } = await client
    .from("stations")
    .select("id, code")
    .in("code", expectedCodes);

  if (stationError) {
    if (!shouldSuppressError(stationError.message)) {
      console.warn("Failed to load stations", stationError);
    }
    return;
  }

  let stationRows = stations ?? [];
  let stationMap = new Map(
    stationRows.map((station) => [station.code, station.id]),
  );
  const missingCodes = expectedCodes.filter((code) => !stationMap.has(code));

  if (missingCodes.length > 0) {
    const { error: upsertError } = await client.from("stations").upsert(
      missingCodes.map((code) => ({
        code,
        name: stationNameByCode[code] ?? code,
        is_active: true,
      })),
      { onConflict: "code" },
    );

    if (!upsertError) {
      const { data: refreshed } = await client
        .from("stations")
        .select("id, code")
        .in("code", expectedCodes);
      stationRows = refreshed ?? stationRows;
      stationMap = new Map(
        stationRows.map((station) => [station.code, station.id]),
      );
    }
  }

  const stationIds = expectedCodes
    .map((code) => stationMap.get(code))
    .filter((id): id is string => Boolean(id));

  if (stationIds.length === 0) return;

  const { data: existingReviews, error: existingError } = await client
    .from("station_reviews")
    .select("station_id")
    .eq("submission_id", submissionId);

  if (existingError) {
    if (!shouldSuppressError(existingError.message)) {
      console.warn("Failed to load station reviews", existingError);
    }
    return;
  }

  const existingSet = new Set(
    (existingReviews ?? [])
      .map((review) => review.station_id)
      .filter((id): id is string => Boolean(id)),
  );
  const missingIds = stationIds.filter((id) => !existingSet.has(id));

  if (missingIds.length === 0) return;

  const { error: insertError } = await client.from("station_reviews").insert(
    missingIds.map((stationId) => ({
      submission_id: submissionId,
      station_id: stationId,
      status: "NOT_SENT",
    })),
  );

  if (insertError) {
    if (!shouldSuppressError(insertError.message)) {
      console.warn("Failed to backfill station reviews", insertError);
    }
  }
}
