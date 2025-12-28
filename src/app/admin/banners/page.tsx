import {
  deleteAdBannerFormAction,
  upsertAdBannerFormAction,
} from "@/features/admin/actions";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata = {
  title: "배너 관리",
};

export default async function AdminBannersPage() {
  const supabase = createAdminClient();
  const { data: banners } = await supabase
    .from("ad_banners")
    .select("id, title, image_url, link_url, is_active, starts_at, ends_at")
    .order("created_at", { ascending: false });

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-12">
      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
        관리자
      </p>
      <h1 className="font-display mt-2 text-3xl text-foreground">배너 관리</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        띠배너 이미지를 등록하고 노출 여부를 관리합니다.
      </p>

      <div className="mt-8 space-y-6">
        <section className="space-y-4 rounded-[32px] border border-border/60 bg-card/80 p-6">
          <h2 className="text-lg font-semibold text-foreground">등록된 배너</h2>
          <div className="space-y-4">
            {banners && banners.length > 0 ? (
              banners.map((banner) => (
                <div
                  key={banner.id}
                  className="rounded-2xl border border-border/60 bg-background/70 p-4"
                >
                  <form
                    action={upsertAdBannerFormAction}
                    className="grid gap-3 md:grid-cols-[1.2fr_1.4fr_1.2fr_1.2fr_auto_auto]"
                  >
                    <input type="hidden" name="id" value={banner.id} />
                    <input
                      name="title"
                      defaultValue={banner.title}
                      className="rounded-2xl border border-border/70 bg-background px-3 py-2 text-xs"
                      placeholder="배너 제목"
                    />
                    <input
                      name="imageUrl"
                      type="url"
                      defaultValue={banner.image_url}
                      className="rounded-2xl border border-border/70 bg-background px-3 py-2 text-xs"
                      placeholder="이미지 URL (선택)"
                    />
                    <input
                      name="imageFile"
                      type="file"
                      accept="image/*"
                      className="rounded-2xl border border-border/70 bg-background px-3 py-2 text-xs"
                    />
                    <input
                      name="linkUrl"
                      type="url"
                      defaultValue={banner.link_url ?? ""}
                      className="rounded-2xl border border-border/70 bg-background px-3 py-2 text-xs"
                      placeholder="링크 URL"
                    />
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        name="isActive"
                        defaultChecked={banner.is_active}
                        className="h-4 w-4 rounded border-border"
                      />
                      활성화
                    </label>
                    <button
                      type="submit"
                      className="rounded-full bg-foreground px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-background"
                    >
                      저장
                    </button>
                  </form>
                  <form
                    action={deleteAdBannerFormAction}
                    className="mt-3 flex justify-end"
                  >
                    <input type="hidden" name="id" value={banner.id} />
                    <button
                      type="submit"
                      className="rounded-full border border-border/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-foreground"
                    >
                      삭제
                    </button>
                  </form>
                </div>
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-border/60 bg-background/70 px-4 py-6 text-xs text-muted-foreground">
                등록된 배너가 없습니다.
              </div>
            )}
          </div>
        </section>

        <section className="rounded-[32px] border border-border/60 bg-card/80 p-6">
          <h2 className="text-lg font-semibold text-foreground">새 배너 등록</h2>
          <form
            action={upsertAdBannerFormAction}
            className="mt-4 grid gap-3 md:grid-cols-[1.2fr_1.4fr_1.2fr_1.2fr_auto_auto]"
          >
            <input
              name="title"
              placeholder="배너 제목"
              className="rounded-2xl border border-border/70 bg-background px-3 py-2 text-xs"
            />
            <input
              name="imageUrl"
              type="url"
              placeholder="이미지 URL (선택)"
              className="rounded-2xl border border-border/70 bg-background px-3 py-2 text-xs"
            />
            <input
              name="imageFile"
              type="file"
              accept="image/*"
              className="rounded-2xl border border-border/70 bg-background px-3 py-2 text-xs"
            />
            <input
              name="linkUrl"
              type="url"
              placeholder="링크 URL"
              className="rounded-2xl border border-border/70 bg-background px-3 py-2 text-xs"
            />
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" name="isActive" defaultChecked className="h-4 w-4" />
              활성화
            </label>
            <button
              type="submit"
              className="rounded-full bg-foreground px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-background"
            >
              추가
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
