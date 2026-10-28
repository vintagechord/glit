import { SignupPageView, type SignupPageProps } from "@/features/auth/signup-page-view";

export const metadata = { title: "회원가입" };

export default function SignupPage(props: SignupPageProps) {
  return SignupPageView(props);
}
