"use client";

import * as React from "react";

import { MvWizard } from "@/features/submissions/mv-wizard";

import { ApplicationViewerStatus, useApplicationViewer } from "./application-viewer";

type Props = Omit<React.ComponentProps<typeof MvWizard>, "userId" | "userEmail">;

/** Music video application on the static page; the viewer is resolved in the browser. */
export function MvApplication(props: Props) {
  const viewer = useApplicationViewer();
  if (viewer.status === "loading") return <ApplicationViewerStatus state={viewer} />;
  if (viewer.status === "error") return <ApplicationViewerStatus state={viewer} />;
  return (
    <React.Suspense fallback={<ApplicationViewerStatus state={{ status: "loading", retry: viewer.retry }} />}>
      <MvWizard key={viewer.viewer.userId ?? "guest"} {...props} userId={viewer.viewer.userId} userEmail={viewer.viewer.userEmail} />
    </React.Suspense>
  );
}
