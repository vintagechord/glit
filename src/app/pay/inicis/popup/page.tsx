import React from "react";

import InicisPopupClientPage from "./client-page";

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const metadata = {
  title: "KG 이니시스 카드 결제",
  description: "GLIT 이니시스 STDPay 결제 팝업",
};

type Props = {
  searchParams: Record<string, string | string[] | undefined>;
};

export default function InicisPopupPage({ searchParams }: Props) {
  return <InicisPopupClientPage searchParams={searchParams} />;
}
