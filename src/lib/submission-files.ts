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
