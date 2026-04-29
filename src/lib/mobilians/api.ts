import { getMobiliansConfig } from "./config";

type MobiliansAmount = {
  total: string;
  tax?: string;
  tax_free?: string;
  supply_value?: string;
};

export type MobiliansRegistrationRequest = {
  sid: string;
  cash_code: string;
  product_name: string;
  amount: MobiliansAmount;
  trade_id: string;
  site_url: string;
  ok_url: string;
  call_type: "P" | "S" | "I";
  hybrid_pay: "Y" | "N";
  noti_url?: string;
  close_url?: string;
  fail_url?: string;
  user_id?: string;
  user_name?: string;
  user_email?: string;
  only_once?: "Y" | "N";
  time_stamp?: string;
  mstr?: string;
  cp_logo?: "Y" | "N";
  hmac?: string;
};

export type MobiliansRegistrationResponse = {
  code?: string;
  message?: string;
  sid?: string;
  tid?: string;
  pay_url?: string;
  qrcode_url?: string;
  time_stamp?: string;
  hmac?: string;
  [key: string]: unknown;
};

export type MobiliansApprovalRequest = {
  sid: string;
  tid: string;
  cash_code: string;
  product_name?: string;
  amount: string;
  pay_token: string;
};

export type MobiliansApprovalResponse = {
  code?: string;
  message?: string;
  sid?: string;
  tid?: string;
  sign_date?: string;
  trade_id?: string;
  cash_code?: string;
  pay_token?: string;
  product_name?: string;
  amount?: string;
  hmac?: string;
  [key: string]: unknown;
};

const postJson = async <T>(path: string, body: Record<string, unknown>) => {
  const config = getMobiliansConfig();
  const url = new URL(path, config.apiBaseUrl).toString();
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const raw = await response.text();
  const json = raw ? (JSON.parse(raw) as T) : ({} as T);
  if (!response.ok) {
    throw new Error(
      `[Mobilians] ${path} failed with ${response.status}: ${raw.slice(0, 500)}`,
    );
  }
  return json;
};

export const requestMobiliansRegistration = (
  payload: MobiliansRegistrationRequest,
) => postJson<MobiliansRegistrationResponse>("/MUP/api/registration", payload);

export const requestMobiliansApproval = (payload: MobiliansApprovalRequest) =>
  postJson<MobiliansApprovalResponse>("/MUP/api/approval", payload);

export const isMobiliansSuccessCode = (code?: string | null) =>
  String(code ?? "").trim() === "0000";

