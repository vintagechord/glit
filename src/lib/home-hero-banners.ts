/**
 * The home page's main banner is a short carousel. Each banner pairs one of
 * the designs drawn in CSS (the record, the URL field, the certificate, the
 * brand shelf) with
 * copy an administrator can edit under 메인 배너 관리. This module holds the
 * shapes, the built-in set and the checks; it has no server dependencies so
 * the page, the admin form and the tests share it.
 */
export const HERO_DESIGNS = ["record", "url", "certificate", "reasons"] as const;
export type HeroDesign = (typeof HERO_DESIGNS)[number];

/** What an administrator picks from, and which of the text fields each design shows. */
export const HERO_DESIGN_OPTIONS: Record<HeroDesign, { label: string; shows: string; badge: boolean; body: boolean }> = {
  record: { label: "레코드 · 온사이드 소개", shows: "배지, 헤드카피", badge: true, body: false },
  url: { label: "URL 입력창 · 발매 음원 접수", shows: "헤드카피", badge: false, body: false },
  certificate: { label: "심의 필증 · 뮤직비디오", shows: "헤드카피, 보조 문구", badge: false, body: true },
  reasons: { label: "브랜드 책장 · 왜 온사이드", shows: "헤드카피, 보조 문구(버튼 모양)", badge: false, body: true },
};

export const isHeroDesign = (value: unknown): value is HeroDesign =>
  typeof value === "string" && (HERO_DESIGNS as readonly string[]).includes(value);

export const HERO_MAX_SLIDES = 6;
export const HERO_INTERVAL_DEFAULT = 7;
export const HERO_INTERVAL_MIN = 4;
export const HERO_INTERVAL_MAX = 20;
export const HERO_SETTINGS_KEY = "home_hero_carousel";
export const HERO_TEXT_LIMITS = { badge: 24, headline: 40, body: 60, link: 300 } as const;

export type HeroBannerRow = {
  id: string;
  design: string;
  badge: string | null;
  headline_1: string;
  headline_2: string | null;
  body: string | null;
  badge_en: string | null;
  headline_1_en: string | null;
  headline_2_en: string | null;
  body_en: string | null;
  link_url: string | null;
  sort_order: number | null;
  is_active: boolean;
};

export type HeroSlideText = { badge: string | null; headline: [string, string]; body: string | null };
export type HeroSlide = {
  id: string;
  design: HeroDesign;
  ko: HeroSlideText;
  /** English text per field; a null field (or no object) shows the Korean text. */
  en: { badge: string | null; headline: [string, string] | null; body: string | null } | null;
  linkUrl: string | null;
};

/**
 * Shown when nothing is saved yet (and seeded by the migration). The first
 * headline is the owner's from 2026-11-11; the second is the owner's from
 * 2026-11-16; the third states what the owner asked to explain: a music video
 * handed to a distributor needs its certificate, so apply ahead of time. The
 * fourth (owner 2026-11-16) leads to the about page's case for Onside, which
 * few visitors reach from the footer.
 */
export const DEFAULT_HERO_SLIDES: HeroSlide[] = [
  {
    id: "default-record",
    design: "record",
    ko: { badge: "Since 2017", headline: ["음반·뮤직비디오 심의,", "이제 더 간편하게"], body: null },
    en: { badge: null, headline: ["Album & MV Reviews,", "Now Made Simple"], body: null },
    linkUrl: null,
  },
  {
    id: "default-url",
    design: "url",
    ko: { badge: null, headline: ["이미 발매된 음원은", "URL만 입력하면 끝"], body: null },
    en: { badge: null, headline: ["Already released?", "Just paste the URL"], body: null },
    linkUrl: "/dashboard/new/album",
  },
  {
    id: "default-certificate",
    design: "certificate",
    ko: { badge: null, headline: ["뮤직비디오 유통엔", "심의 필증이 필수"], body: "온라인 심의로 미리 받아두세요" },
    en: { badge: null, headline: ["Music videos need a", "rating certificate"], body: "Get it ahead with an online review" },
    linkUrl: "/guide/mv-review",
  },
  {
    id: "default-reasons",
    design: "reasons",
    ko: { badge: null, headline: ["심의 맡길 곳,", "왜 온사이드일까요"], body: "온사이드를 고르는 이유 보기" },
    en: { badge: null, headline: ["Why file your review", "with Onside?"], body: "See the reasons" },
    linkUrl: "/about",
  },
];

const clean = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const orNull = (value: unknown) => clean(value) || null;

