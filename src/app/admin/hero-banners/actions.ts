"use server";

import { revalidatePath, updateTag } from "next/cache";
import { redirect } from "next/navigation";

import { requireAdminAction } from "@/lib/admin/action-auth";
import { deleteHeroBanner, saveHeroBanner, saveHeroInterval } from "@/lib/admin/hero-banner-admin";
import { PUBLIC_HOME_HERO_CACHE_TAG } from "@/lib/public-cache-tags";
import { createAdminClient } from "@/lib/supabase/admin";

const PAGE = "/admin/hero-banners";
const back = (state: Record<string, string>) => `${PAGE}?${new URLSearchParams(state).toString()}`;

/** The home page is static: a saved banner must reach it at once. */
function publish() {
  updateTag(PUBLIC_HOME_HERO_CACHE_TAG);
  for (const path of ["/", "/en", PAGE]) revalidatePath(path);
}

const text = (form: FormData, name: string) => String(form.get(name) ?? "");

export async function saveHeroBannerAction(form: FormData): Promise<void> {
  await requireAdminAction();
  const id = text(form, "id") || undefined;
  const result = await saveHeroBanner(createAdminClient(), {
    id,
    raw: {
      design: text(form, "design"),
      badge: text(form, "badge"),
      headline1: text(form, "headline1"),
      headline2: text(form, "headline2"),
      body: text(form, "body"),
      badgeEn: text(form, "badgeEn"),
      headline1En: text(form, "headline1En"),
      headline2En: text(form, "headline2En"),
      bodyEn: text(form, "bodyEn"),
      linkUrl: text(form, "linkUrl"),
      sortOrder: text(form, "sortOrder"),
      isActive: form.get("isActive") === "on",
    },
  });
  if (!result.ok) redirect(back({ error: result.error }));
  publish();
  redirect(back({ saved: id ? "banner" : "added" }));
}

export async function deleteHeroBannerAction(form: FormData): Promise<void> {
  await requireAdminAction();
  const result = await deleteHeroBanner(createAdminClient(), text(form, "id"));
  if (!result.ok) redirect(back({ error: result.error }));
  publish();
  redirect(back({ saved: "deleted" }));
}

export async function saveHeroIntervalAction(form: FormData): Promise<void> {
  await requireAdminAction();
  const result = await saveHeroInterval(createAdminClient(), text(form, "intervalSeconds"));
  if (!result.ok) redirect(back({ error: result.error }));
  publish();
  redirect(back({ saved: "interval" }));
}
