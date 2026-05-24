import { notFound } from "next/navigation";

import { arePublicDevPagesEnabled } from "@/lib/dev-tools";

import InicisStdPay1000Page from "./client-page";

export default function InicisStdPay1000Route() {
  if (!arePublicDevPagesEnabled()) {
    notFound();
  }

  return <InicisStdPay1000Page />;
}
