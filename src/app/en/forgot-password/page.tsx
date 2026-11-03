import { pageMetadata } from "@/lib/seo";
export { default } from "@/app/forgot-password/page";

export const metadata = pageMetadata({
  locale: "en",
  title: "Reset your password",
  description: "Get a link to reset your Onside password at the email you signed up with.",
  path: "/forgot-password",
  enPath: "/en/forgot-password",
  noindex: true,
});
