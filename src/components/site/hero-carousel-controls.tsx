"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";

import { useHeroEnglish } from "@/components/site/hero-text";

/**
 * Runs the home banner: previous and next, the position, and one button that
 * stops everything that moves (the slides, the record, the broadcaster band).
 * The slides are a native scroll-snap strip, so swiping works without this
 * script; it adds the buttons and the timed advance. The advance waits while
 * the pointer or keyboard focus is on the banner, while the tab is hidden,
 * and never runs for visitors who ask for reduced motion (WCAG 2.2.2).
 */
export function HeroCarouselControls({ count, intervalSeconds }: { count: number; intervalSeconds: number }) {
  const english = useHeroEnglish();
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const [index, setIndex] = React.useState(0);
  const [paused, setPaused] = React.useState(false);
  const [held, setHeld] = React.useState(false);

  const viewport = React.useCallback(
    () => rootRef.current?.closest("[data-hero-banner]")?.querySelector<HTMLElement>("[data-hero-slides]") ?? null,
    [],
  );

  const goTo = React.useCallback((target: number) => {
    const strip = viewport();
    if (!strip) return;
    const next = ((target % count) + count) % count;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    strip.scrollTo({ left: next * strip.clientWidth, behavior: reduced ? "auto" : "smooth" });
  }, [count, viewport]);

  // The strip's own scroll position is the source of truth, so a swipe, the
  // buttons and the timer all report through the same place.
  React.useEffect(() => {
    const strip = viewport();
    if (!strip) return;
    const read = () => {
      const width = strip.clientWidth;
      if (width > 0) setIndex(Math.min(count - 1, Math.max(0, Math.round(strip.scrollLeft / width))));
    };
    read();
    strip.addEventListener("scroll", read, { passive: true });
    window.addEventListener("resize", read);
    return () => {
      strip.removeEventListener("scroll", read);
      window.removeEventListener("resize", read);
    };
  }, [count, viewport]);

  React.useEffect(() => {
    const banner = rootRef.current?.closest<HTMLElement>("[data-hero-banner]");
    if (!banner) return;
    const slides = Array.from(banner.querySelectorAll<HTMLElement>("[data-hero-slide]"));
    slides.forEach((slide, position) => {
      const active = position === index;
      slide.toggleAttribute("data-active", active);
      // A link on a slide that is off screen must not take keyboard focus.
      slide.toggleAttribute("inert", !active);
    });
    const design = slides[index]?.dataset.heroDesign;
    if (design) banner.dataset.heroField = design;
  }, [index]);

  React.useEffect(() => {
    rootRef.current?.closest("[data-hero-banner]")?.setAttribute("data-hero-motion", paused ? "paused" : "on");
  }, [paused]);

  React.useEffect(() => {
    const banner = rootRef.current?.closest<HTMLElement>("[data-hero-banner]");
    if (!banner) return;
    const hold = () => setHeld(true);
    const release = () => setHeld(false);
    const releaseAfterFocus = (event: FocusEvent) => {
      if (!banner.contains(event.relatedTarget as Node | null)) setHeld(false);
    };
    banner.addEventListener("pointerenter", hold);
    banner.addEventListener("pointerleave", release);
    banner.addEventListener("focusin", hold);
    banner.addEventListener("focusout", releaseAfterFocus);
    banner.addEventListener("touchstart", hold, { passive: true });
    banner.addEventListener("touchend", release);
    banner.addEventListener("touchcancel", release);
    return () => {
      banner.removeEventListener("pointerenter", hold);
      banner.removeEventListener("pointerleave", release);
      banner.removeEventListener("focusin", hold);
      banner.removeEventListener("focusout", releaseAfterFocus);
      banner.removeEventListener("touchstart", hold);
      banner.removeEventListener("touchend", release);
      banner.removeEventListener("touchcancel", release);
    };
  }, []);

  React.useEffect(() => {
    if (count < 2 || paused || held) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setTimeout(() => {
      if (!document.hidden) goTo(index + 1);
    }, intervalSeconds * 1000);
    return () => window.clearTimeout(timer);
  }, [count, paused, held, index, intervalSeconds, goTo]);

  const pauseLabel = paused
    ? english ? "Play banner motion" : "배너 움직임 재생"
    : english ? "Pause banner motion" : "배너 움직임 멈춤";
  const PauseIcon = paused ? Play : Pause;

  return (
    <div ref={rootRef} className="onside-hero-controls" data-no-translate>
      {count > 1 ? (
        <div className="onside-hero-nav">
          <button type="button" className="onside-hero-control" aria-label={english ? "Previous main banner" : "이전 메인 배너"} onClick={() => goTo(index - 1)}>
            <ChevronLeft aria-hidden="true" className="h-4 w-4" strokeWidth={2.6} />
          </button>
          {/* Announced only once the visitor has stopped the rotation. */}
          <p className="onside-hero-count" aria-live={paused ? "polite" : "off"} aria-atomic="true">
            <span className="sr-only">{english ? "Banner " : "배너 "}</span>
            {index + 1} / {count}
          </p>
          <button type="button" className="onside-hero-control" aria-label={english ? "Next main banner" : "다음 메인 배너"} onClick={() => goTo(index + 1)}>
            <ChevronRight aria-hidden="true" className="h-4 w-4" strokeWidth={2.6} />
          </button>
        </div>
      ) : null}
      <button
        type="button"
        className="onside-hero-control onside-hero-toggle"
        aria-label={pauseLabel}
        title={pauseLabel}
        aria-pressed={paused}
        onClick={() => setPaused((value) => !value)}
      >
        <PauseIcon aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2.6} fill="currentColor" />
      </button>
    </div>
  );
}
