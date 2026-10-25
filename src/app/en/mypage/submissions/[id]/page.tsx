export { default, metadata } from "@/app/en/dashboard/submissions/[id]/page";

// Route config must be declared directly; Turbopack cannot evaluate re-exports.
export const dynamic = "force-dynamic";
export const revalidate = 0;
