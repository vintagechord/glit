import type { User } from "@supabase/supabase-js";

import { createServerSupabase } from "@/lib/supabase/server";

type AdminApiAuthResult =
  | {
      ok: true;
      user: User;
    }
  | {
      ok: false;
      status: 401 | 403;
      error: string;
    };

export async function requireAdminForApi(): Promise<AdminApiAuthResult> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false,
      status: 401,
      error: "로그인이 필요합니다.",
    };
  }

  const { data: isAdmin, error } = await supabase.rpc("is_admin");
  if (error) {
    console.error("[admin-api] is_admin check failed", error);
  }

  if (isAdmin !== true) {
    return {
      ok: false,
      status: 403,
      error: "관리자 권한이 필요합니다.",
    };
  }

  return { ok: true, user };
}
