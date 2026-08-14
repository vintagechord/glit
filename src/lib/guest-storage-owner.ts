import { createHash } from "node:crypto";

export const getGuestStorageOwnerId = (guestToken: string) =>
  `guest-${createHash("sha256")
    .update(guestToken.trim())
    .digest("hex")
    .slice(0, 32)}`;

export const getStorageLogId = (value: string) =>
  createHash("sha256").update(value).digest("hex").slice(0, 16);