/** An internal path or an https address; anything else is not followed. */
export function safeHeroLink(raw: string | null | undefined): string | null {
  const value = clean(raw);
  if (!value || value.length > HERO_TEXT_LIMITS.link || /[\s\\]/.test(value)) return null;
  if (value.startsWith("/")) return value.startsWith("//") ? null : value;
  try {
    return new URL(value).protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

function toSlide(row: HeroBannerRow): HeroSlide | null {
  const headline1 = clean(row.headline_1);
  if (!row.is_active || !isHeroDesign(row.design) || !headline1) return null;
  const headlineEn = clean(row.headline_1_en);
  const en = {
    badge: orNull(row.badge_en),
    headline: headlineEn ? ([headlineEn, clean(row.headline_2_en)] as [string, string]) : null,
    body: orNull(row.body_en),
  };
  return {
    id: row.id,
    design: row.design,
    ko: { badge: orNull(row.badge), headline: [headline1, clean(row.headline_2)], body: orNull(row.body) },
    en: en.badge || en.headline || en.body ? en : null,
    linkUrl: safeHeroLink(row.link_url),
  };
}

/**
 * The banners to show, in order. The page always has one: with nothing saved
 * it is the built-in set, and with everything switched off the brand banner.
 */
export function toHeroSlides(rows: HeroBannerRow[]): HeroSlide[] {
  if (!rows.length) return DEFAULT_HERO_SLIDES;
  const slides = rows
    .map((row, index) => ({ slide: toSlide(row), order: row.sort_order ?? 0, index }))
    .filter((item): item is { slide: HeroSlide; order: number; index: number } => item.slide !== null)
    .sort((a, b) => a.order - b.order || a.index - b.index)
    .slice(0, HERO_MAX_SLIDES)
    .map((item) => item.slide);
  return slides.length ? slides : [DEFAULT_HERO_SLIDES[0]];
}

/** The slide whose headline is the page's h1: the brand banner when shown, else the first. */
export function heroHeadingSlideId(slides: HeroSlide[]): string | null {
  return (slides.find((slide) => slide.design === "record") ?? slides[0])?.id ?? null;
}

const charEm = (char: string) => {
  // Hangul, Chinese characters, kana and full-width forms take a full em.
  if (/[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(char)) return 1;
  const code = char.codePointAt(0) ?? 0;
  if ((code >= 0x3000 && code <= 0x303f) || (code >= 0xff00 && code <= 0xffef)) return 1;
  if (char === " ") return 0.25;
  if (/[.,'’:;!|]/.test(char)) return 0.28;
  if (char === "·") return 0.35;
  if (/[A-Z&%@#]/.test(char)) return 0.68;
  if (/[a-z]/.test(char)) return 0.55;
  return 0.6;
};

/**
 * Roughly how many ems the longer headline line takes at the display weight
 * (tight tracking included). The banner divides its free width by this, so a
 * line never wraps or runs under the graphic whatever an administrator types.
 */
export function estimateHeadlineEm(lines: readonly string[]): number {
  const widths = lines.map((line) => {
    const chars = Array.from(line.trim());
    return chars.reduce((sum, char) => sum + charEm(char), 0) - chars.length * 0.03;
  });
  return Math.round(Math.max(0, ...widths) * 100) / 100;
}

export function normalizeHeroInterval(value: unknown): number {
  const seconds = (value as { intervalSeconds?: unknown } | null | undefined)?.intervalSeconds;
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return HERO_INTERVAL_DEFAULT;
  return Math.min(HERO_INTERVAL_MAX, Math.max(HERO_INTERVAL_MIN, Math.round(seconds)));
}

export type HeroBannerInput = Omit<HeroBannerRow, "id">;

/** Checks one banner from the admin form and shapes it for the table. */
export function normalizeHeroBannerInput(raw: Record<string, unknown>):
  | { ok: true; value: HeroBannerInput }
  | { ok: false; error: string } {
  if (!isHeroDesign(raw.design)) return { ok: false, error: "배너 디자인을 선택해주세요." };
  const headline1 = clean(raw.headline1);
  if (!headline1) return { ok: false, error: "헤드카피 첫째 줄을 입력해주세요." };
  const fields = {
    badge: [clean(raw.badge), HERO_TEXT_LIMITS.badge, "배지"],
    headline_1: [headline1, HERO_TEXT_LIMITS.headline, "헤드카피 첫째 줄"],
    headline_2: [clean(raw.headline2), HERO_TEXT_LIMITS.headline, "헤드카피 둘째 줄"],
    body: [clean(raw.body), HERO_TEXT_LIMITS.body, "보조 문구"],
    badge_en: [clean(raw.badgeEn), HERO_TEXT_LIMITS.badge, "영문 배지"],
    headline_1_en: [clean(raw.headline1En), HERO_TEXT_LIMITS.headline, "영문 헤드카피 첫째 줄"],
    headline_2_en: [clean(raw.headline2En), HERO_TEXT_LIMITS.headline, "영문 헤드카피 둘째 줄"],
    body_en: [clean(raw.bodyEn), HERO_TEXT_LIMITS.body * 2, "영문 보조 문구"],
  } as const;
  for (const [text, limit, label] of Object.values(fields)) {
    if (Array.from(text).length > limit) return { ok: false, error: `${label}은(는) ${limit}자 이내로 입력해주세요.` };
  }
  const linkRaw = clean(raw.linkUrl);
  const link = safeHeroLink(linkRaw);
  if (linkRaw && !link) return { ok: false, error: "링크는 /로 시작하는 사이트 내 주소나 https:// 주소만 쓸 수 있습니다." };
  const order = Number.parseInt(String(raw.sortOrder ?? ""), 10);
  return {
    ok: true,
    value: {
      design: raw.design,
      badge: fields.badge[0] || null,
      headline_1: headline1,
      headline_2: fields.headline_2[0] || null,
      body: fields.body[0] || null,
      badge_en: fields.badge_en[0] || null,
      headline_1_en: fields.headline_1_en[0] || null,
      headline_2_en: fields.headline_2_en[0] || null,
      body_en: fields.body_en[0] || null,
      link_url: link,
      sort_order: Number.isFinite(order) ? Math.min(9999, Math.max(0, order)) : 0,
      is_active: raw.isActive === true,
    },
  };
}
