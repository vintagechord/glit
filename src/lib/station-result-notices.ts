import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A note shown on one station's result while that station has none yet.
 *
 * 2026-11-25 (owner): TBS stopped announcing results over the Seoul city
 * budget and only accepts applications. Customers see why on the TBS row of
 * their status page and of the 심의 현황 mail; the administrator removes the
 * note under 패키지/방송국 설정 once TBS announces results again.
 */
export const STATION_RESULT_NOTICES_KEY = "station_result_notices";
export const STATION_RESULT_NOTICE_MAX = 200;

/** Station code → note. */
export type StationResultNotices = Record<string, string>;

const stationCodePattern = /^[A-Z0-9_]{2,40}$/;

export const normalizeStationCode = (code: unknown) =>
  typeof code === "string" ? code.trim().toUpperCase() : "";

export function normalizeStationResultNotices(value: unknown): StationResultNotices {
  const notices = value && typeof value === "object" && !Array.isArray(value)
    ? (value as { notices?: unknown }).notices
    : null;
  if (!notices || typeof notices !== "object" || Array.isArray(notices)) return {};
  return Object.fromEntries(Object.entries(notices).flatMap(([rawCode, rawText]) => {
    const code = normalizeStationCode(rawCode);
    const text = typeof rawText === "string" ? rawText.trim().slice(0, STATION_RESULT_NOTICE_MAX) : "";
    return stationCodePattern.test(code) && text ? [[code, text]] : [];
  }));
}

/** Never fails the page: a note that cannot be read is simply not shown. */
export async function loadStationResultNotices(db: SupabaseClient): Promise<StationResultNotices> {
  try {
    const { data, error } = await db.from("site_settings").select("value")
      .eq("key", STATION_RESULT_NOTICES_KEY).maybeSingle();
    return error ? {} : normalizeStationResultNotices(data?.value);
  } catch {
    return {};
  }
}

/** The note for a station row, only while the station has no result. */
export function stationResultNoticeFor(
  notices: StationResultNotices | null | undefined,
  stationCode: string | null | undefined,
  hasResult: boolean,
) {
  if (hasResult || !notices) return null;
  return notices[normalizeStationCode(stationCode)] ?? null;
}

/** Sets a station's note, or removes it when the text is empty. */
export async function saveStationResultNotice(
  db: SupabaseClient,
  rawCode: unknown,
  rawText: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const code = normalizeStationCode(rawCode);
  if (!stationCodePattern.test(code)) return { ok: false, error: "방송국 코드를 확인해주세요." };
  const text = typeof rawText === "string" ? rawText.trim() : "";
  if (text.length > STATION_RESULT_NOTICE_MAX) {
    return { ok: false, error: `안내 문구는 ${STATION_RESULT_NOTICE_MAX}자 이내로 입력해주세요.` };
  }
  const { data, error: readError } = await db.from("site_settings").select("value")
    .eq("key", STATION_RESULT_NOTICES_KEY).maybeSingle();
  if (readError) return { ok: false, error: "저장된 안내 문구를 불러오지 못했습니다. 잠시 후 다시 시도해주세요." };
  const notices = normalizeStationResultNotices(data?.value);
  if (text) notices[code] = text;
  else delete notices[code];
  const { error } = await db.from("site_settings").upsert({
    key: STATION_RESULT_NOTICES_KEY,
    value: { notices },
    description: "방송국별 결과 안내 문구(결과가 없는 방송국 행에만 표시)",
  });
  return error ? { ok: false, error: "안내 문구를 저장하지 못했습니다. 잠시 후 다시 시도해주세요." } : { ok: true };
}
