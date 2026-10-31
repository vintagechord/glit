import { FormsPageView } from "@/features/support/forms-page-view";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "예전 온사이드 사이트에서 접수하기",
  description: "기존 온사이드 접수 사이트로 이동해 이전 방식으로 심의를 접수할 수 있습니다.",
  path: "/forms",
  enPath: "/en/forms",
});

export default function FormsPage() {
  return <FormsPageView />;
}
