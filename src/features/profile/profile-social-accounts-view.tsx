import { Suspense } from "react";
import { getSocialAvailability } from "@/features/auth/social";
import { emptySocialAvailability } from "@/features/auth/social-contract";
import { ProfileSocialAccounts, type ProfileSocialAccountsProps } from "./profile-social-accounts";

type Props = Omit<ProfileSocialAccountsProps, "availability" | "loading">;

async function AvailableAccounts(props: Props) {
  const availability = await getSocialAvailability();
  return <ProfileSocialAccounts {...props} availability={availability} />;
}

export function ProfileSocialAccountsView(props: Props) {
  return (
    <Suspense fallback={<ProfileSocialAccounts {...props} availability={emptySocialAvailability()} loading />}>
      <AvailableAccounts {...props} />
    </Suspense>
  );
}
