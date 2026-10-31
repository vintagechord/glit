import { LoginPageView, type LoginPageProps } from "@/features/auth/login-page-view";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  locale: "en",
  title: "Log in",
  description: "Log in to Onside to see your review applications and results.",
  path: "/login",
  enPath: "/en/login",
});

export default function EnglishLoginPage(props: LoginPageProps) {
  return LoginPageView({ ...props, english: true });
}
