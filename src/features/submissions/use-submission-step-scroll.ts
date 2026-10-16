"use client";

import { useCallback, useEffect, useRef } from "react";

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

    const frame = window.requestAnimationFrame(() => {
      const section = stepContentRef.current;
      if (!section) return;
      section.focus({ preventScroll: true });
      section.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
        block: "start",
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [step]);

  return { stepContentRef, skipNextStepScroll };
}
