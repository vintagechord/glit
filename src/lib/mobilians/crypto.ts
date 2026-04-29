import { createHmac, timingSafeEqual } from "node:crypto";

const pad = (value: number) => String(value).padStart(2, "0");

export const getMobiliansTimestamp = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((acc, part) => {
      if (part.type !== "literal") acc[part.type] = part.value;
      return acc;
    }, {});

  const year = parts.year ?? String(date.getFullYear());
  const month = parts.month ?? pad(date.getMonth() + 1);
  const day = parts.day ?? pad(date.getDate());
  const hour = parts.hour ?? pad(date.getHours());
  const minute = parts.minute ?? pad(date.getMinutes());
  const second = parts.second ?? pad(date.getSeconds());
  return `${year}${month}${day}${hour}${minute}${second}`;
};

export const makeMobiliansHmac = (message: string, key: string) =>
  createHmac("sha256", key).update(message, "utf8").digest("base64");

export const buildRegistrationHmacMessage = (params: {
  amount: string | number;
  okUrl: string;
  tradeId: string;
  timeStamp: string;
}) => `${params.amount}${params.okUrl}${params.tradeId}${params.timeStamp}`;

export const makeRegistrationHmac = (
  params: {
    amount: string | number;
    okUrl: string;
    tradeId: string;
    timeStamp: string;
  },
  key: string,
) => makeMobiliansHmac(buildRegistrationHmacMessage(params), key);

export const timingSafeEqualString = (left: string, right: string) => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
};
