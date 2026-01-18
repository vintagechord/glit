import { redirect } from "next/navigation";

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function LegacyInicisStdPayPopupPage() {
  redirect("/pay/inicis/popup?context=test1000");
}
