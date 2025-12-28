"use client";

import * as React from "react";

type ScrollRevealObserverProps = {
  selector?: string;
};

export function ScrollRevealObserver({
  selector = "[data-scroll-reveal]",
}: ScrollRevealObserverProps) {
  React.useEffect(() => {
    const elements = Array.from(
      document.querySelectorAll<HTMLElement>(selector),
    );
    if (!elements.length) return;

    if (
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      elements.forEach((element) =>
        element.setAttribute("data-reveal-state", "visible"),
      );
      return;
    }

    if (typeof IntersectionObserver === "undefined") {
      elements.forEach((element) =>
        element.setAttribute("data-reveal-state", "visible"),
      );
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.setAttribute("data-reveal-state", "visible");
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.2, rootMargin: "0px 0px -10% 0px" },
    );

    elements.forEach((element) => observer.observe(element));

    return () => observer.disconnect();
  }, [selector]);

  return null;
}
