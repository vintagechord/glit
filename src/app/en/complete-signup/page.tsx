import { CompleteSignupView, type CompleteSignupPageProps } from "@/features/auth/complete-signup-view";

export const metadata = { title: "Complete signup" };

export default function EnglishCompleteSignupPage(props: CompleteSignupPageProps) {
  return CompleteSignupView({ ...props, english: true });
}
