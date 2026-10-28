import { LoginPageView, type LoginPageProps } from "@/features/auth/login-page-view";

export const metadata = { title: "Log in" };

export default function EnglishLoginPage(props: LoginPageProps) {
  return LoginPageView({ ...props, english: true });
}
