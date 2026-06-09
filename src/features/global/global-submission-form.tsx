"use client";

import * as React from "react";
import { ArrowRight, CheckCircle2, Loader2 } from "lucide-react";

import type { GlobalProduct, GlobalProductKey } from "@/lib/global/config";

const disclaimer =
  "Onside provides submission support for Korean broadcast review. Approval, broadcast airplay, programming, playlisting, and royalty collection are not guaranteed.";

type FieldErrors = Record<string, string>;

const inputClass =
  "w-full rounded-[8px] border-2 border-border bg-background px-4 py-3 text-sm font-semibold text-foreground outline-none transition focus:border-[#1556a4]";

const labelClass = "text-xs font-black uppercase tracking-normal text-foreground/75";

function getFormValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export function GlobalSubmissionForm({
  products,
}: {
  products: GlobalProduct[];
}) {
  const [selectedProduct, setSelectedProduct] =
    React.useState<GlobalProductKey>(products[0]?.key ?? "music_review");
  const [busy, setBusy] = React.useState(false);
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [message, setMessage] = React.useState("");

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    setMessage("");

    const formData = new FormData(event.currentTarget);
    const payload = {
      productKey: selectedProduct,
      applicantName: getFormValue(formData, "applicantName"),
      contactEmail: getFormValue(formData, "contactEmail"),
      country: getFormValue(formData, "country"),
      artistName: getFormValue(formData, "artistName"),
      labelName: getFormValue(formData, "labelName"),
      songTitle: getFormValue(formData, "songTitle"),
      albumTitle: getFormValue(formData, "albumTitle"),
      contentType: getFormValue(formData, "contentType"),
      releaseDate: getFormValue(formData, "releaseDate"),
      originalLanguage: getFormValue(formData, "originalLanguage"),
      originalLyrics: getFormValue(formData, "originalLyrics"),
      koreanTranslationStatus: getFormValue(formData, "koreanTranslationStatus"),
      koreanLyricsTranslation: getFormValue(formData, "koreanLyricsTranslation"),
      audioFileLink: getFormValue(formData, "audioFileLink"),
      coverImageLink: getFormValue(formData, "coverImageLink"),
      musicVideoUrl: getFormValue(formData, "musicVideoUrl"),
      rightsHolderName: getFormValue(formData, "rightsHolderName"),
      distributorName: getFormValue(formData, "distributorName"),
      notes: getFormValue(formData, "notes"),
      isrc: getFormValue(formData, "isrc"),
      upc: getFormValue(formData, "upc"),
      spotifyAppleYoutubeUrl: getFormValue(formData, "spotifyAppleYoutubeUrl"),
      koreanPromoter: getFormValue(formData, "koreanPromoter"),
      requestedBroadcaster: getFormValue(formData, "requestedBroadcaster"),
      acceptedDisclaimer: formData.get("acceptedDisclaimer") === "on",
    };

    try {
      const submissionResponse = await fetch("/api/global/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const submissionJson = (await submissionResponse.json().catch(() => null)) as
        | {
            error?: string;
            issues?: Array<{ path?: Array<string | number>; message?: string }>;
            submission?: {
              id: string;
              guestToken?: string;
            };
          }
        | null;

      if (!submissionResponse.ok || !submissionJson?.submission?.id) {
        const nextErrors: FieldErrors = {};
        submissionJson?.issues?.forEach((issue) => {
          const key = issue.path?.[0];
          if (typeof key === "string" && issue.message) {
            nextErrors[key] = issue.message;
          }
        });
        setErrors(nextErrors);
        setMessage(submissionJson?.error ?? "Submission could not be saved.");
        return;
      }

      const paypalResponse = await fetch("/api/paypal/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submissionId: submissionJson.submission.id,
          guestToken: submissionJson.submission.guestToken,
        }),
      });
      const paypalJson = (await paypalResponse.json().catch(() => null)) as
        | { approveUrl?: string; error?: string }
        | null;

      if (!paypalResponse.ok || !paypalJson?.approveUrl) {
        setMessage(
          paypalJson?.error ??
            "Submission was saved, but PayPal checkout is not available yet.",
        );
        return;
      }

      window.location.href = paypalJson.approveUrl;
    } catch {
      setMessage("Submission could not be processed. Please try again later.");
    } finally {
      setBusy(false);
    }
  };

  const renderError = (key: string) =>
    errors[key] ? <p className="mt-1 text-xs font-semibold text-[#d9362c]">{errors[key]}</p> : null;

  return (
    <form onSubmit={submit} className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        {products.map((product) => {
          const active = selectedProduct === product.key;
          return (
            <button
              key={product.key}
              type="button"
              onClick={() => setSelectedProduct(product.key)}
              className={`flex min-h-[220px] flex-col rounded-[10px] border-2 p-5 text-left transition ${
                active
                  ? "border-[#111111] bg-[#f2cf27] text-[#111111] shadow-[6px_6px_0_#111111]"
                  : "border-border bg-card text-foreground hover:border-[#111111] hover:shadow-[4px_4px_0_#111111]"
              }`}
            >
              <span className="text-[11px] font-black uppercase tracking-normal opacity-70">
                PayPal · USD
              </span>
              <span className="mt-3 block text-lg font-black leading-tight">
                {product.title}
              </span>
              <span className="mt-3 text-sm font-semibold leading-6 opacity-80">
                {product.description}
              </span>
              <span className="mt-auto pt-5 text-2xl font-black">
                ${product.amountUsd.toLocaleString("en-US")}
              </span>
            </button>
          );
        })}
      </div>

      <div className="rounded-[10px] border-2 border-[#111111] bg-card p-5 shadow-[5px_5px_0_#111111]">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[#1556a4]" />
          <div>
            <p className="text-sm font-black text-foreground">Required notice</p>
            <p className="mt-1 text-sm font-semibold leading-6 text-muted-foreground">
              {disclaimer}
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 rounded-[10px] border-2 border-border bg-card p-5 md:grid-cols-2">
        {[
          ["applicantName", "Applicant name"],
          ["contactEmail", "Contact email"],
          ["country", "Country"],
          ["artistName", "Artist name"],
          ["labelName", "Label / Company name"],
          ["songTitle", "Song title"],
          ["albumTitle", "Album title"],
          ["releaseDate", "Release date"],
          ["originalLanguage", "Original language"],
          ["rightsHolderName", "Rights holder name"],
          ["distributorName", "Distributor name"],
        ].map(([name, label]) => (
          <label key={name} className="block">
            <span className={labelClass}>{label}</span>
            <input
              name={name}
              type={name === "contactEmail" ? "email" : name === "releaseDate" ? "date" : "text"}
              className={`${inputClass} mt-2`}
            />
            {renderError(name)}
          </label>
        ))}

        <label className="block">
          <span className={labelClass}>Content type</span>
          <select name="contentType" defaultValue="Single" className={`${inputClass} mt-2`}>
            <option>Single</option>
            <option>Album</option>
            <option>Music Video</option>
          </select>
          {renderError("contentType")}
        </label>

        <label className="block">
          <span className={labelClass}>Korean lyric translation</span>
          <select
            name="koreanTranslationStatus"
            defaultValue="needed"
            className={`${inputClass} mt-2`}
          >
            <option value="provided">Provided</option>
            <option value="needed">Needed</option>
            <option value="not_needed">Not needed / instrumental</option>
          </select>
          {renderError("koreanTranslationStatus")}
        </label>

        <label className="block md:col-span-2">
          <span className={labelClass}>Original lyrics</span>
          <textarea name="originalLyrics" rows={6} className={`${inputClass} mt-2`} />
          {renderError("originalLyrics")}
        </label>

        <label className="block md:col-span-2">
          <span className={labelClass}>Korean lyric translation, if available</span>
          <textarea
            name="koreanLyricsTranslation"
            rows={4}
            className={`${inputClass} mt-2`}
          />
        </label>

        {[
          ["audioFileLink", "Audio file link"],
          ["coverImageLink", "Cover image link"],
          ["musicVideoUrl", "Music video URL"],
          ["spotifyAppleYoutubeUrl", "Spotify / Apple Music / YouTube URL"],
          ["isrc", "ISRC"],
          ["upc", "UPC"],
          ["koreanPromoter", "Korean promoter / PR agency"],
          ["requestedBroadcaster", "Requested broadcaster, if any"],
        ].map(([name, label]) => (
          <label key={name} className="block">
            <span className={labelClass}>{label}</span>
            <input name={name} type="text" className={`${inputClass} mt-2`} />
            {renderError(name)}
          </label>
        ))}

        <label className="block md:col-span-2">
          <span className={labelClass}>Notes</span>
          <textarea name="notes" rows={4} className={`${inputClass} mt-2`} />
        </label>
      </div>

      <label className="flex items-start gap-3 rounded-[10px] border-2 border-border bg-background p-4 text-sm font-semibold leading-6 text-muted-foreground">
        <input name="acceptedDisclaimer" type="checkbox" className="mt-1 h-4 w-4" />
        <span>{disclaimer}</span>
      </label>
      {renderError("acceptedDisclaimer")}

      {message ? (
        <div className="rounded-[8px] border-2 border-[#d9362c] bg-[#d9362c]/10 px-4 py-3 text-sm font-semibold text-[#111111]">
          {message}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={busy}
        className="bauhaus-button inline-flex items-center gap-2 px-5 py-3 text-sm uppercase disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        Continue to PayPal
        <ArrowRight size={16} strokeWidth={2.8} />
      </button>
    </form>
  );
}
