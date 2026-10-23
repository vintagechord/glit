"use client";

import { useEffect, useRef, type RefObject } from "react";

const activeModals: symbol[] = [];
const focusableSelector =
  'button:not(:disabled), a[href], input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/** Keep modal focus and background interaction together, including nested dialogs. */
export function useModalFocus(
  open: boolean,
  dialogRef: RefObject<HTMLElement | null>,
  onClose: () => void,
) {
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    const id = Symbol("modal");
    activeModals.push(id);
    const isActive = () => activeModals.at(-1) === id;
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const background = new Map<HTMLElement, boolean>();

    // Dialogs may be nested in a form/footer. Only siblings outside the entire
    // dialog ancestry become inert, so its own controls remain interactive.
    let branch: HTMLElement = dialog;
    while (branch.parentElement) {
      for (const sibling of branch.parentElement.children) {
        if (sibling !== branch && sibling instanceof HTMLElement) {
          background.set(sibling, sibling.inert);
          sibling.setAttribute("inert", "");
        }
      }
      if (branch.parentElement === document.body) break;
      branch = branch.parentElement;
    }
    document.body.style.overflow = "hidden";

    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector))
      .filter((element) => element.tabIndex >= 0 && !element.closest("[inert]") && element.getClientRects().length > 0);
    const focusFirst = () => (focusable()[0] ?? dialog).focus({ preventScroll: true });
    focusFirst();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isActive()) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
      } else if (event.key === "Tab") {
        const controls = focusable();
        const first = controls[0];
        const last = controls.at(-1);
        if (!first || !last) {
          event.preventDefault();
          dialog.focus();
        } else if (!dialog.contains(document.activeElement) || document.activeElement === dialog) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    const handleFocus = (event: FocusEvent) => {
      if (isActive() && event.target instanceof Node && !dialog.contains(event.target)) focusFirst();
    };
    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("focusin", handleFocus);
    return () => {
      activeModals.splice(activeModals.indexOf(id), 1);
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("focusin", handleFocus);
      background.forEach((wasInert, element) => { element.toggleAttribute("inert", wasInert); });
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected && !previousFocus.closest("[inert]")) previousFocus.focus({ preventScroll: true });
    };
  }, [open, dialogRef]);
}
