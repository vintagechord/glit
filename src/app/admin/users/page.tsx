import Link from "next/link";

import { createAdminClient } from "@/lib/supabase/admin";
import { formatDateTime } from "@/lib/format";

export const metadata = {
  title: "회원 관리",
};

export const dynamic = "force-dynamic";

type UserRow = {
  user_id: string;
  name: string | null;
  company: string | null;
  phone: string | null;
  created_at: string | null;
  updated_at: string | null;
  email?: string | null;
};

export default async function AdminUsersPage() {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("profiles")
    .select("user_id, name, company, phone, role, created_at, updated_at")
    .order("created_at", { ascending: false })
    .limit(200);

  // auth.users에서 이메일을 가져와 병합
  const ids = (data ?? []).map((item) => item.user_id);
  let emailMap = new Map<string, string | null>();
  if (ids.length > 0) {
    const { data: authUsers } = await admin
      .from("users", { schema: "auth" })
      .select("id, email")
      .in("id", ids);
    emailMap = new Map(
      (authUsers ?? []).map((row: { id: string; email: string | null }) => [
        row.id,
        row.email,
      ]),
    );
  }

  const users: UserRow[] = (data ?? []).map((item) => ({
    ...item,
    email: emailMap.get(item.user_id) ?? null,
  })) as UserRow[];

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-12">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            관리자
          </p>
          <h1 className="font-display mt-2 text-3xl text-foreground">
            회원 관리
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            가입한 회원의 기본 정보와 연락처를 확인합니다.
          </p>
        </div>
        <Link
          href="/admin"
          className="rounded-full border border-border/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-foreground"
        >
          관리자 홈
        </Link>
      </div>

      {error && (
        <div className="mt-6 rounded-2xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-700">
          회원 정보를 불러오지 못했습니다. ({error.message})
        </div>
      )}

      <div className="mt-6 overflow-x-auto">
        <table className="min-w-[900px] w-full rounded-[24px] border border-border/60 bg-card/80 text-left text-sm shadow-[0_18px_50px_rgba(15,23,42,0.08)]">
          <thead className="border-b border-border/60 bg-muted/40 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-semibold">이메일</th>
              <th className="px-4 py-3 font-semibold">User ID</th>
              <th className="px-4 py-3 font-semibold">이름</th>
              <th className="px-4 py-3 font-semibold">회사</th>
              <th className="px-4 py-3 font-semibold">연락처</th>
              <th className="px-4 py-3 font-semibold">가입일</th>
              <th className="px-4 py-3 font-semibold">수정일</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {users.map((user) => (
              <tr key={user.user_id} className="hover:bg-background/60">
                <td className="px-4 py-3 text-foreground">
                  {user.email ?? "-"}
                </td>
                <td className="px-4 py-3 font-mono text-[12px] text-muted-foreground">
                  {user.user_id}
                </td>
                <td className="px-4 py-3 text-foreground">
                  {user.name ?? "-"}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {user.company ?? "-"}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {user.phone ?? "-"}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {user.created_at ? formatDateTime(user.created_at) : "-"}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {user.updated_at ? formatDateTime(user.updated_at) : "-"}
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-6 text-center text-sm text-muted-foreground"
                >
                  회원 정보가 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
