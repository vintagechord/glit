import { SubmissionDetailPageView } from "@/app/dashboard/submissions/[id]/view";

export const dynamic = "force-dynamic";
export const revalidate = 0;
// Member-only result popup: English tab title, never indexed.
export const metadata = {
  title: { absolute: "Review Results | Onside" },
  robots: { index: false, follow: false },
};

// Render the shared view with the /en prefix so its links stay in English.
export default function EnglishArchiveSubmissionResultPage({ params }: { params: Promise<{ id: string }> }) {
  return SubmissionDetailPageView({
    params,
    searchParams: Promise.resolve({ view: "archive-result" }),
    localePrefix: "/en",
  });
}
