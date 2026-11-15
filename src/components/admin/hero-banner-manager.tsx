import Link from "next/link";

import { AdminSaveToast } from "@/components/admin/save-toast";
import { ConfirmSubmitButton } from "@/components/admin/confirm-submit-button";
import { HomeHeroBanner } from "@/components/site/home-hero-banner";
import { brandStatusTones } from "@/lib/brand-status-tones";
import {
  DEFAULT_HERO_SLIDES,
  HERO_DESIGN_OPTIONS,
  HERO_DESIGNS,
  HERO_INTERVAL_MAX,
  HERO_INTERVAL_MIN,
  HERO_MAX_SLIDES,
  HERO_TEXT_LIMITS,
  isHeroDesign,
  toHeroSlides,
  type HeroBannerRow,
} from "@/lib/home-hero-banners";

type FormAction = (form: FormData) => void | Promise<void>;
export type HeroBannerActions = { save: FormAction; remove: FormAction; saveInterval: FormAction };

const fieldClass =
  "h-10 w-full rounded-[8px] border-2 border-border bg-background px-3 text-sm font-semibold text-foreground outline-none transition focus:border-[#1556a4]";
const labelClass = "block space-y-1 text-xs font-bold text-muted-foreground";

/**
 * 메인 배너 관리: every saved banner with a live preview and its form, the
 * slide interval, and a form for a new banner. The page authorizes, loads
 * and passes the server actions in.
 */
