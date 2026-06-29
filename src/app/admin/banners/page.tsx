import {
  deleteAdBannerFormAction,
  upsertAdBannerFormAction,
} from "@/features/admin/actions";
import { AdminSaveToast } from "@/components/admin/save-toast";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata = {
  title: "배너 관리",
};

export const dynamic = "force-dynamic";

const placementOptions = [
  { value: "STRIP", label: "홈 하단 띠배너" },
  { value: "HOME_HERO", label: "메인 상단 광고판" },
  { value: "LEFT", label: "좌측 고정 배너" },
] as const;

type BannerRow = {
  id: string;
  title: string;
  description: string | null;
  image_url: string;
  link_url: string | null;
  placement: string | null;
  sort_order: number | null;
  is_active: boolean;
};

export default async function AdminBannersPage({
  searchParams,
}: {
  searchParams?: Promise<{ saved?: string | string[] }>;
}) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const savedFlag = Array.isArray(resolvedSearchParams?.saved)
    ? resolvedSearchParams?.saved[0]
    : resolvedSearchParams?.saved;
  const supabase = await createServerSupabase();
  const { data, error: bannersError } = await supabase
    .from("ad_banners")
    .select(
      "id, title, description, image_url, link_url, placement, sort_order, is_active, starts_at, ends_at",
    )
    .order("placement", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });
  let banners = (data ?? []) as BannerRow[];
  const bannerTableMissing =
    bannersError?.message
      ?.toLowerCase()
      .includes("ad_banners") &&
    bannersError.message.toLowerCase().includes("schema cache");
  const bannerColumnMissing =
    !bannerTableMissing &&
    ["description", "placement", "sort_order"].some((column) =>
      bannersError?.message?.toLowerCase().includes(column),
    );

  if (bannerTableMissing || bannerColumnMissing) {
    banners = [];
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-12">
      {savedFlag ? <AdminSaveToast message="저장되었습니다." /> : null}
      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
        관리자
      </p>
      <h1 className="font-display mt-2 text-3xl text-foreground">배너 관리</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        홈 화면 띠배너와 메인 상단 광고판의 이미지, 링크, 노출 여부를 관리합니다.
      </p>

      <div className="mt-8 space-y-6">
        {bannersError && (
          <div className="rounded-2xl border border-dashed border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-600">
            {bannerTableMissing
              ? "배너 테이블이 아직 생성되지 않았습니다. Supabase 마이그레이션을 실행해주세요."
              : bannerColumnMissing
                ? "배너 위치 관리 컬럼이 아직 반영되지 않았습니다. 최신 Supabase 마이그레이션을 실행해주세요."
              : `배너 목록을 불러오지 못했습니다. (${bannersError.message})`}
          </div>
        )}
        <section className="space-y-4 rounded-[32px] border border-border/60 bg-card/80 p-6">
          <h2 className="text-lg font-semibold text-foreground">등록된 배너</h2>
          <div className="space-y-4">
            {banners && banners.length > 0 ? (
              banners.map((banner) => (
                <div
                  key={banner.id}
                  className="rounded-2xl border border-border/60 bg-background/70 p-4"
                >
                  <BannerForm banner={banner} submitLabel="저장" />
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
          <div className="mt-4">
            <BannerForm submitLabel="추가" />
          </div>
        </section>
      </div>
    </div>
  );
}

function BannerForm({
  banner,
  submitLabel,
}: {
  banner?: BannerRow;
  submitLabel: string;
}) {
  return (
    <form action={upsertAdBannerFormAction} className="space-y-4">
      {banner ? <input type="hidden" name="id" value={banner.id} /> : null}

      <div className="grid gap-3 md:grid-cols-[1fr_1.5fr_120px_auto]">
        <label className="space-y-1 text-xs font-semibold text-muted-foreground">
          노출 위치
          <select
            name="placement"
            defaultValue={banner?.placement ?? "STRIP"}
            className="h-10 w-full rounded-2xl border border-border/70 bg-background px-3 text-xs text-foreground"
          >
            {placementOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs font-semibold text-muted-foreground">
          제목
          <input
            name="title"
            defaultValue={banner?.title ?? ""}
            className="h-10 w-full rounded-2xl border border-border/70 bg-background px-3 text-xs text-foreground"
            placeholder="배너 제목"
          />
        </label>
        <label className="space-y-1 text-xs font-semibold text-muted-foreground">
          정렬
          <input
            name="sortOrder"
            type="number"
            min={0}
            defaultValue={banner?.sort_order ?? 0}
            className="h-10 w-full rounded-2xl border border-border/70 bg-background px-3 text-xs text-foreground"
          />
        </label>
        <label className="flex items-end gap-2 pb-2 text-xs font-semibold text-muted-foreground">
          <input
            type="checkbox"
            name="isActive"
            defaultChecked={banner?.is_active ?? true}
            className="h-4 w-4 rounded border-border"
          />
          활성화
        </label>
      </div>

      <label className="block space-y-1 text-xs font-semibold text-muted-foreground">
        설명
        <input
          name="description"
          defaultValue={banner?.description ?? ""}
          className="h-10 w-full rounded-2xl border border-border/70 bg-background px-3 text-xs text-foreground"
          placeholder="배너 보조 문구"
        />
      </label>

      <div className="grid gap-3 md:grid-cols-[1.3fr_1fr_1.2fr_auto]">
        <label className="space-y-1 text-xs font-semibold text-muted-foreground">
          이미지 URL
          <input
            name="imageUrl"
            type="text"
            defaultValue={banner?.image_url ?? ""}
            className="h-10 w-full rounded-2xl border border-border/70 bg-background px-3 text-xs text-foreground"
            placeholder="/media/... 또는 https://..."
          />
        </label>
        <label className="space-y-1 text-xs font-semibold text-muted-foreground">
          이미지 파일
          <input
            name="imageFile"
            type="file"
            accept="image/*"
            className="h-10 w-full rounded-2xl border border-border/70 bg-background px-3 py-2 text-xs text-foreground"
          />
        </label>
        <label className="space-y-1 text-xs font-semibold text-muted-foreground">
          링크
          <input
            name="linkUrl"
            type="text"
            defaultValue={banner?.link_url ?? ""}
            className="h-10 w-full rounded-2xl border border-border/70 bg-background px-3 text-xs text-foreground"
            placeholder="/dashboard/new/album 또는 https://..."
          />
        </label>
        <div className="flex items-end">
          <button
            type="submit"
            className="h-10 rounded-full bg-foreground px-5 text-xs font-semibold uppercase tracking-[0.2em] text-background"
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </form>
  );
}
