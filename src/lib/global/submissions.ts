import { randomUUID } from "node:crypto";

import { z } from "zod";

import type { GlobalProductKey } from "@/lib/global/config";
import { GLOBAL_CURRENCY, getGlobalProduct } from "@/lib/global/config";
import { ensureAlbumStationReviews } from "@/lib/station-reviews";
import { createAdminClient } from "@/lib/supabase/admin";

const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const optionalUrl = z.preprocess(
  emptyToUndefined,
  z.string().url("Enter a valid URL.").optional(),
);

const globalSubmissionBaseSchema = z.object({
  productKey: z.enum([
    "album_review",
    "mv_online_review",
    "mv_broadcast_review",
  ]),
  albumPackageCount: z.preprocess(
    emptyToUndefined,
    z.enum(["7", "10", "13", "15"]).optional(),
  ),
  applicantName: z.string().trim().min(2, "Applicant name is required."),
  contactEmail: z.string().trim().email("Enter a valid email address."),
  country: z.string().trim().min(2, "Country is required."),
  artistName: z.string().trim().min(1, "Artist name is required."),
  labelName: z.string().trim().min(1, "Label / Company name is required."),
  songTitle: z.string().trim().min(1, "Song title is required."),
  albumTitle: z.string().trim().min(1, "Album title is required."),
  contentType: z.enum(["Single", "Album", "Music Video"]),
  releaseDate: z.string().trim().min(1, "Release date is required."),
  originalLanguage: z.string().trim().min(2, "Original language is required."),
  originalLyrics: z.string().trim().min(10, "Original lyrics are required."),
  koreanTranslationStatus: z.enum(["provided", "needed", "not_needed"]),
  koreanLyricsTranslation: z.string().trim().optional(),
  audioFileLink: optionalUrl,
  coverImageLink: optionalUrl,
  musicVideoUrl: optionalUrl,
  rightsHolderName: z.string().trim().min(1, "Rights holder name is required."),
  distributorName: z.string().trim().min(1, "Distributor name is required."),
  notes: z.string().trim().optional(),
  isrc: z.string().trim().optional(),
  upc: z.string().trim().optional(),
  mvDesiredRating: z.string().trim().optional(),
  spotifyAppleYoutubeUrl: optionalUrl,
  koreanPromoter: z.string().trim().optional(),
  requestedBroadcaster: z.string().trim().optional(),
  acceptedDisclaimer: z.literal(true, {
    error: "You must acknowledge the service disclaimer before submitting.",
  }),
});

export const globalSubmissionSchema = globalSubmissionBaseSchema.superRefine(
  (data, ctx) => {
    const isAlbum = data.productKey === "album_review";
    const isMv = !isAlbum;

    if (isAlbum && !data.albumPackageCount) {
      ctx.addIssue({
        code: "custom",
        path: ["albumPackageCount"],
        message: "Select a broadcaster package.",
      });
    }

    if (isAlbum && !data.audioFileLink) {
      ctx.addIssue({
        code: "custom",
        path: ["audioFileLink"],
        message: "Audio file link is required for album review.",
      });
    }

    if (isAlbum && !data.coverImageLink) {
      ctx.addIssue({
        code: "custom",
        path: ["coverImageLink"],
        message: "Cover image link is required for album review.",
      });
    }

    if (isMv && !data.musicVideoUrl && !data.audioFileLink) {
      ctx.addIssue({
        code: "custom",
        path: ["musicVideoUrl"],
        message: "Music video URL or downloadable file link is required.",
      });
    }

    if (isMv && data.contentType !== "Music Video") {
      ctx.addIssue({
        code: "custom",
        path: ["contentType"],
        message: "Music video review must use Music Video content type.",
      });
    }

    if (
      data.productKey === "mv_broadcast_review" &&
      !data.requestedBroadcaster?.trim()
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["requestedBroadcaster"],
        message: "Requested broadcaster is required for TV broadcast review.",
      });
    }
  },
);

export type GlobalSubmissionInput = z.infer<typeof globalSubmissionSchema>;

