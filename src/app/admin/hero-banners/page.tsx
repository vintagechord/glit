import { HeroBannerManager } from "@/components/admin/hero-banner-manager";
import { loadHeroBannerRows } from "@/lib/admin/hero-banner-admin";
import { requireAdminPage } from "@/lib/admin/page-auth";
import { HERO_SETTINGS_KEY, normalizeHeroInterval } from "@/lib/home-hero-banners";
import { createAdminClient } from "@/lib/supabase/admin";

import { deleteHeroBannerAction, saveHeroBannerAction, saveHeroIntervalAction } from "./actions";

export const metadata = {
  title: "메인 배너 관리",
};

export const dynamic = "force-dynamic";

const savedMessages: Record<string, string> = {
  banner: "배너를 저장했습니다. 메인 페이지에 바로 반영됩니다.",
  added: "새 배너를 추가했습니다. 메인 페이지에 바로 반영됩니다.",
  deleted: "배너를 삭제했습니다.",
  interval: "넘김 간격을 저장했습니다.",
};

const single = (value?: string | string[]) => (Array.isArray(value) ? value[0] : value) ?? "";

export default async function AdminHeroBannersPage({
  searchParams,
}: {
  searchParams?: Promise<{ saved?: string | string[]; error?: string | string[] }>;
}) {
  await requireAdminPage();
  const params = (await searchParams) ?? {};
  const db = createAdminClient();
  const [{ rows, failed }, settings] = await Promise.all([
    loadHeroBannerRows(db),
    db.from("site_settings").select("value").eq("key", HERO_SETTINGS_KEY).maybeSingle(),
  ]);
  return (
    <HeroBannerManager
      rows={rows}
      failed={failed}
      intervalSeconds={normalizeHeroInterval(settings.data?.value)}
      savedMessage={savedMessages[single(params.saved)]}
      errorMessage={single(params.error) || undefined}
      actions={{ save: saveHeroBannerAction, remove: deleteHeroBannerAction, saveInterval: saveHeroIntervalAction }}
    />
  );
}
