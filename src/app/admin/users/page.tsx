import Link from "next/link";

import { AdminListPager, adminListRange, parseAdminListPage } from "@/components/admin/list-pager";
import { requireAdminPage } from "@/lib/admin/page-auth";
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

type SearchParamsInput = {
  q?: string | string[];
  page?: string | string[];
};

const PAGE_SIZE = 50;
// Email matches become a user_id list in the request URL; keep it short.
const EMAIL_MATCH_LIMIT = 100;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const toSingle = (value?: string | string[]) => (Array.isArray(value) ? value[0] : value) ?? "";

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParamsInput>;
}) {
  await requireAdminPage();
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const searchQuery = toSingle(resolvedSearchParams?.q).trim().slice(0, 100);
  const page = parseAdminListPage(resolvedSearchParams?.page);
  const range = adminListRange(page, PAGE_SIZE);
  const admin = createAdminClient();

  // Emails live in auth.users; match them first, then search profiles by
  // name, company, phone or one of the matched ids.
  let emailMatchIds: string[] = [];
  let searchWarning: string | null = null;
  if (searchQuery) {
    const { data: matches, error: matchError } = await admin.rpc("admin_search_auth_user_ids", {
      p_query: searchQuery,
      p_limit: EMAIL_MATCH_LIMIT,
    });
    if (matchError) {
      searchWarning = "이메일 검색을 사용할 수 없어 이름·회사·연락처로만 검색했습니다.";
    } else {
      emailMatchIds = ((matches ?? []) as Array<{ user_id?: unknown }>)
        .map((row) => String(row.user_id ?? ""))
        .filter((id) => uuidPattern.test(id));
    }
  }

  let query = admin
    .from("profiles")
    .select("user_id, name, company, phone, created_at, updated_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .order("user_id", { ascending: false });
  if (searchQuery) {
    // Quote the value so commas or parentheses don't break the or() list.
    const pattern = `"%${searchQuery.replace(/["\\]/g, "\\$&")}%"`;
    const terms = [`name.ilike.${pattern}`, `company.ilike.${pattern}`, `phone.ilike.${pattern}`];
    if (emailMatchIds.length) terms.push(`user_id.in.(${emailMatchIds.join(",")})`);
    query = query.or(terms.join(","));
  }
  const { data, error, count } = await query.range(range.from, range.to);
  const profiles = (data ?? []) as Omit<UserRow, "email">[];
  const totalCount = count ?? profiles.length;

  // Ask only for the emails of the members on this page.
  const ids = profiles.map((item) => item.user_id);
  let emailMap = new Map<string, string | null>();
  let emailError: string | null = null;
  if (ids.length > 0) {
    const { data: emails, error: emailsError } = await admin.rpc("admin_auth_user_emails", { p_user_ids: ids });
    if (emailsError) {
      emailError = emailsError.message;
    } else {
      emailMap = new Map(
        ((emails ?? []) as Array<{ user_id: string; email: string | null }>).map((row) => [row.user_id, row.email ?? null]),
      );
    }
  }

  const users: UserRow[] = profiles.map((item) => ({
    ...item,
    email: emailMap.get(item.user_id) ?? null,
  }));

  const hrefForPage = (target: number) => {
    const params = new URLSearchParams();
    if (searchQuery) params.set("q", searchQuery);
    if (target > 1) params.set("page", String(target));
    const search = params.toString();
    return search ? `/admin/users?${search}` : "/admin/users";
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-12">
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-3xl text-foreground">
            회원 관리
          </h1>
        </div>
        <Link
          href="/admin"
          className="rounded-full border border-border/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-foreground"
        >
          관리자 홈
        </Link>
      </div>

      <form className="mt-6 flex flex-wrap items-center gap-3 rounded-[18px] border border-border/60 bg-card/80 p-4" role="search">
        <label htmlFor="admin-users-q" className="sr-only">회원 검색</label>
        <input
          id="admin-users-q"
          name="q"
          type="search"
          defaultValue={searchQuery}
          maxLength={100}
          placeholder="이메일, 이름, 회사, 연락처"
          className="h-10 min-w-[240px] flex-1 rounded-[8px] border-2 border-border bg-background px-3 text-sm font-semibold text-foreground"
        />
        <button
          type="submit"
          className="h-10 rounded-[8px] border-2 border-[#111111] bg-[#111111] px-4 text-xs font-black text-white transition hover:bg-[#1556a4]"
        >
          검색
        </button>
        {searchQuery ? (
          <Link href="/admin/users" className="h-10 rounded-[8px] border-2 border-border bg-background px-4 py-2.5 text-xs font-black text-foreground">
            검색 해제
          </Link>
        ) : null}
        <span className="ml-auto rounded-[8px] border border-border bg-background px-3 py-2 text-xs font-black text-muted-foreground">
          총 {totalCount.toLocaleString()}명
        </span>
      </form>

      <div className="mt-4 flex justify-end">
        <AdminListPager page={page} totalCount={totalCount} pageSize={PAGE_SIZE} hrefForPage={hrefForPage} />
      </div>

      {searchWarning && (
        <p role="status" className="mt-4 rounded-2xl border-2 border-[#111111] bg-[#f2cf27] px-4 py-2 text-xs font-semibold text-[#111111]">
          {searchWarning}
        </p>
      )}

      {error && (
        <div className="mt-6 rounded-2xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-700">
          <p className="font-semibold">회원 정보를 불러오지 못했습니다.</p>
          <details className="mt-1 text-xs">
            <summary className="cursor-pointer font-semibold">오류 상세</summary>
            <p className="mt-1 break-words">{error.message}</p>
          </details>
        </div>
      )}
      {emailError && (
        <div className="mt-4 rounded-2xl border border-[#f6d64a] bg-[#f6d64a] px-4 py-2 text-xs text-black">
          <p className="font-semibold">일부 이메일을 불러오지 못했습니다.</p>
          <details className="mt-1">
            <summary className="cursor-pointer font-semibold">오류 상세</summary>
            <p className="mt-1 break-words">{emailError}</p>
          </details>
        </div>
      )}

      <div
        className="mt-6 overflow-x-auto"
        role="region"
        aria-label="회원 목록"
        tabIndex={0}
      >
        <table className="min-w-[900px] w-full rounded-[24px] border border-border/60 bg-card/80 text-left text-sm shadow-[0_18px_50px_rgba(15,23,42,0.08)]">
          <caption className="sr-only">회원 기본 정보 및 연락처 목록</caption>
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
                  {searchQuery ? "검색 결과가 없습니다." : "회원 정보가 없습니다."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {totalCount > PAGE_SIZE ? (
        <div className="mt-6 flex justify-end">
          <AdminListPager page={page} totalCount={totalCount} pageSize={PAGE_SIZE} hrefForPage={hrefForPage} />
        </div>
      ) : null}
    </div>
  );
}
