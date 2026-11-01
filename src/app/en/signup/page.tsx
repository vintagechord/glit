import { SignupPageView } from "@/features/auth/signup-page-view";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  locale: "en",
  title: "Sign up",
  description: "Create an Onside account to submit album and music video reviews online.",
  path: "/signup",
  enPath: "/en/signup",
});

// Static: the query is read in the browser and provider settings refresh each minute.
export const revalidate = 3600;

export default function EnglishSignupPage() {
  return <SignupPageView english />;
}
