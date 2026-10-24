#!/usr/bin/env tsx
/**
 * Sends a real email through the selected provider used by app notifications.
 *
 * Usage:
 *   npm run email:smoke -- --to you@example.com
 *   EMAIL_TEST_TO=you@example.com npm run email:smoke
 */

import process from "node:process";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

type EmailModule = {
  sendSubmissionUpdateEmail?: (payload: {
    email: string;
    title: string;
    artist?: string | null;
    kind: "ALBUM" | "MV";
    headline: string;
    summary: string;
    link?: string;
    subject?: string;
  }) => Promise<{
    ok: boolean;
    skipped?: boolean;
    message?: string;
  }>;
  default?: EmailModule;
};

const parseArgValue = (name: string) => {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length).trim();

  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0) return process.argv[index + 1]?.trim() ?? "";
  return "";
};

const maskEmail = (email: string) => {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "[invalid]";
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}***@${domain}`;
};

const main = async () => {
  const to =
    parseArgValue("to") ||
    process.env.EMAIL_TEST_TO?.trim() ||
    process.env.RESEND_TEST_TO?.trim() ||
    "";

  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    throw new Error(
      "Missing valid test recipient. Pass --to you@example.com or set EMAIL_TEST_TO.",
    );
  }

  const { getEmailDeliveryConfiguration } = await import("../src/lib/email-config");
  const config = getEmailDeliveryConfiguration();
  if (!config.ok) throw new Error(config.diagnostic ?? "Email delivery is not configured.");

  const emailModule = (await import("../src/lib/email")) as EmailModule;
  const sendSubmissionUpdateEmail =
    emailModule.sendSubmissionUpdateEmail ??
    emailModule.default?.sendSubmissionUpdateEmail;

  if (!sendSubmissionUpdateEmail) {
    throw new Error("sendSubmissionUpdateEmail export was not found.");
  }

  const now = new Date().toISOString();
  const result = await sendSubmissionUpdateEmail({
    email: to,
    title: "Email smoke test",
    artist: "Onside",
    kind: "ALBUM",
    headline: "Email smoke test",
    summary: `This is a real ${config.provider} smoke test from the app notification path.\nSent at: ${now}`,
    link:
      process.env.NEXT_PUBLIC_SITE_URL ||
      process.env.NEXT_PUBLIC_APP_URL ||
      "https://onside17.com/",
    subject: `[onside] Email smoke test - ${now}`,
  });

  const output = {
    provider: config.provider,
    recipient: maskEmail(to),
    ok: result.ok,
    skipped: result.skipped ?? false,
    message: result.message ?? null,
  };

  console.log(JSON.stringify(output, null, 2));

  if (!result.ok) {
    process.exitCode = 1;
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
