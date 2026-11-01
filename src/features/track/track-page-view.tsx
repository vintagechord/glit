import { TrackModeSwitch } from "@/features/track/track-mode-switch";

export type TrackPageProps = {
  searchParams?: Promise<{ mode?: string | string[] }>;
};

/** Static lookup page; members are sent to their dashboard by the proxy. */
export function TrackPageView() {
  return (
    <div className="page-centered mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
      <TrackModeSwitch />
    </div>
  );
}
