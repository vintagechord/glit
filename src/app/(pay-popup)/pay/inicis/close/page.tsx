"use client";

import { useEffect } from "react";

const CloseBridgePage = () => {
  useEffect(() => {
    const payload = Object.fromEntries(new URLSearchParams(window.location.search).entries());
    const message = { type: "INICIS:CANCEL_BRIDGE", payload };
    try {
      window.opener?.postMessage(message, window.location.origin);
    } catch (error) {
      console.error("[Inicis][STDPay][bridge-close] postMessage error", error);
    }
    window.close();
  }, []);

  return (
    <div style={{ padding: 16, fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif" }}>
      <p style={{ fontWeight: 600 }}>결제를 취소했습니다.</p>
      <p style={{ marginTop: 8, color: "#666" }}>창이 닫히지 않으면 직접 닫아주세요.</p>
    </div>
  );
};

export default CloseBridgePage;
