import React from "react";

import InicisStdPayPopupClientPage from "./client-page";

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const metadata = {
  title: "이니시스 테스트 결제",
  description: "KG 이니시스 STDPay 테스트 결제 팝업",
};

export default function InicisStdPayPopupPage() {
  return <InicisStdPayPopupClientPage />;
}
