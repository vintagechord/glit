import { CompleteSignupView, type CompleteSignupPageProps } from "@/features/auth/complete-signup-view";

export const metadata = { title: { absolute: "Complete signup | Onside" }, robots: { index: false, follow: false } };

export default function EnglishCompleteSignupPage(props: CompleteSignupPageProps) {
  return CompleteSignupView({ ...props, english: true });
}
