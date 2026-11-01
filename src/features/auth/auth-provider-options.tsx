import { unstable_cache } from "next/cache";
import { Suspense } from "react";
import { SocialAuthButtons, type SocialAuthButtonsProps } from "./social-auth-buttons";
import { emptySocialAvailability } from "./social-contract";
import { getSocialAvailability } from "./social";

type Props = Omit<SocialAuthButtonsProps, "availability" | "loading">;

// Sign-in pages are static: only the parsed provider booleans are cached with
// the page (the settings request itself stays uncached) and refresh hourly, so
// a provider switched on in Supabase shows up within the hour.
const getPageSocialAvailability = unstable_cache(getSocialAvailability, ["public-social-availability-v1"], { revalidate: 3600 });

async function AvailableProviderOptions(props: Props) {
  const availability = await getPageSocialAvailability();
  return <SocialAuthButtons {...props} availability={availability} />;
}

export function AuthProviderOptions(props: Props) {
  return (
    <Suspense fallback={<SocialAuthButtons {...props} availability={emptySocialAvailability()} loading />}>
      <AvailableProviderOptions {...props} />
    </Suspense>
  );
}
