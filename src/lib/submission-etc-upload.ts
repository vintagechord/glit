"use client";

import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import { SERVER_UPLOAD_MAX_BYTES } from "@/lib/server-upload-limit";
import { watchUploadProgress } from "@/lib/upload-watchdog";

export type SubmissionEtcUploadResult = {
  path: string;
  originalName: string;
  mime?: string;
  size: number;
  accessUrl?: string;
};

type UploadEtcFileOptions = {
  file: File;
  submissionId: string;
  guestToken?: string;
  title?: string;
  onProgress?: (percent: number) => void;
};

export const businessRegistrationFilePattern = /\.(pdf|jpg|jpeg|png|webp)$/i;

export const isBusinessRegistrationFile = (
  filename?: string | null,
  mimeType?: string | null,
) => {
  const mime = (mimeType ?? "").toLowerCase();
  return (
    businessRegistrationFilePattern.test(filename ?? "") ||
    mime === "application/pdf" ||
    mime === "image/jpeg" ||
    mime === "image/png" ||
    mime === "image/webp"
  );
};

export const uploadSubmissionEtcFile = async ({
  file,
  submissionId,
  guestToken,
  title,
  onProgress,
}: UploadEtcFileOptions): Promise<SubmissionEtcUploadResult> => {
  const mimeType = file.type || "application/octet-stream";

  const uploadThroughServer = () => {
    const formData = new FormData();
    formData.append("submissionId", submissionId);
    formData.append("filename", file.name);
    formData.append("mimeType", mimeType);
    formData.append("sizeBytes", String(file.size));
    if (guestToken) formData.append("guestToken", guestToken);
    if (title?.trim()) formData.append("title", title.trim());
    formData.append("file", file);

    return new Promise<{ objectKey: string }>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      watchUploadProgress(xhr, reject);
      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return;
        onProgress?.(Math.round((event.loaded / event.total) * 100));
      };
      xhr.onload = () => {
        let json: { objectKey?: string; error?: string } | null = null;
        try {
          json = JSON.parse(xhr.responseText) as {
            objectKey?: string;
            error?: string;
          };
        } catch {
          json = null;
        }
        if (xhr.status >= 200 && xhr.status < 300 && json?.objectKey) {
          resolve({ objectKey: json.objectKey });
          return;
        }
        reject(new Error(json?.error || `Upload failed (status ${xhr.status})`));
      };
      xhr.onerror = () => reject(new Error("Upload failed (network/CORS)"));
      xhr.open("POST", "/api/uploads/direct");
      xhr.send(formData);
    });
  };

  // Send the file straight to B2; the app server only signs the request.
  const uploadWithPresignedUrl = async () => {
    const initRes = await fetchWithTimeout("/api/uploads/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        submissionId,
        kind: "etc",
        filename: file.name,
        mimeType,
        sizeBytes: file.size,
        guestToken: guestToken || undefined,
        title: title?.trim() || undefined,
      }),
    });
    const initJson = (await initRes.json().catch(() => ({}))) as {
      key?: string;
      uploadUrl?: string;
      headers?: Record<string, string>;
      error?: string;
    };
    if (!initRes.ok || !initJson.key || !initJson.uploadUrl) {
      throw Object.assign(new Error(initJson.error || "업로드 URL을 생성할 수 없습니다."), {
        retryable: initRes.status >= 500,
      });
    }
    const { key, uploadUrl } = initJson;
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      watchUploadProgress(xhr, reject);
      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return;
        onProgress?.(Math.round((event.loaded / event.total) * 100));
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(Object.assign(new Error(`Upload failed (status ${xhr.status})`), { retryable: true }));
      };
      xhr.onerror = () => reject(Object.assign(new Error("Upload failed (network/CORS)"), { retryable: true }));
      xhr.open("PUT", uploadUrl);
      xhr.setRequestHeader("Content-Type", initJson.headers?.["Content-Type"] || mimeType);
      xhr.send(file);
    });
    return { objectKey: key };
  };

  let directUpload: { objectKey: string };
  try {
    directUpload = await uploadWithPresignedUrl();
  } catch (error) {
    const retryable = (error as { retryable?: boolean }).retryable === true;
    // Small files may still stream through the app server when B2 is unreachable.
    if (!retryable || file.size > SERVER_UPLOAD_MAX_BYTES) throw error;
    console.warn("[Upload][etc] presigned upload failed, fallback to direct", error);
    directUpload = await uploadThroughServer();
  }

  const completeRes = await fetchWithTimeout("/api/uploads/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      submissionId,
      kind: "ETC",
      key: directUpload.objectKey,
      filename: file.name,
      mimeType,
      sizeBytes: file.size,
      purpose: "PAYMENT_DOCUMENT",
      guestToken,
    }),
  });
  const completeJson = (await completeRes.json().catch(() => ({}))) as {
    key?: string;
    accessUrl?: string;
    error?: string;
  };
  if (!completeRes.ok || !completeJson.key) {
    throw new Error(completeJson.error || "업로드 확인에 실패했습니다.");
  }

  return {
    path: completeJson.key,
    originalName: file.name,
    mime: mimeType,
    size: file.size,
    accessUrl: completeJson.accessUrl,
  };
};
