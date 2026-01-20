import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const toHexHash = (algorithm: "sha256" | "sha512", value: string) =>
  createHash(algorithm).update(value, "utf8").digest("hex");

export const sha256 = (value: string) => toHexHash("sha256", value);
export const sha512 = (value: string) => toHexHash("sha512", value);

const normalizeKey = (value: string) => {
  const buf = Buffer.alloc(16);
  Buffer.from(value, "utf8").copy(buf);
  return buf;
};

export const aesEncryptBase64 = (value: string, key: string, iv: string) => {
  const cipher = createCipheriv(
    "aes-128-cbc",
    normalizeKey(key),
    normalizeKey(iv),
  );
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return encrypted.toString("base64");
};

export const aesDecryptBase64 = (value: string, key: string, iv: string) => {
  const decipher = createDecipheriv(
    "aes-128-cbc",
    normalizeKey(key),
    normalizeKey(iv),
  );
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(value, "base64")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
};

const sortObject = (input: Record<string, string | number | undefined>) =>
  Object.keys(input)
    .filter((key) => input[key] !== undefined)
    .sort()
    .reduce<Record<string, string | number>>((acc, key) => {
      acc[key] = input[key] as string | number;
      return acc;
    }, {});

const kvString = (input: Record<string, string | number>) =>
  Object.entries(input)
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

export const makeSignature = (
  fields: Record<string, string | number | undefined>,
) => sha256(kvString(sortObject(fields)));

export const makeStdPaySignature = (params: {
  oid: string;
  price: string | number;
  timestamp: string | number;
}) => makeSignature(params);

export const makeStdPayVerification = (params: {
  oid: string;
  price: string | number;
  timestamp: string | number;
  signKey: string;
}) =>
  sha256(
    kvString({
      oid: params.oid,
      price: params.price,
      signKey: params.signKey,
      timestamp: params.timestamp,
    }),
  );

export const makeMobileHashData = (params: {
  mid: string;
  orderId: string;
  timestamp: string;
  liteKey: string;
}) =>
  sha256(
    [
      params.mid,
      params.orderId,
      params.timestamp,
      params.liteKey,
    ].join(""),
  );

export const makeBillingHashDataV2 = (params: {
  apiKey: string;
  mid: string;
  type: string;
  timestamp: string;
  data: string;
}) => sha512(params.apiKey + params.mid + params.type + params.timestamp + params.data);

export const makeRefundHashDataV2 = makeBillingHashDataV2;

export const makeAuthRequestSignature = (params: {
  authToken: string;
  timestamp: string | number;
}) => makeSignature(params);

export const makeAuthSecureSignature = (params: {
  mid: string;
  tstamp: string | number;
  MOID: string;
  TotPrice: string | number;
  mKey?: string;
  signKey?: string;
}) => {
  const derivedKey =
    params.mKey ??
    (params.signKey ? sha256(params.signKey) : "");
  const normalized = {
    mid: params.mid,
    tstamp: params.tstamp,
    MOID: params.MOID,
    TotPrice: params.TotPrice,
    mKey: derivedKey,
  };
  return sha256(
    Object.entries(normalized)
      .map(([k, v]) => `${k}=${v}`)
      .join("&"),
  );
};

export const makeOrderId = (prefix = "SUB") =>
  `${prefix}-${Date.now()}-${randomBytes(4).toString("hex")}`;

export const getInicisTimestamp = (date = new Date()) => {
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return (
    date.getFullYear().toString() +
    pad(date.getMonth() + 1) +
    pad(date.getDate()) +
    pad(date.getHours()) +
    pad(date.getMinutes()) +
    pad(date.getSeconds())
  );
};
