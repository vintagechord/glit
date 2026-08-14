const stripQuotes = (value: string) => value.replace(/^"(.*)"$/, "$1");

const parseFilenameFromDisposition = (disposition: string | null) => {
  if (!disposition) return null;

  const encodedMatch = disposition.match(/filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i);
  if (encodedMatch?.[1]) {
    const encoded = stripQuotes(encodedMatch[1].trim());
    try {
      return decodeURIComponent(encoded);
    } catch {
      return encoded;
    }
  }

  const plainMatch = disposition.match(/filename\s*=\s*("[^"]+"|[^;]+)/i);
  if (plainMatch?.[1]) {
    return stripQuotes(plainMatch[1].trim());
  }

  return null;
};

const readDownloadError = async (response: Response) => {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const json = (await response.json().catch(() => null)) as { error?: string } | null;
    if (json?.error) return json.error;
  }
  const text = await response.text().catch(() => "");
  return text || "파일을 다운로드하지 못했습니다.";
};

export const downloadEndpointFile = async (
  url: string,
  fallbackFilename: string,
  options?: { headers?: HeadersInit },
) => {
  const response = await fetch(url, {
    cache: "no-store",
    headers: options?.headers,
  });
  if (!response.ok) {
    throw new Error(await readDownloadError(response));
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download =
    parseFilenameFromDisposition(response.headers.get("content-disposition")) ||
    fallbackFilename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
};