const extractMissingColumn = (error: { message?: string | null }) => {
  const message = error.message ?? "";
  const match =
    message.match(/'([^']+)' column/) ??
    message.match(/column "([^"]+)"/i) ??
    message.match(/Could not find the '([^']+)'/i);
  return match?.[1] ?? null;
};

const stripColumn = (
  payload: Record<string, unknown>,
  column: string,
) => {
  const next = { ...payload };
  delete next[column];
  return next;
};

const insertSubmissionWithFallback = async (
  payload: Record<string, unknown>,
) => {
  const admin = createAdminClient();
  let currentPayload = { ...payload };
  const removed = new Set<string>();
  let usedLegacyPaymentMethodFallback = false;
  let lastError: { code?: string; message?: string } | null = null;
  const maxAttempts = Math.max(Object.keys(currentPayload).length + 4, 16);

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const { data, error } = await admin
      .from("submissions")
      .insert(currentPayload)
      .select("id, guest_token")
      .maybeSingle();

    if (!error) {
      return { data, error: null };
    }

    lastError = error;

    if (error.code === "PGRST204" || error.code === "42703") {
      const missing = extractMissingColumn(error);
      if (missing && missing in currentPayload && !removed.has(missing)) {
        removed.add(missing);
        currentPayload = stripColumn(currentPayload, missing);
        continue;
      }
    }

    if (
      error.code === "22P02" &&
      String(currentPayload.payment_method ?? "") === "PAYPAL" &&
      !usedLegacyPaymentMethodFallback
    ) {
      usedLegacyPaymentMethodFallback = true;
      currentPayload = {
        ...currentPayload,
        payment_method: "CARD",
      };
      continue;
    }

    return { data: null, error };
  }

  return {
    data: null,
    error: lastError ?? { message: "English submission insert failed." },
  };
};

const buildGuestToken = () =>
  `GLOBAL-${randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase()}`;

const toSubmissionType = (productKey: GlobalProductKey) => {
  const product = getGlobalProduct(productKey);
  return product?.submissionType ?? "ALBUM";
};

const resolveAlbumPackage = async (stationCountValue?: string) => {
  if (!stationCountValue) return null;
  const stationCount = Number(stationCountValue);
  if (!Number.isFinite(stationCount)) return null;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("packages")
    .select("id, name, station_count")
    .eq("station_count", stationCount)
    .eq("is_active", true)
    .order("price_krw", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[GlobalSubmission] package lookup failed", error);
    return null;
  }

  return data
    ? {
        id: data.id as string,
        name: (data.name as string | null) ?? null,
        stationCount: (data.station_count as number | null) ?? stationCount,
      }
    : null;
};

