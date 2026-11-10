"use client";

import { Pause, Play } from "lucide-react";
import * as React from "react";

const reducedMotionQuery = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void) {
  const query = window.matchMedia(reducedMotionQuery);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function isKeyboardFocus(element: Element) {
  try {
    return element.matches(":focus-visible");
  } catch {
    return true;
  }
}

type RotationChoice = "play" | "pause" | null;

/** The visitor's own choice wins; until they make one, reduced motion means paused. */
export function bannerRotationState({ count, choice, reducedMotion, hovered }: {
  count: number;
  choice: RotationChoice;
  reducedMotion: boolean;
  hovered: boolean;
}) {
  const playing = choice ? choice === "play" : !reducedMotion;
  return { playing, rotating: count > 1 && playing && !hovered };
}

/**
 * Banner carousel state that meets WCAG 2.2.2. Rotation holds while a mouse
 * is over the banner, stops when keyboard focus enters it, does not start for
 * visitors who prefer reduced motion, and the toggle pauses or resumes it.
 */
export function useBannerRotation(count: number, intervalMs: number) {
  const [index, setIndex] = React.useState(0);
  const [choice, setChoice] = React.useState<RotationChoice>(null);
  const [hovered, setHovered] = React.useState(false);
  const reducedMotion = React.useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(reducedMotionQuery).matches,
    () => false,
  );
  const { playing, rotating } = bannerRotationState({ count, choice, reducedMotion, hovered });

  React.useEffect(() => {
    setIndex(0);
  }, [count]);

  // Restarts after every change, so a manual step gets a full interval too.
  React.useEffect(() => {
    if (!rotating) return;
    const timer = window.setTimeout(() => {
      setIndex((prev) => (prev + 1) % count);
    }, intervalMs);
    return () => window.clearTimeout(timer);
  }, [rotating, index, count, intervalMs]);

  const goTo = React.useCallback(
    (nextIndex: number) => {
      if (!count) return;
      setIndex((nextIndex + count) % count);
    },
    [count],
  );

  const regionProps = {
    onPointerEnter: (event: React.PointerEvent<HTMLElement>) => {
      if (event.pointerType === "mouse") setHovered(true);
    },
    onPointerLeave: () => setHovered(false),
    // Stays stopped until the visitor resumes it with the toggle.
    onFocus: (event: React.FocusEvent<HTMLElement>) => {
      const entered = !event.currentTarget.contains(event.relatedTarget as Node | null);
      if (entered && isKeyboardFocus(event.target)) setChoice("pause");
    },
  };

  return {
    index,
    goTo,
    playing,
    rotating,
    togglePlaying: () => setChoice(playing ? "pause" : "play"),
    regionProps,
  };
}

export function BannerRotationToggle({
  playing,
  onToggle,
  english,
  className,
}: {
  playing: boolean;
  onToggle: () => void;
  english: boolean;
  className: string;
}) {
  const Icon = playing ? Pause : Play;
  const label = playing
    ? english ? "Pause banner rotation" : "배너 자동 넘김 멈춤"
    : english ? "Play banner rotation" : "배너 자동 넘김 재생";
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label}
      title={label}
      className={`inline-flex items-center justify-center border-2 border-[#111111] bg-[#ebe7de] text-[#111111] shadow-[2px_2px_0_#111111] transition hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1556a4] focus-visible:ring-offset-1 dark:border-[#f2cf27] dark:bg-[#2a2a2a] dark:text-white dark:shadow-[2px_2px_0_#f2cf27] dark:hover:bg-white dark:hover:text-[#111111] ${className}`}
    >
      <Icon aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2.6} fill="currentColor" />
    </button>
  );
}
