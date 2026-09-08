export const albumApplicationForms = [
  {
    label: "HWP",
    href: "/forms/Onside_music_application_hangul_form.hwp",
    downloadName: "Onside_music_application_form.hwp",
  },
  {
    label: "Word",
    href: "/forms/Onside_music_application_word_form.doc",
    downloadName: "Onside_music_application_form.doc",
  },
];

export const mvApplicationForms = [
  {
    label: "HWP",
    href: "/forms/Onside_MVapplication_hangul_form.hwp",
    downloadName: "Onside_MV_application_form.hwp",
  },
  {
    label: "Word",
    href: "/forms/Onside_MVapplication_word_form.doc",
    downloadName: "Onside_MV_application_form.doc",
  },
];

export const applicationFormUploadPattern = /\.(hwp|doc|docx)$/i;
export const audioUploadPattern = /\.(wav|mp3|zip)$/i;
export const videoUploadPattern = /\.(mp4|mov|wmv|mpg|mpeg|m4v)$/i;

export const isApplicationFormFile = (filename?: string | null) =>
  applicationFormUploadPattern.test(filename ?? "");

export const isAudioUploadFile = (
  filename?: string | null,
  mimeType?: string | null,
) => {
  const mime = (mimeType ?? "").toLowerCase();
  return (
    audioUploadPattern.test(filename ?? "") ||
    mime === "audio/mpeg" ||
    mime === "audio/mp3" ||
    mime === "audio/wav" ||
    mime === "audio/x-wav" ||
    mime === "application/zip" ||
    mime === "application/x-zip-compressed"
  );
};

/** URL reception replaces only the application form; the uploaded master is WAV or ZIP. */
export const isReleasedAlbumAudioFile = (
  filename?: string | null,
  mimeType?: string | null,
) => {
  const name = (filename ?? "").trim();
  const mime = (mimeType ?? "").split(";", 1)[0].trim().toLowerCase();
  const extension = name.match(/\.([a-z0-9]+)$/i)?.[1].toLowerCase();
  const genericMime = !mime || mime === "application/octet-stream";
  const wavMime = ["audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave"].includes(mime);
  const zipMime = ["application/zip", "application/x-zip-compressed", "application/x-zip"].includes(mime);
  if (extension === "wav") return genericMime || wavMime;
  if (extension === "zip") return genericMime || zipMime;
  if (extension) return false;
  // Older stored metadata can lack the original filename, but not the format.
  return wavMime || zipMime;
};

export type StoredReleasedAlbumAudioFile = {
  original_name?: string | null;
  mime?: string | null;
  status?: string | null;
  file_path?: string | null;
  object_key?: string | null;
  size?: number | null;
};

export const isStoredReleasedAlbumAudioFile = (file: StoredReleasedAlbumAudioFile) =>
  (file.status == null || file.status === "UPLOADED") &&
  Boolean((file.object_key || file.file_path)?.trim()) &&
  (file.size == null || (Number.isFinite(Number(file.size)) && Number(file.size) > 0)) &&
  isReleasedAlbumAudioFile(file.original_name, file.mime);

export const isVideoUploadFile = (
  filename?: string | null,
  mimeType?: string | null,
) => {
  const mime = (mimeType ?? "").toLowerCase();
  return videoUploadPattern.test(filename ?? "") || mime.startsWith("video/");
};

export const isApplicationFormMime = (mimeType?: string | null) => {
  const mime = (mimeType ?? "").toLowerCase();
  return (
    mime === "application/msword" ||
    mime ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mime === "application/x-hwp" ||
    mime === "application/haansofthwp" ||
    mime === "application/vnd.hancom.hwp"
  );
};
