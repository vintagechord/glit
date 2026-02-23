import type { SupabaseClient } from "@supabase/supabase-js";

const albumStationCodesByCount: Record<number, string[]> = {
  7: ["MBC", "KBS", "SBS", "TBS", "YTN", "CBS", "WBS"],
  10: [
    "MBC",
    "KBS",
    "SBS",
    "TBS",
    "YTN",
    "CBS",
    "PBC",
    "WBS",
    "BBS",
    "ARIRANG",
  ],
  13: [
    "MBC",
    "KBS",
    "SBS",
    "TBS",
    "YTN",
    "CBS",
    "PBC",
    "WBS",
    "BBS",
    "KISS",
    "GYEONGIN_IFM",
    "TBN",
    "ARIRANG",
  ],
  15: [
    "MBC",
    "KBS",
    "SBS",
    "TBS",
    "YTN",
    "CBS",
    "PBC",
    "WBS",
    "BBS",
    "KISS",
    "ARIRANG",
    "GYEONGIN_IFM",
    "TBN",
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

type EnsureStationReviewItem = {
  submissionId: string;
  stationCount?: number | null;
  packageName?: string | null;
};

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
  await ensureAlbumStationReviewsBatch(client, [
    { submissionId, stationCount, packageName },
  ]);
}

export async function ensureAlbumStationReviewsBatch(
  client: SupabaseClient,
  items: EnsureStationReviewItem[],
) {
  const normalizedItems = items
    .map((item) => ({
      submissionId: item.submissionId,
      expectedCodes: getPackageStationCodes(item.stationCount, item.packageName),
    }))
    .filter((item) => item.submissionId && item.expectedCodes.length > 0);

  if (normalizedItems.length === 0) return;

  const allCodes = Array.from(
    new Set(normalizedItems.flatMap((item) => item.expectedCodes)),
  );

  const loadStations = async () => {
    const { data, error } = await client
      .from("stations")
      .select("id, code")
      .in("code", allCodes);
    return { data: data ?? [], error };
  };

  let stationResult = await loadStations();
  if (stationResult.error) {
    if (!shouldSuppressError(stationResult.error.message)) {
      console.warn("Failed to load stations", stationResult.error);
    }
    return;
  }

  let stationMap = new Map(
    stationResult.data.map((station) => [station.code, station.id]),
  );
  const missingCodes = allCodes.filter((code) => !stationMap.has(code));

  if (missingCodes.length > 0) {
    const { error: upsertError } = await client.from("stations").upsert(
      missingCodes.map((code) => ({
        code,
        name: stationNameByCode[code] ?? code,
        is_active: true,
      })),
      { onConflict: "code" },
    );

    if (upsertError) {
      if (!shouldSuppressError(upsertError.message)) {
        console.warn("Failed to upsert stations", upsertError);
      }
      return;
    }

    stationResult = await loadStations();
    if (stationResult.error) {
      if (!shouldSuppressError(stationResult.error.message)) {
        console.warn("Failed to reload stations", stationResult.error);
      }
      return;
    }
    stationMap = new Map(
      stationResult.data.map((station) => [station.code, station.id]),
    );
  }

  const expectedPairs = normalizedItems.flatMap((item) =>
    item.expectedCodes
      .map((code) => stationMap.get(code))
      .filter((stationId): stationId is string => Boolean(stationId))
      .map((stationId) => ({
        submission_id: item.submissionId,
        station_id: stationId,
      })),
  );

  if (expectedPairs.length === 0) return;

  const submissionIds = Array.from(
    new Set(normalizedItems.map((item) => item.submissionId)),
  );
  const chunkSize = 200;
  const existingKeys = new Set<string>();

  for (let index = 0; index < submissionIds.length; index += chunkSize) {
    const batchIds = submissionIds.slice(index, index + chunkSize);
    const { data: existingRows, error: existingError } = await client
      .from("station_reviews")
      .select("submission_id, station_id")
      .in("submission_id", batchIds);

    if (existingError) {
      if (!shouldSuppressError(existingError.message)) {
        console.warn("Failed to load station reviews", existingError);
      }
      return;
    }

    (existingRows ?? []).forEach((row) => {
      if (!row.submission_id || !row.station_id) return;
      existingKeys.add(`${row.submission_id}:${row.station_id}`);
    });
  }

  const upsertRows = expectedPairs
    .filter(
      (row) => !existingKeys.has(`${row.submission_id}:${row.station_id}`),
    )
    .map((row) => ({
      ...row,
      status: "NOT_SENT",
    }));

  if (upsertRows.length === 0) return;

  console.info("[station_reviews][backfill][batch][start]", {
    submissionCount: submissionIds.length,
    insertCount: upsertRows.length,
  });

  const insertChunkSize = 500;
  for (let index = 0; index < upsertRows.length; index += insertChunkSize) {
    const chunk = upsertRows.slice(index, index + insertChunkSize);
    const { error: insertError } = await client
      .from("station_reviews")
      .upsert(chunk, {
        onConflict: "submission_id,station_id",
        ignoreDuplicates: true,
      });

    if (insertError) {
      if (!shouldSuppressError(insertError.message)) {
        console.warn("Failed to backfill station reviews", insertError);
      }
      return;
    }
  }

  console.info("[station_reviews][backfill][batch][success]", {
    submissionCount: submissionIds.length,
    insertCount: upsertRows.length,
  });
}
