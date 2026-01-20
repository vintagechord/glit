"use client";

import { useEffect } from "react";

const ReturnBridgePage = () => {
  useEffect(() => {
    const payload = Object.fromEntries(new URLSearchParams(window.location.search).entries());
    const message = { type: "INICIS:RETURN_BRIDGE", payload };
    try {
      window.opener?.postMessage(message, window.location.origin);
    } catch (error) {
      console.error("[Inicis][STDPay][bridge-return] postMessage error", error);
    }
    window.close();
  }, []);

  return (
    <div style={{ padding: 16, fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif" }}>
      <p style={{ fontWeight: 600 }}>결제 결과를 정리하는 중입니다.</p>
      <p style={{ marginTop: 8, color: "#666" }}>잠시 후 창이 닫히지 않으면 직접 닫아주세요.</p>
    </div>
  );
};

export default ReturnBridgePage;
