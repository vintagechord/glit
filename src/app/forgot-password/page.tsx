import { ForgotPasswordView } from "./forgot-password-view";
import { pageMetadata } from "@/lib/seo";

// The form is a client component; this server wrapper gives it its own title.
export const metadata = pageMetadata({
  title: "비밀번호 찾기",
  description: "가입한 이메일로 온사이드 비밀번호 재설정 링크를 받으세요.",
  path: "/forgot-password",
  enPath: "/en/forgot-password",
  noindex: true,
});

export default function ForgotPasswordPage() {
  return <ForgotPasswordView />;
}
