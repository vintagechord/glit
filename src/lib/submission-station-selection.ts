export type MvSubmissionType = "MV_DISTRIBUTION" | "MV_BROADCAST";

export type CanonicalMvStation = {
  id: string;
  code: string;
};

export type CanonicalAlbumStationSelection =
  | { ok: true; stationIds: string[] }
  | { ok: false; reason: "MISSING_STATIONS" | "COUNT_MISMATCH" };

export const MV_BASE_ONLINE_PRICE_KRW = 30_000;

export const MV_STATION_PRICE_KRW: Readonly<Record<string, number>> = {
  KBS: 50_000,
  MBC: 30_000,
  SBS: 30_000,
  ETN: 30_000,
  MNET: 30_000,
};

const mvStationCodesByType: Readonly<Record<MvSubmissionType, ReadonlySet<string>>> = {
  MV_BROADCAST: new Set(["KBS", "MBC", "SBS", "ETN"]),
  MV_DISTRIBUTION: new Set(["MBC", "MNET", "ETN"]),
};

export type CanonicalMvStationSelection =
  | {
      ok: true;
      stationIds: string[];
      stationCodes: string[];
      stationAmountKrw: number;
    }
  | {
      ok: false;
      reason: "INVALID_CODE" | "STATION_NOT_FOUND" | "SELECTION_MISMATCH";
    };

const sameSet = (left: string[], right: string[]) => {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((value) => rightSet.has(value));
};

export function resolveCanonicalAlbumStationSelection(params: {
  stationIds: Array<string | null | undefined>;
  expectedCount?: number | null;
}): CanonicalAlbumStationSelection {
  const stationIds = Array.from(
    new Set(params.stationIds.filter((id): id is string => Boolean(id))),
  );
  if (stationIds.length === 0) {
    return { ok: false, reason: "MISSING_STATIONS" };
  }
  if (
    params.expectedCount !== null &&
    params.expectedCount !== undefined &&
    params.expectedCount > 0 &&
    stationIds.length !== params.expectedCount
  ) {
    return { ok: false, reason: "COUNT_MISMATCH" };
  }
  return { ok: true, stationIds };
}

/**
 * Resolves caller-provided station codes/IDs against the server-loaded station
 * rows. The returned IDs and price are derived from the same canonical rows so
 * a caller cannot pay for one set while creating reviews for another.
 */
export function resolveCanonicalMvStationSelection(params: {
  mvType: MvSubmissionType;
  requestedCodes?: string[] | null;
  requestedIds?: string[] | null;
  stations: CanonicalMvStation[];
}): CanonicalMvStationSelection {
  const allowedCodes = mvStationCodesByType[params.mvType];
  const normalizedCodeInputs = (params.requestedCodes ?? []).map((code) =>
    code.trim().toUpperCase(),
  );

  if (
    normalizedCodeInputs.some(
      (code) => !code || !allowedCodes.has(code) || !(code in MV_STATION_PRICE_KRW),
    )
  ) {
    return { ok: false, reason: "INVALID_CODE" };
  }

  const requestedCodes = Array.from(new Set(normalizedCodeInputs));
  const requestedIds = Array.from(
    new Set((params.requestedIds ?? []).map((id) => id.trim()).filter(Boolean)),
  );
  const canonicalStations = params.stations.filter(
    (station) =>
      Boolean(station.id) &&
      allowedCodes.has(station.code) &&
      station.code in MV_STATION_PRICE_KRW,
  );
  const stationByCode = new Map(
    canonicalStations.map((station) => [station.code, station]),
  );
  const stationById = new Map(
    canonicalStations.map((station) => [station.id, station]),
  );

  const stationsFromCodes = requestedCodes.map((code) => stationByCode.get(code));
  const stationsFromIds = requestedIds.map((id) => stationById.get(id));
  if (
    stationsFromCodes.some((station) => !station) ||
    stationsFromIds.some((station) => !station)
  ) {
    return { ok: false, reason: "STATION_NOT_FOUND" };
  }

  const idsFromCodes = stationsFromCodes
    .map((station) => station?.id)
    .filter((id): id is string => Boolean(id));
  const codesFromIds = stationsFromIds
    .map((station) => station?.code)
    .filter((code): code is string => Boolean(code));

  if (
    requestedCodes.length > 0 &&
    requestedIds.length > 0 &&
    (!sameSet(idsFromCodes, requestedIds) || !sameSet(requestedCodes, codesFromIds))
  ) {
    return { ok: false, reason: "SELECTION_MISMATCH" };
  }

  const stationCodes =
    requestedCodes.length > 0 ? requestedCodes : Array.from(new Set(codesFromIds));
  const stationIds =
    requestedCodes.length > 0 ? idsFromCodes : Array.from(new Set(requestedIds));

  return {
    ok: true,
    stationIds,
    stationCodes,
    stationAmountKrw: stationCodes.reduce(
      (sum, code) => sum + MV_STATION_PRICE_KRW[code],
      0,
    ),
  };
}
