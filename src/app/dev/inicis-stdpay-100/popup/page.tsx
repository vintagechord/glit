import { notFound, redirect } from "next/navigation";

import { arePublicDevPagesEnabled } from "@/lib/dev-tools";

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function LegacyInicisStdPayPopupPage() {
  if (!arePublicDevPagesEnabled()) {
    notFound();
  }
  redirect("/pay/inicis/popup?context=test1000");
}
