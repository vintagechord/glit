export { default } from "@/app/track/[token]/page";

// Guest progress pages hold personal data: never cache or index them.
export const metadata = {
  title: { absolute: "Guest Progress | Onside" },
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";
export const revalidate = 0;
