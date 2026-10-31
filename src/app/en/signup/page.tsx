import { SignupPageView, type SignupPageProps } from "@/features/auth/signup-page-view";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  locale: "en",
  title: "Sign up",
  description: "Create an Onside account to submit album and music video reviews online.",
  path: "/signup",
  enPath: "/en/signup",
});

export default function EnglishSignupPage(props: SignupPageProps) {
  return SignupPageView({ ...props, english: true });
}
