import { CompleteSignupView, type CompleteSignupPageProps } from "@/features/auth/complete-signup-view";

export const metadata = { title: "회원가입 완료" };

export default function CompleteSignupPage(props: CompleteSignupPageProps) {
  return CompleteSignupView(props);
}