export function HeroBannerManager({
  rows,
  failed,
  intervalSeconds,
  savedMessage,
  errorMessage,
  actions,
}: {
  rows: HeroBannerRow[];
  failed: boolean;
  intervalSeconds: number;
  savedMessage?: string;
  errorMessage?: string;
  actions: HeroBannerActions;
}) {
  // What the home page shows now, in order; switched-off rows are not in it.
  const shownIds = toHeroSlides(rows).map((slide) => slide.id);
  const nextOrder = Math.max(0, ...rows.map((row) => row.sort_order ?? 0)) + 10;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
      {savedMessage ? <AdminSaveToast message={savedMessage} /> : null}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b-2 border-[#111111] pb-5 dark:border-[#f2cf27]">
        <div>
          <h1 className="font-display text-3xl font-black text-foreground">메인 배너 관리</h1>
          <p className="mt-1 max-w-2xl break-keep text-sm font-semibold leading-6 text-muted-foreground">
            메인 페이지 맨 위 배너입니다. 켜 둔 배너가 순서대로 자동으로 넘어가고, 방문자가 화살표나 손가락으로 직접 넘길 수 있습니다.
            한 번에 {HERO_MAX_SLIDES}개까지 표시합니다.
          </p>
        </div>
        <Link
          href="/"
          target="_blank"
          className="inline-flex h-11 items-center rounded-[8px] border-2 border-[#111111] bg-[#f2cf27] px-4 text-sm font-black text-[#111111] shadow-[3px_3px_0_#111111] transition hover:-translate-y-0.5"
        >
          메인 페이지 보기 ↗
        </Link>
      </div>

      {errorMessage ? (
        <p role="alert" className={`mt-5 rounded-[10px] border-2 px-4 py-3 text-sm font-bold ${brandStatusTones.danger}`}>
          저장하지 못했습니다: {errorMessage}
        </p>
      ) : null}
      {failed ? (
        <p role="alert" className={`mt-5 rounded-[10px] border-2 px-4 py-3 text-sm font-bold ${brandStatusTones.danger}`}>
          배너 목록을 불러오지 못했습니다. 메인 페이지에는 기본 배너가 표시되고 있습니다. 잠시 후 새로고침해주세요.
        </p>
      ) : null}

      <section className="mt-6 rounded-[14px] border-2 border-[#111111] bg-card p-4 dark:border-[#f2cf27] sm:p-5">
        <h2 className="text-base font-black text-foreground">자동 넘김 간격</h2>
        <form action={actions.saveInterval} className="mt-3 flex flex-wrap items-end gap-3">
          <label className={labelClass}>
            배너 하나를 보여주는 시간 ({HERO_INTERVAL_MIN}~{HERO_INTERVAL_MAX}초)
            <span className="flex items-center gap-2">
              <input
                name="intervalSeconds"
                type="number"
                min={HERO_INTERVAL_MIN}
                max={HERO_INTERVAL_MAX}
                defaultValue={intervalSeconds}
                className={`${fieldClass} w-24`}
              />
              <span className="text-sm font-bold text-foreground">초</span>
            </span>
          </label>
          <button type="submit" className="h-10 rounded-[8px] border-2 border-[#111111] bg-[#111111] px-5 text-xs font-black text-white transition hover:bg-[#1556a4] dark:border-[#f2cf27] dark:bg-[#f2cf27] dark:text-[#111111]">
            간격 저장
          </button>
          <p className="basis-full text-xs font-semibold text-muted-foreground">
            방문자가 배너에 마우스를 올리거나 멈춤 버튼을 누르면 넘어가지 않습니다.
          </p>
        </form>
      </section>

      <section className="mt-6">
        <h2 className="text-lg font-black text-foreground">등록된 배너 {rows.length}개</h2>
        {!failed && rows.length === 0 ? (
          <p className="mt-3 rounded-[10px] border-2 border-dashed border-border px-4 py-4 text-sm font-semibold text-muted-foreground">
            저장된 배너가 없어 기본 배너 {DEFAULT_HERO_SLIDES.length}개가 표시되고 있습니다. 아래에서 새 배너를 추가하면 그 배너만 표시됩니다.
          </p>
        ) : null}
        <div className="mt-3 space-y-5">
          {rows.map((row) => {
            const position = shownIds.indexOf(row.id);
            return (
              <article key={row.id} className="rounded-[14px] border-2 border-[#111111] bg-card p-4 dark:border-[#f2cf27] sm:p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-[6px] border-2 px-2 py-0.5 text-[11px] font-black ${position >= 0 ? brandStatusTones.success : brandStatusTones.neutral}`}>
                    {position >= 0 ? `메인 ${position + 1}번째 표시 중` : row.is_active ? "표시 한도 밖" : "꺼짐"}
                  </span>
                  <span className="text-sm font-black text-foreground">
                    {isHeroDesign(row.design) ? HERO_DESIGN_OPTIONS[row.design].label : row.design}
                  </span>
                </div>
                <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,540px)_minmax(0,1fr)]">
                  <BannerPreview row={row} />
                  <div>
                    <BannerForm row={row} submitLabel="저장" action={actions.save} />
                    <form action={actions.remove} className="mt-3 flex justify-end">
                      <input type="hidden" name="id" value={row.id} />
                      <ConfirmSubmitButton
                        message="이 배너를 삭제할까요? 메인 페이지에서 바로 빠지며 되돌릴 수 없습니다. 잠시 내리려면 '메인에 표시'를 끄고 저장하세요."
                        className="h-9 rounded-[8px] border-2 border-[#111111] bg-[#d9362c] px-4 text-xs font-black text-white transition hover:bg-[#111111]"
                      >
                        배너 삭제
                      </ConfirmSubmitButton>
                    </form>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="mt-8 rounded-[14px] border-2 border-[#111111] bg-card p-4 dark:border-[#f2cf27] sm:p-5">
        <h2 className="text-lg font-black text-foreground">새 배너 추가</h2>
        <p className="mt-1 break-keep text-sm font-semibold text-muted-foreground">
          준비된 디자인 가운데 하나를 고르고 문구를 넣으면 배너가 만들어집니다. 새 그림이 필요한 배너는 디자인 추가 작업이 필요합니다.
        </p>
        <div className="mt-4 max-w-2xl">
          <BannerForm submitLabel="배너 추가" defaultOrder={nextOrder} action={actions.save} />
        </div>
      </section>
    </div>
  );
}

/** One banner exactly as the home page draws it. */
function BannerPreview({ row }: { row: HeroBannerRow }) {
  const [slide] = toHeroSlides([{ ...row, is_active: true }]);
  if (!slide || slide.id !== row.id) {
    return <p className="rounded-[10px] border-2 border-dashed border-border px-4 py-6 text-sm font-semibold text-muted-foreground">미리보기를 만들 수 없는 배너입니다. 디자인과 헤드카피를 확인해주세요.</p>;
  }
  return (
    <div>
      <HomeHeroBanner slides={[slide]} preview />
      <p className="mt-2 text-xs font-semibold text-muted-foreground">메인 페이지에 보이는 모습 그대로입니다(PC 기준 폭).</p>
    </div>
  );
}

function BannerForm({ row, submitLabel, defaultOrder = 0, action }: { row?: HeroBannerRow; submitLabel: string; defaultOrder?: number; action: FormAction }) {
  return (
    <form action={action} className="space-y-3">
      {row ? <input type="hidden" name="id" value={row.id} /> : null}
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_96px_auto]">
        <label className={labelClass}>
          디자인
          <select name="design" defaultValue={row && isHeroDesign(row.design) ? row.design : "record"} className={fieldClass}>
            {HERO_DESIGNS.map((design) => (
              <option key={design} value={design}>
                {HERO_DESIGN_OPTIONS[design].label}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          순서
          <input name="sortOrder" type="number" min={0} max={9999} defaultValue={row?.sort_order ?? defaultOrder} className={fieldClass} />
        </label>
        <label className="flex items-end gap-2 pb-2 text-sm font-black text-foreground">
          <input type="checkbox" name="isActive" defaultChecked={row?.is_active ?? true} className="h-4 w-4" />
          메인에 표시
        </label>
      </div>
      <p className="text-xs font-semibold leading-5 text-muted-foreground">
        디자인마다 보이는 문구가 다릅니다.{" "}
        {HERO_DESIGNS.map((design) => `${HERO_DESIGN_OPTIONS[design].label.split(" · ")[0]}: ${HERO_DESIGN_OPTIONS[design].shows}`).join(" / ")}
        . 순서 숫자가 작은 배너가 먼저 나옵니다.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          헤드카피 첫째 줄 (필수)
          <input name="headline1" required maxLength={HERO_TEXT_LIMITS.headline} defaultValue={row?.headline_1 ?? ""} className={fieldClass} placeholder="이미 발매된 음원은" />
        </label>
        <label className={labelClass}>
          헤드카피 둘째 줄
          <input name="headline2" maxLength={HERO_TEXT_LIMITS.headline} defaultValue={row?.headline_2 ?? ""} className={fieldClass} placeholder="URL만 입력하면 끝" />
        </label>
        <label className={labelClass}>
          배지 (레코드 디자인)
          <input name="badge" maxLength={HERO_TEXT_LIMITS.badge} defaultValue={row?.badge ?? ""} className={fieldClass} placeholder="Since 2017" />
        </label>
        <label className={labelClass}>
          보조 문구 (심의 필증·브랜드 책장 디자인)
          <input name="body" maxLength={HERO_TEXT_LIMITS.body} defaultValue={row?.body ?? ""} className={fieldClass} placeholder="온라인 심의로 미리 받아두세요" />
        </label>
      </div>
      <label className={labelClass}>
        눌렀을 때 이동할 주소 (비우면 이동 없음)
        <input name="linkUrl" maxLength={HERO_TEXT_LIMITS.link} defaultValue={row?.link_url ?? ""} className={fieldClass} placeholder="/dashboard/new/album 또는 https://..." />
      </label>
      <details className="rounded-[8px] border-2 border-border px-3 py-2">
        <summary className="cursor-pointer text-xs font-black text-foreground">영문 사이트 문구 (비우면 한글 문구가 표시됩니다)</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className={labelClass}>
            영문 헤드카피 첫째 줄
            <input name="headline1En" maxLength={HERO_TEXT_LIMITS.headline} defaultValue={row?.headline_1_en ?? ""} className={fieldClass} />
          </label>
          <label className={labelClass}>
            영문 헤드카피 둘째 줄
            <input name="headline2En" maxLength={HERO_TEXT_LIMITS.headline} defaultValue={row?.headline_2_en ?? ""} className={fieldClass} />
          </label>
          <label className={labelClass}>
            영문 배지
            <input name="badgeEn" maxLength={HERO_TEXT_LIMITS.badge} defaultValue={row?.badge_en ?? ""} className={fieldClass} />
          </label>
          <label className={labelClass}>
            영문 보조 문구
            <input name="bodyEn" maxLength={HERO_TEXT_LIMITS.body * 2} defaultValue={row?.body_en ?? ""} className={fieldClass} />
          </label>
        </div>
      </details>
      <div className="flex justify-end">
        <button type="submit" className="h-10 rounded-[8px] border-2 border-[#111111] bg-[#111111] px-6 text-sm font-black text-white transition hover:bg-[#1556a4] dark:border-[#f2cf27] dark:bg-[#f2cf27] dark:text-[#111111]">
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
