"use client";

import { useEffect } from "react";

/**
 * The glossary's categories start closed. A link to one term (#term-…) opens
 * the category that holds it and brings the term into view, in browsers that
 * do not open a closed <details> for a fragment on their own.
 */
export function GlossaryHashOpener() {
  useEffect(() => {
    const open = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!id) return;
      const target = document.getElementById(id);
      const details = target?.closest("details");
      if (!target || !details || details.open) return;
      details.open = true;
      target.scrollIntoView({ block: "start" });
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, []);
  return null;
}
