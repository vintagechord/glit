import { LoginPageView, type LoginPageProps } from "@/features/auth/login-page-view";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "로그인",
  description: "온사이드에 로그인해 심의 신청 내역과 방송국별 결과를 확인하세요.",
  path: "/login",
  enPath: "/en/login",
});

export default function LoginPage(props: LoginPageProps) {
  return LoginPageView(props);
}
