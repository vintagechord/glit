import { presignGetUrl } from "@/lib/b2";
import { buildUrl, getBaseUrl } from "@/lib/url";

export const MV_RATING_IMAGE_SETTING_KEY = "mv_rating_images";

export type RatingCode = "ALL" | "12" | "15" | "18" | "19" | "REJECT";

export const MANAGED_RATING_IMAGE_CODES = ["ALL", "12", "15", "19"] as const;

export const RATING_LABELS: Record<RatingCode, string> = {
  ALL: "전체관람가",
  "12": "12세이상관람가",
  "15": "15세이상관람가",
  "18": "청소년관람불가",
  "19": "청소년관람불가",
  REJECT: "심의불가",
};

const DEFAULT_RATING_MAP: Record<RatingCode, string> = {
  ALL: "/media/mv-ratings/all.png",
  "12": "/media/mv-ratings/12.png",
  "15": "/media/mv-ratings/15.png",
  "18": "/media/mv-ratings/19.png",
  "19": "/media/mv-ratings/19.png",
  REJECT: "/media/mv-ratings/19.png",
};

const getEnvKey = (name: string, fallback: string) =>
  process.env[name]?.trim() || fallback;

export const RATING_IMAGE_MAP: Record<RatingCode, string> = {
  ALL: getEnvKey("MV_RATING_IMAGE_ALL_KEY", DEFAULT_RATING_MAP.ALL),
  "12": getEnvKey("MV_RATING_IMAGE_12_KEY", DEFAULT_RATING_MAP["12"]),
  "15": getEnvKey("MV_RATING_IMAGE_15_KEY", DEFAULT_RATING_MAP["15"]),
  "18": getEnvKey("MV_RATING_IMAGE_18_KEY", DEFAULT_RATING_MAP["18"]),
  "19": getEnvKey("MV_RATING_IMAGE_19_KEY", DEFAULT_RATING_MAP["19"]),
  REJECT: getEnvKey("MV_RATING_IMAGE_REJECT_KEY", DEFAULT_RATING_MAP.REJECT),
};

export const LABEL_GUIDE_KEY = getEnvKey(
  "MV_LABEL_GUIDE_KEY",
  "https://rwysjsmxtpuqekeltwxi.supabase.co/storage/v1/object/public/mv/mv_guide.pdf",
);

export type ManagedRatingImageCode = (typeof MANAGED_RATING_IMAGE_CODES)[number];

export type MvRatingImageSetting = {
  objectKey: string;
  originalName?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  updatedAt?: string | null;
};

export type MvRatingImageSettings = {
  images: Partial<Record<ManagedRatingImageCode, MvRatingImageSetting>>;
};

type SettingsClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        maybeSingle: () => PromiseLike<{
          data?: { value?: unknown } | null;
          error?: { code?: string; message?: string } | null;
        }>;
      };
    };
  };
};

const isHttpUrl = (value: string) => /^https?:\/\//i.test(value);
const isPublicPath = (value: string) => value.startsWith("/");

const isManagedRatingImageCode = (value: unknown): value is ManagedRatingImageCode =>
  value === "ALL" || value === "12" || value === "15" || value === "19";

export const toManagedRatingImageCode = (
  rating: RatingCode | null | undefined,
): ManagedRatingImageCode | null => {
  if (!rating) return null;
  if (isManagedRatingImageCode(rating)) return rating;
  if (rating === "18" || rating === "REJECT") return "19";
  return null;
};

export const isRatingCode = (value: unknown): value is RatingCode =>
  value === "ALL" ||
  value === "12" ||
  value === "15" ||
  value === "18" ||
  value === "19" ||
  value === "REJECT";

export const parseMvRatingImageSettings = (value: unknown): MvRatingImageSettings => {
  const images: MvRatingImageSettings["images"] = {};
  const rawImages =
    value && typeof value === "object" && "images" in value
      ? (value as { images?: unknown }).images
      : value;

  if (rawImages && typeof rawImages === "object") {
    for (const code of MANAGED_RATING_IMAGE_CODES) {
      const entry = (rawImages as Record<string, unknown>)[code];
      if (!entry || typeof entry !== "object") continue;
      const objectKey = (entry as { objectKey?: unknown }).objectKey;
      if (typeof objectKey !== "string" || !objectKey.trim()) continue;
      const originalName = (entry as { originalName?: unknown }).originalName;
      const mimeType = (entry as { mimeType?: unknown }).mimeType;
      const sizeBytes = (entry as { sizeBytes?: unknown }).sizeBytes;
      const updatedAt = (entry as { updatedAt?: unknown }).updatedAt;
      images[code] = {
        objectKey: objectKey.trim(),
        originalName: typeof originalName === "string" ? originalName : null,
        mimeType: typeof mimeType === "string" ? mimeType : null,
        sizeBytes: typeof sizeBytes === "number" ? sizeBytes : null,
        updatedAt: typeof updatedAt === "string" ? updatedAt : null,
      };
    }
  }

  return { images };
};

export const getMvRatingImageSettings = async (
  db: unknown,
): Promise<MvRatingImageSettings> => {
  const settingsDb = db as SettingsClient;
  const { data, error } = await settingsDb
    .from("site_settings")
    .select("value")
    .eq("key", MV_RATING_IMAGE_SETTING_KEY)
    .maybeSingle();

  if (error) {
    if (error.code !== "42P01" && error.code !== "PGRST205") {
      console.warn("[mv-assets] failed to load rating image settings", error);
    }
    return { images: {} };
  }

  return parseMvRatingImageSettings(data?.value);
};

export const getRatingObjectKey = (rating: RatingCode | null | undefined) =>
  rating ? RATING_IMAGE_MAP[rating] ?? null : null;

export const resolveRatingImageSource = async (
  rating: RatingCode,
  db?: unknown,
) => {
  const managedCode = toManagedRatingImageCode(rating);
  const settings = db && managedCode ? await getMvRatingImageSettings(db) : null;
  const custom = managedCode ? settings?.images[managedCode] ?? null : null;
  const source = custom?.objectKey || RATING_IMAGE_MAP[rating];
  return {
    rating,
    managedCode,
    source,
    isCustom: Boolean(custom?.objectKey),
    originalName: custom?.originalName ?? null,
    mimeType: custom?.mimeType ?? null,
    sizeBytes: custom?.sizeBytes ?? null,
    updatedAt: custom?.updatedAt ?? null,
  };
};

export const resolveRatingImageUrl = async (params: {
  rating: RatingCode;
  db?: unknown;
  baseUrl?: string;
}) => {
  const asset = await resolveRatingImageSource(params.rating, params.db);
  if (isHttpUrl(asset.source)) return { ...asset, url: asset.source };
  if (isPublicPath(asset.source)) {
    return {
      ...asset,
      url: buildUrl(asset.source, params.baseUrl ?? getBaseUrl()),
    };
  }
  return {
    ...asset,
    url: await presignGetUrl(asset.source, 60 * 10),
  };
};

export const getRatingSignedUrl = async (
  rating: RatingCode,
  db?: unknown,
  baseUrl?: string,
) => {
  const asset = await resolveRatingImageUrl({ rating, db, baseUrl });
  return asset.url;
};

export const getGuideSignedUrl = async () =>
  isHttpUrl(LABEL_GUIDE_KEY) ? LABEL_GUIDE_KEY : presignGetUrl(LABEL_GUIDE_KEY);
