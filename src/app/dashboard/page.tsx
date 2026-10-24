import { statusDashboardTabs } from "@/components/dashboard/dashboard-shell";
import { StatusPageView } from "./view";

export const metadata = {
  title: "진행상황",
};

type DashboardPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const firstSearchParamValue = (value?: string | string[]) =>
  Array.isArray(value) ? value[0] : value;

const parseReviewTab = (value?: string | string[]) => {
  const normalized = firstSearchParamValue(value)?.toLowerCase();
  if (!normalized) return undefined;
  if (["mv", "music-video", "musicvideo", "video"].includes(normalized)) {
    return "mv" as const;
  }
  if (["album", "music"].includes(normalized)) {
    return "album" as const;
  }
  return undefined;
};

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const initialReviewTab =
    parseReviewTab(resolvedSearchParams.tab) ??
    parseReviewTab(resolvedSearchParams.type);
  const forceStatusRefresh =
    firstSearchParamValue(resolvedSearchParams.refresh) === "1";

  return StatusPageView({
    tabs: statusDashboardTabs,
    contextLabel: "진행상황",
    initialReviewTab,
    forceStatusRefresh,
  });
}
