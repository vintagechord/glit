import { SignupPageView, type SignupPageProps } from "@/features/auth/signup-page-view";

export const metadata = { title: "Sign up" };

export default function EnglishSignupPage(props: SignupPageProps) {
  return SignupPageView({ ...props, english: true });
}
