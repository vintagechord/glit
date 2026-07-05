"use client";

import { useEffect } from "react";

const CloseBridgePage = () => {
  useEffect(() => {
    const payload = Object.fromEntries(new URLSearchParams(window.location.search).entries());
    const message = {
      type: "INICIS:CANCEL",
      payload: {
        message: "사용자가 결제를 취소했습니다.",
        ...payload,
      },
    };
    try {
      window.opener?.postMessage(message, window.location.origin);
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(message, window.location.origin);
      }
    } catch (error) {
      console.error("[Inicis][STDPay][bridge-close] postMessage error", error);
    }
    document.body.innerHTML = "";
    window.setTimeout(() => {
      try {
        window.close();
      } catch {
        // ignore
      }
    }, 0);
  }, []);

  return null;
};

export default CloseBridgePage;