export const createGlobalSubmission = async (input: unknown) => {
  const parsed = globalSubmissionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: "Please check the required fields.",
      issues: parsed.error.issues,
      submission: null,
    };
  }

  const data = parsed.data;
  const product = getGlobalProduct(data.productKey);
  if (!product) {
    return {
      error: "Selected product is not available.",
      issues: [],
      submission: null,
    };
  }

  const now = new Date().toISOString();
  const guestToken = buildGuestToken();
  const translationRequired = data.koreanTranslationStatus === "needed";
  const submissionType = toSubmissionType(data.productKey);
  const isAlbum = submissionType === "ALBUM";
  const albumPackage = isAlbum
    ? await resolveAlbumPackage(data.albumPackageCount)
    : null;

  if (isAlbum && !albumPackage) {
    return {
      error: "Selected broadcaster package is not available.",
      issues: [],
      submission: null,
    };
  }

  const payload = {
    user_id: null,
    type: submissionType,
    title: data.songTitle,
    artist_name: data.artistName,
    artist_name_en: data.artistName,
    release_date: data.releaseDate,
    applicant_name: data.applicantName,
    applicant_email: data.contactEmail,
    guest_name: data.applicantName,
    guest_company: data.labelName,
    guest_email: data.contactEmail,
    guest_token: guestToken,
    package_id: albumPackage?.id ?? null,
    amount_krw: 0,
    payment_method: "PAYPAL",
    payment_status: "PAYMENT_PENDING",
    status: "WAITING_PAYMENT",
    locale: "en",
    applicant_country: data.country,
    original_language: data.originalLanguage,
    payment_provider: "paypal",
    payment_currency: GLOBAL_CURRENCY,
    payment_amount: product.amountUsd,
    content_type: isAlbum ? data.contentType : "Music Video",
    translation_required: translationRequired,
    created_from: "global",
    original_lyrics: data.originalLyrics,
    korean_lyrics_translation: data.koreanLyricsTranslation ?? null,
    audio_file_link: data.audioFileLink ?? null,
    cover_image_link: data.coverImageLink ?? null,
    music_video_url: data.musicVideoUrl ?? null,
    rights_holder_name: data.rightsHolderName,
    distributor: data.distributorName,
    requested_broadcaster: data.requestedBroadcaster ?? null,
    korean_promoter: data.koreanPromoter ?? null,
    isrc: data.isrc ?? null,
    upc: data.upc ?? null,
    mv_album_title: submissionType.startsWith("MV") ? data.albumTitle : null,
    mv_song_title: submissionType.startsWith("MV") ? data.songTitle : null,
    mv_song_title_en: submissionType.startsWith("MV") ? data.songTitle : null,
    mv_distribution_company: submissionType.startsWith("MV")
      ? data.distributorName
      : null,
    mv_desired_rating: submissionType.startsWith("MV")
      ? data.mvDesiredRating ?? null
      : null,
    mv_usage:
      submissionType === "MV_BROADCAST"
        ? "TV broadcast review"
        : submissionType === "MV_DISTRIBUTION"
          ? "Distributor / online upload review"
          : null,
    global_form: {
      process: "onside_english_mirror",
      productKey: data.productKey,
      productTitle: product.title,
      productAmount: product.amountUsd,
      currency: GLOBAL_CURRENCY,
      submissionType,
      contentType: isAlbum ? data.contentType : "Music Video",
      albumPackageCount: data.albumPackageCount ?? null,
      packageId: albumPackage?.id ?? null,
      packageName: albumPackage?.name ?? null,
      labelName: data.labelName,
      albumTitle: data.albumTitle,
      originalLanguage: data.originalLanguage,
      koreanTranslationStatus: data.koreanTranslationStatus,
      audioFileLink: data.audioFileLink ?? null,
      coverImageLink: data.coverImageLink ?? null,
      musicVideoUrl: data.musicVideoUrl ?? null,
      rightsHolderName: data.rightsHolderName,
      distributorName: data.distributorName,
      mvDesiredRating: data.mvDesiredRating ?? null,
      isrc: data.isrc ?? null,
      upc: data.upc ?? null,
      spotifyAppleYoutubeUrl: data.spotifyAppleYoutubeUrl ?? null,
      requestedBroadcaster: data.requestedBroadcaster ?? null,
      koreanPromoter: data.koreanPromoter ?? null,
      notes: data.notes ?? null,
      acceptedDisclaimer: data.acceptedDisclaimer,
      receivedAt: now,
    },
  };

  const { data: row, error } = await insertSubmissionWithFallback(payload);

  if (error || !row?.id) {
    console.error("[GlobalSubmission] insert failed", error);
    return {
      error: "We could not save your submission. Please try again later.",
      issues: [],
      submission: null,
    };
  }

  const admin = createAdminClient();
  if (submissionType === "ALBUM" && albumPackage) {
    await ensureAlbumStationReviews(
      admin,
      row.id as string,
      albumPackage.stationCount,
      albumPackage.name,
    );
  }

  await admin.from("submission_events").insert({
    submission_id: row.id,
    event_type: "ENGLISH_SUBMISSION_RECEIVED",
    message:
      "English Korean broadcast review submission received. PayPal payment is pending.",
  });

  return {
    error: null,
    issues: [],
    submission: {
      id: row.id as string,
      guestToken: (row.guest_token as string | null) ?? guestToken,
      productTitle: product.title,
      amount: product.amountUsd,
      currency: GLOBAL_CURRENCY,
    },
  };
};
