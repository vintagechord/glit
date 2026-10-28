import { LoginPageView, type LoginPageProps } from "@/features/auth/login-page-view";

export const metadata = { title: "로그인" };

export default function LoginPage(props: LoginPageProps) {
  return LoginPageView(props);
}
