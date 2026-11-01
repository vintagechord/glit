"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { AlbumWizard } from "@/features/submissions/album-wizard";

import { ApplicationViewerStatus, useApplicationViewer } from "./application-viewer";

type Props = Omit<React.ComponentProps<typeof AlbumWizard>, "userId" | "userEmail" | "initialApplicant" | "initialArchiveEntry">;

const noSubscription = () => () => {};
const hasArchiveQuery = () => new URLSearchParams(window.location.search).has("archiveLibrary");

/** Album application on the static page; the member flow from My Music has its own server route. */
export function AlbumApplication(props: Props) {
  const router = useRouter();
  const viewer = useApplicationViewer();
  // Older links put the My Music entry on this URL; hand them to /archive.
  const archiveLink = React.useSyncExternalStore(noSubscription, hasArchiveQuery, () => false);
  React.useEffect(() => {
    if (archiveLink) router.replace(`${window.location.pathname.replace(/\/$/, "")}/archive${window.location.search}`);
  }, [archiveLink, router]);

  if (archiveLink || viewer.status === "loading") return <ApplicationViewerStatus state={{ status: "loading", retry: viewer.retry }} />;
  if (viewer.status === "error") return <ApplicationViewerStatus state={viewer} />;
  return (
    <React.Suspense fallback={<ApplicationViewerStatus state={{ status: "loading", retry: viewer.retry }} />}>
      <AlbumWizard
        key={viewer.viewer.userId ?? "guest"}
        {...props}
        userId={viewer.viewer.userId}
        userEmail={viewer.viewer.userEmail}
        initialApplicant={viewer.viewer.applicant}
      />
    </React.Suspense>
  );
}
