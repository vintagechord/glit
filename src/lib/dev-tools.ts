const enabledValues = new Set(["1", "true", "yes", "on"]);

const isEnabled = (value?: string | null) =>
  enabledValues.has(String(value ?? "").trim().toLowerCase());

export const areServerDevToolsEnabled = () =>
  process.env.NODE_ENV !== "production" ||
  isEnabled(process.env.INICIS_DEV_TOOLS) ||
  isEnabled(process.env.ENABLE_DEV_TOOLS);

export const arePublicDevPagesEnabled = () =>
  process.env.NODE_ENV !== "production" ||
  isEnabled(process.env.NEXT_PUBLIC_ENABLE_DEV_PAGES);
