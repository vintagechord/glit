import { notFound } from "next/navigation";

import { arePublicDevPagesEnabled } from "@/lib/dev-tools";

import DevInicisStdPayPage from "./client-page";

export default function DevInicisStdPayRoute() {
  if (!arePublicDevPagesEnabled()) {
    notFound();
  }

  return <DevInicisStdPayPage />;
}
