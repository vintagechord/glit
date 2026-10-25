"use client";

import { useCallback, useEffect, useRef } from "react";

/** How far (px) the section may sit from its scroll-margin before we settle it. */
const SETTLE_TOLERANCE_PX = 48;
/** Long enough for a smooth scroll across a long form to finish. */
const SETTLE_DELAY_MS = 900;

/** Keep each newly selected form section visible without overriding field links. */
export function useSubmissionStepScroll(step: number) {
  const stepContentRef = useRef<HTMLDivElement | null>(null);
  const previousStepRef = useRef(step);
  const skippedStepRef = useRef<number | null>(null);

  const skipNextStepScroll = useCallback((nextStep: number) => {
    if (nextStep !== previousStepRef.current) {
      skippedStepRef.current = nextStep;
    }
  }, []);

  useEffect(() => {
    // Mounting (including draft hydration on the same step) keeps browser scroll
    // restoration intact. Only a committed step change moves the viewport.
    if (previousStepRef.current === step) return;
    previousStepRef.current = step;
    const skip = skippedStepRef.current === step;
    skippedStepRef.current = null;
    if (skip) return;

    let settleTimer: number | undefined;
    let userScrolled = false;
    const markUserScroll = () => {
      userScrolled = true;
    };
    const userScrollEvents = ["wheel", "touchstart", "keydown", "pointerdown"] as const;
    const stopWatchingUser = () => {
      for (const name of userScrollEvents) window.removeEventListener(name, markUserScroll);
    };

    const frame = window.requestAnimationFrame(() => {
      const section = stepContentRef.current;
      if (!section) return;
      section.focus({ preventScroll: true });
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      section.scrollIntoView({ behavior: reducedMotion ? "instant" : "smooth", block: "start" });
      if (reducedMotion) return;

      // Another scroll in the same frame (for example the browser bringing the
      // tapped button into view) can cancel a smooth scroll without any event,
      // leaving the new step mid-form. Settle once unless the user took over.
      for (const name of userScrollEvents) {
        window.addEventListener(name, markUserScroll, { passive: true });
      }
      settleTimer = window.setTimeout(() => {
        stopWatchingUser();
        if (userScrolled || !section.isConnected) return;
        const margin = Number.parseFloat(window.getComputedStyle(section).scrollMarginTop) || 0;
        const offset = section.getBoundingClientRect().top - margin;
        if (Math.abs(offset) > SETTLE_TOLERANCE_PX) {
          section.scrollIntoView({ behavior: "instant", block: "start" });
        }
      }, SETTLE_DELAY_MS);
    });

    return () => {
      window.cancelAnimationFrame(frame);
      if (settleTimer !== undefined) window.clearTimeout(settleTimer);
      stopWatchingUser();
    };
  }, [step]);

  return { stepContentRef, skipNextStepScroll };
}
