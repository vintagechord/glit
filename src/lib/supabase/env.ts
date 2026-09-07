const cleanEnvValue = (value?: string) => {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export class SupabaseConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupabaseConfigurationError";
  }
}

export function validateSupabaseUrl(value: string) {
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error("invalid URL");
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    throw new SupabaseConfigurationError("Supabase URL must be an absolute HTTP(S) URL without credentials, query, or fragment.");
  }
}

export function getSupabaseEnv() {
  const isServer = typeof window === "undefined";
  const url =
    (isServer ? cleanEnvValue(process.env.SUPABASE_URL) : undefined) ??
    cleanEnvValue(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const anonKey =
    (isServer ? cleanEnvValue(process.env.SUPABASE_ANON_KEY) : undefined) ??
    cleanEnvValue(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) ??
    cleanEnvValue(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) ??
    (isServer ? cleanEnvValue(process.env.SUPABASE_PUBLISHABLE_KEY) : undefined);

  if (!url || !anonKey) {
    throw new SupabaseConfigurationError("Missing Supabase environment variables.");
  }

  if (anonKey.startsWith("sb_secret_")) {
    throw new SupabaseConfigurationError("Supabase anonymous key must be a public publishable or anonymous key.");
  }

  return { url: validateSupabaseUrl(url), anonKey };
}

export function getServiceRoleKey() {
  const serviceKey =
    cleanEnvValue(process.env.SUPABASE_SERVICE_ROLE_KEY) ??
    cleanEnvValue(process.env.SUPABASE_SERVICE_KEY) ??
    cleanEnvValue(process.env.SUPABASE_SECRET_KEY);

  if (!serviceKey) {
    throw new SupabaseConfigurationError("Missing SUPABASE_SERVICE_ROLE_KEY.");
  }

  return serviceKey;
}
