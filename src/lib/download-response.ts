const toAsciiFilename = (filename: string) => {
  const normalized = filename
    .replace(/["\\;]/g, "_")
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/_+/g, "_")
    .trim();
  return normalized || "download";
};

export const buildAttachmentDisposition = (filename: string) => {
  const asciiFilename = toAsciiFilename(filename);
  return `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
};

export const buildAttachmentHeaders = (params: {
  filename: string;
  contentType?: string | null;
  contentLength?: string | number | null;
}) => {
  const headers = new Headers();
  headers.set("Content-Type", params.contentType?.trim() || "application/octet-stream");
  headers.set("Content-Disposition", buildAttachmentDisposition(params.filename));
  headers.set("Cache-Control", "private, no-store");
  if (params.contentLength !== undefined && params.contentLength !== null) {
    headers.set("Content-Length", String(params.contentLength));
  }
  return headers;
};

export const createAttachmentResponseFromUrl = async (params: {
  url: string;
  filename: string;
  fallbackContentType?: string;
}) => {
  const fileResponse = await fetch(params.url, { cache: "no-store" });
  if (!fileResponse.ok || !fileResponse.body) {
    throw new Error(`파일을 가져오지 못했습니다. status=${fileResponse.status}`);
  }
  const headers = buildAttachmentHeaders({
    filename: params.filename,
    contentType: fileResponse.headers.get("content-type") || params.fallbackContentType,
    contentLength: fileResponse.headers.get("content-length"),
  });
  return new Response(fileResponse.body, { status: 200, headers });
};
