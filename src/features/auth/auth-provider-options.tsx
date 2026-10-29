import { Suspense } from "react";
import { SocialAuthButtons, type SocialAuthButtonsProps } from "./social-auth-buttons";
import { emptySocialAvailability } from "./social-contract";
import { getSocialAvailability } from "./social";

type Props = Omit<SocialAuthButtonsProps, "availability" | "loading">;

async function AvailableProviderOptions(props: Props) {
  const availability = await getSocialAvailability();
  return <SocialAuthButtons {...props} availability={availability} />;
}

export function AuthProviderOptions(props: Props) {
  return (
    <Suspense fallback={<SocialAuthButtons {...props} availability={emptySocialAvailability()} loading />}>
      <AvailableProviderOptions {...props} />
    </Suspense>
  );
}
