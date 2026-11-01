import { LoginPageView } from "@/features/auth/login-page-view";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  locale: "en",
  title: "Log in",
  description: "Log in to Onside to see your review applications and results.",
  path: "/login",
  enPath: "/en/login",
});

// Static: the query is read in the browser and provider settings refresh each minute.
export const revalidate = 60;

export default function EnglishLoginPage() {
  return <LoginPageView english />;
}
