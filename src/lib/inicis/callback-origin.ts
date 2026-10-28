import { getBaseUrl } from "@/lib/url";

const legacyPaymentHost = "glit-b1yn.onrender.com";
const legacyPaymentOrigin = "https://glit-b1yn.onrender.com";

/** Preserve the original browser's cookies, storage and popup origin for
 * existing pages during the domain migration. Payment URL builders alone use
 * this fixed-host exception; requests on the new host use the configured origin. */
export function getInicisCallbackBaseUrl(request: Pick<Request, "headers">) {
  return request.headers.get("host")?.toLowerCase() === legacyPaymentHost
    ? legacyPaymentOrigin
    : getBaseUrl(request);
}
