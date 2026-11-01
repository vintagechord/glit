import { SignupPageView } from "@/features/auth/signup-page-view";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "회원가입",
  description: "온사이드 회원가입 후 음반 심의와 뮤직비디오 심의를 온라인으로 신청하고 결과를 관리하세요.",
  path: "/signup",
  enPath: "/en/signup",
});

// Static: the query is read in the browser and provider settings refresh each minute.
export const revalidate = 60;

export default function SignupPage() {
  return <SignupPageView />;
}
