import {
  buildImageRemotePatterns,
  matchesImageRemotePattern,
  type ImageEnv,
} from "@/lib/image-remote-patterns";

const runtimeImageEnv = (): ImageEnv => ({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  SUPABASE_URL: process.env.SUPABASE_URL,
  B2_S3_ENDPOINT: process.env.B2_S3_ENDPOINT,
  B2_BUCKET: process.env.B2_BUCKET,
});

/**
 * Keep database-configured images inside what next/image optimizes: relative
 * /public paths, or the remote patterns next.config.ts builds from the same
 * environment. A URL outside them would save fine but render broken.
 */
export const isAllowedImageSource = (
  value: string | null | undefined,
  env: ImageEnv = runtimeImageEnv(),
) => {
  const source = value?.trim();
  if (!source) return false;
  if (source.startsWith("/")) return !/^\/[/\\]/.test(source);

  try {
    const parsed = new URL(source);
    return (
      !parsed.username &&
      !parsed.password &&
      matchesImageRemotePattern(buildImageRemotePatterns(env), parsed)
    );
  } catch {
    return false;
  }
};
