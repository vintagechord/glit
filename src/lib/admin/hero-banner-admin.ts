import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  HERO_INTERVAL_MAX,
  HERO_INTERVAL_MIN,
  HERO_SETTINGS_KEY,
  normalizeHeroBannerInput,
  normalizeHeroInterval,
  type HeroBannerRow,
} from "@/lib/home-hero-banners";

/** 메인 배너 관리: the writes behind the admin page. Callers authorize first. */
export const HERO_BANNER_COLUMNS =
  "id, design, badge, headline_1, headline_2, body, badge_en, headline_1_en, headline_2_en, body_en, link_url, sort_order, is_active";

type Result = { ok: true } | { ok: false; error: string };
const saveFailed = "배너를 저장하지 못했습니다. 잠시 후 다시 시도해주세요.";
const isId = (value: unknown): value is string => z.string().uuid().safeParse(value).success;

/** Every saved banner, in the order the page shows them. */
export async function loadHeroBannerRows(db: SupabaseClient): Promise<{ rows: HeroBannerRow[]; failed: boolean }> {
  const { data, error } = await db.from("home_hero_banners").select(HERO_BANNER_COLUMNS).order("sort_order").order("created_at");
  return { rows: error ? [] : ((data ?? []) as HeroBannerRow[]), failed: Boolean(error) };
}

export async function saveHeroBanner(db: SupabaseClient, input: { id?: string; raw: Record<string, unknown> }): Promise<Result> {
  if (input.id !== undefined && !isId(input.id)) return { ok: false, error: "배너를 확인하지 못했습니다. 새로고침 후 다시 시도해주세요." };
  const checked = normalizeHeroBannerInput(input.raw);
  if (!checked.ok) return checked;
  if (!input.id) {
    const { error } = await db.from("home_hero_banners").insert(checked.value);
    return error ? { ok: false, error: saveFailed } : { ok: true };
  }
  const { data, error } = await db.from("home_hero_banners").update(checked.value).eq("id", input.id).select("id").maybeSingle();
  if (error) return { ok: false, error: saveFailed };
  return data ? { ok: true } : { ok: false, error: "이미 삭제된 배너입니다. 새로고침해주세요." };
}

export async function deleteHeroBanner(db: SupabaseClient, id: string): Promise<Result> {
  if (!isId(id)) return { ok: false, error: "배너를 확인하지 못했습니다. 새로고침 후 다시 시도해주세요." };
  const { error } = await db.from("home_hero_banners").delete().eq("id", id);
  return error ? { ok: false, error: "배너를 삭제하지 못했습니다. 잠시 후 다시 시도해주세요." } : { ok: true };
}

/** Seconds each banner stays; out-of-range values are brought into range. */
export async function saveHeroInterval(db: SupabaseClient, raw: unknown): Promise<{ ok: true; seconds: number } | { ok: false; error: string }> {
  const parsed = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(parsed)) return { ok: false, error: `넘김 간격은 ${HERO_INTERVAL_MIN}~${HERO_INTERVAL_MAX}초 사이 숫자로 입력해주세요.` };
  const seconds = normalizeHeroInterval({ intervalSeconds: parsed });
  const { error } = await db.from("site_settings").upsert({
    key: HERO_SETTINGS_KEY, value: { intervalSeconds: seconds }, description: "메인 배너 자동 넘김 간격(초)",
  });
  return error ? { ok: false, error: "넘김 간격을 저장하지 못했습니다. 잠시 후 다시 시도해주세요." } : { ok: true, seconds };
}
