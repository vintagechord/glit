"use client";

import * as React from "react";

export function AdminSaveToast({ message }: { message: string }) {
  React.useEffect(() => {
    if (!message) return;
    window.alert(message);
    const url = new URL(window.location.href);
    url.searchParams.delete("saved");
    window.history.replaceState({}, "", url.toString());
  }, [message]);
  return null;
}
