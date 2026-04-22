import React from "react";

import InicisPopupClientPage from "./client-page";

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const metadata = {
  title: "온사이드 카드 결제",
  description: "온사이드 카드 결제 창",
};

type Props = {
  searchParams:
    | Record<string, string | string[] | undefined>
    | Promise<Record<string, string | string[] | undefined>>;
};

export default async function InicisPopupPage({ searchParams }: Props) {
  const resolvedSearchParams = await searchParams;
  return <InicisPopupClientPage searchParams={resolvedSearchParams} />;
}
