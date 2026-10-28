import { redirect } from "next/navigation";
import { getAuthPageHref } from "@/features/auth/navigation";

export default async function FindIdPage({ searchParams }: { searchParams?: Promise<{ next?: string }> }) {
  const query = await searchParams;
  redirect(getAuthPageHref("login", query?.next));
}
