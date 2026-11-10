"use client";

import * as React from "react";
import { Pause, Play } from "lucide-react";
import { usePathname } from "next/navigation";

/**
 * Stops and restarts the home banner's record and broadcaster band. The
 * motion runs longer than five seconds next to other content, so it needs a
 * control (WCAG 2.2.2); reduced-motion visitors never see it move.
 */
export function HeroMotionToggle() {
  const pathname = usePathname();
  const english = pathname === "/en" || pathname.startsWith("/en/");
  const [paused, setPaused] = React.useState(false);
  const buttonRef = React.useRef<HTMLButtonElement | null>(null);

  React.useEffect(() => {
    buttonRef.current
      ?.closest("[data-hero-banner]")
      ?.setAttribute("data-hero-motion", paused ? "paused" : "on");
  }, [paused]);

  const label = paused
    ? english ? "Play banner motion" : "배너 움직임 재생"
    : english ? "Pause banner motion" : "배너 움직임 멈춤";
  const Icon = paused ? Play : Pause;

  return (
    <button
      ref={buttonRef}
      type="button"
      className="onside-hero-toggle"
      aria-label={label}
      title={label}
      onClick={() => setPaused((value) => !value)}
    >
      <Icon aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2.6} fill="currentColor" />
    </button>
  );
}
