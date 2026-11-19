"use client";

import { useEffect } from "react";

import { markAdminSectionSeenAction } from "@/features/admin/section-seen-actions";
import type { AdminSeenSection } from "@/lib/admin/menu-attention";

/**
 * Tells the server that the administrator has this request page open. It runs
 * in the browser on purpose: a server-side write during render would also run
 * for link prefetches, and clear the badge for a page nobody opened.
 */
export function MarkSectionSeen({ section, renderedAt }: { section: AdminSeenSection; renderedAt: string }) {
  useEffect(() => {
    void markAdminSectionSeenAction(section, renderedAt).catch(() => undefined);
  }, [section, renderedAt]);
  return null;
}
