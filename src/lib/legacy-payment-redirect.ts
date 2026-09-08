import { notFound, redirect } from "next/navigation";

import { createServerSupabase } from "@/lib/supabase/server";
import { getServerSessionUser } from "@/lib/supabase/server-user";

type PaymentPageProps = { params: Promise<{ id: string }> };

export async function redirectLegacyPaymentPage({ params }: PaymentPageProps, locale: "ko" | "en" = "ko") {
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) notFound();
  const prefix = locale === "en" ? "/en" : "";
  const supabase = await createServerSupabase();
  const user = await getServerSessionUser(supabase);
  if (!user) redirect(`${prefix}/login?next=${encodeURIComponent(`${prefix}/dashboard/pay/${id}`)}`);

  const { data: submission, error } = await supabase.from("submissions")
    .select("id, current_order_id")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error || !submission) notFound();
  const destination = submission.current_order_id ? "orders" : "cart";
  redirect(`${prefix}/mypage/${destination}?focus=${encodeURIComponent(submission.id)}`);
}
