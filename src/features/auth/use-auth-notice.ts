"use client";

import { useEffect, useRef } from "react";
import { showCenteredAlert } from "@/lib/centered-dialog";
import type { ActionState } from "./actions";

const englishMessages = {
  email_already_registered: "This email is already registered.",
  email_not_registered: "This email has no signup history.",
  password_reset_sent: "Password reset instructions have been sent to your registered email. Check your inbox and spam folder.",
};

export function useAuthNotice(state: ActionState, english: boolean) {
  const displayedState = useRef<ActionState | null>(null);

  useEffect(() => {
    if (!state.notice || displayedState.current === state) return;
    const text = state.error ?? state.message;
    // Server actions reply in the form's language. The map only covers replies
    // that still arrive in Korean, so an English popup never shows Korean text.
    const message = english ? (text && !/[가-힣]/.test(text) ? text : englishMessages[state.notice]) : text;
    if (!message) return;
    displayedState.current = state;
    void showCenteredAlert(message, { title: english ? "Notice" : "안내" });
  }, [state, english]);
}
