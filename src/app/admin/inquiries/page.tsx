import { redirect } from "next/navigation";

import { AdminSaveToast } from "@/components/admin/save-toast";
import { updateSupportInquiryFormAction } from "@/features/support/actions";
import { formatDateTime } from "@/lib/format";
import {
  supportInquiryStatusLabels,
  type SupportInquiryStatus,
} from "@/lib/support-inquiries";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "1:1 문의 관리",
};

type SearchParamsInput = {
  saved?: string | string[];
  error?: string | string[];
  status?: string | string[];
};

type InquiryRow = {
  id: string;
  user_id: string | null;
  title: string;
  body: string;
  contact: string;
  status: SupportInquiryStatus;
  admin_memo: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type ProfileRow = {
  user_id: string;
  name: string | null;
  company: string | null;
  phone: string | null;
};

const statusOptions: SupportInquiryStatus[] = [
  "NEW",
  "REVIEWING",
  "ANSWERED",
  "CLOSED",
];

const statusTone: Record<SupportInquiryStatus, string> = {
  NEW: "border-[#111111] bg-[#f2cf27] text-[#111111]",
  REVIEWING: "border-[#1556a4]/30 bg-[#1556a4]/10 text-[#1556a4]",
  ANSWERED: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700",
  CLOSED: "border-border bg-muted text-muted-foreground",
};

const toSingle = (value?: string | string[]) =>
  Array.isArray(value) ? value[0] : value;

async function requireAdminPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=${encodeURIComponent("/admin/inquiries")}`);
  }

  const { data: isAdmin, error } = await supabase.rpc("is_admin");
  if (error) {
    console.error("[admin-inquiries] admin check failed", error);
  }

  if (isAdmin !== true) {
    redirect("/");
  }
}

export default async function AdminInquiriesPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParamsInput>;
}) {
  await requireAdminPage();

  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const savedFlag = toSingle(resolvedSearchParams?.saved);
  const errorFlag = toSingle(resolvedSearchParams?.error);
  const statusFilter = toSingle(resolvedSearchParams?.status)?.trim() ?? "";

  const admin = createAdminClient();
  let query = admin
    .from("support_inquiries")
    .select("id, user_id, title, body, contact, status, admin_memo, created_at, updated_at")
    .order("created_at", { ascending: false })
    .limit(200);

  if (statusFilter) {
    query = query.eq("status", statusFilter);
  }

  const { data, error } = await query;
  const inquiries = (data ?? []) as InquiryRow[];
  const userIds = Array.from(
    new Set(
      inquiries
        .map((inquiry) => inquiry.user_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const { data: profilesData } =
    userIds.length > 0
      ? await admin
          .from("profiles")
          .select("user_id, name, company, phone")
          .in("user_id", userIds)
      : { data: [] as ProfileRow[] };
  const profileMap = new Map(
    ((profilesData ?? []) as ProfileRow[]).map((profile) => [
      profile.user_id,
      profile,
    ]),
  );

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-12">
      {savedFlag ? <AdminSaveToast message="저장되었습니다." /> : null}
      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
        Admin
      </p>
      <h1 className="font-display mt-2 text-3xl text-foreground">
        1:1 문의 관리
      </h1>
      <p className="mt-3 max-w-3xl text-sm text-muted-foreground">
        고객센터 1:1 문의 모달로 접수된 제목, 내용, 연락처를 확인하고 처리
        상태를 관리합니다.
      </p>

      <form className="mt-6 flex flex-wrap items-center gap-3 rounded-[18px] border border-border/60 bg-card/80 p-4">
        <select
          name="status"
          defaultValue={statusFilter}
          className="h-10 rounded-[8px] border-2 border-border bg-background px-3 text-sm font-semibold text-foreground"
        >
          <option value="">전체 상태</option>
          {statusOptions.map((status) => (
            <option key={status} value={status}>
              {supportInquiryStatusLabels[status]}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="h-10 rounded-[8px] border-2 border-[#111111] bg-[#111111] px-4 text-xs font-black text-white transition hover:bg-[#1556a4]"
        >
          필터 적용
        </button>
        <span className="ml-auto rounded-[8px] border border-border bg-background px-3 py-2 text-xs font-black text-muted-foreground">
          {inquiries.length.toLocaleString()}건
        </span>
      </form>

      {errorFlag ? (
        <div className="mt-6 rounded-[10px] border border-dashed border-red-500/40 bg-red-500/10 px-4 py-3 text-xs font-semibold text-red-600">
          문의 상태 저장 중 오류가 발생했습니다. 입력값과 마이그레이션 적용 상태를
          확인해주세요.
        </div>
      ) : null}

      <div className="mt-6 space-y-4">
        {error ? (
          <div className="rounded-[10px] border border-dashed border-red-500/40 bg-red-500/10 px-4 py-3 text-xs font-semibold text-red-600">
            문의 목록을 불러오지 못했습니다. ({error.message})
          </div>
        ) : inquiries.length > 0 ? (
          inquiries.map((inquiry) => {
            const profile = inquiry.user_id
              ? profileMap.get(inquiry.user_id)
              : null;

            return (
              <article
                key={inquiry.id}
                className="rounded-[14px] border-2 border-[#111111] bg-card p-5 shadow-[4px_4px_0_#111111] dark:border-[#f2cf27] dark:shadow-[4px_4px_0_#f2cf27]"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-[6px] border px-2 py-1 text-[10px] font-black ${
                          statusTone[inquiry.status]
                        }`}
                      >
                        {supportInquiryStatusLabels[inquiry.status]}
                      </span>
                      <span className="rounded-[6px] border border-border px-2 py-1 text-[10px] font-black text-muted-foreground">
                        {inquiry.user_id ? "회원" : "비회원"}
                      </span>
                    </div>
                    <h2 className="mt-3 break-words text-lg font-black text-foreground">
                      {inquiry.title}
                    </h2>
                    <p className="mt-1 text-xs font-semibold text-muted-foreground">
                      접수일 {formatDateTime(inquiry.created_at)} · 수정일{" "}
                      {formatDateTime(inquiry.updated_at)}
                    </p>
                    {profile ? (
                      <p className="mt-1 text-xs font-semibold text-muted-foreground">
                        회원 {profile.name ?? "-"}
                        {profile.company ? ` · ${profile.company}` : ""}
                        {profile.phone ? ` · ${profile.phone}` : ""}
                      </p>
                    ) : null}
                  </div>
                  <div className="rounded-[8px] border border-border bg-background px-3 py-2 text-xs font-black text-foreground">
                    {inquiry.contact}
                  </div>
                </div>

                <div className="mt-4 rounded-[10px] border border-border/70 bg-background p-4">
                  <p className="whitespace-pre-wrap break-words text-sm font-semibold leading-6 text-foreground">
                    {inquiry.body}
                  </p>
                </div>

                <form
                  action={updateSupportInquiryFormAction}
                  className="mt-4 grid gap-3 rounded-[10px] border border-border/70 bg-background p-4 md:grid-cols-[160px_1fr_auto]"
                >
                  <input type="hidden" name="inquiryId" value={inquiry.id} />
                  <label className="grid gap-1 text-xs font-black text-muted-foreground">
                    상태
                    <select
                      name="status"
                      defaultValue={inquiry.status}
                      className="h-10 rounded-[8px] border-2 border-border bg-card px-3 text-xs font-semibold text-foreground"
                    >
                      {statusOptions.map((status) => (
                        <option key={status} value={status}>
                          {supportInquiryStatusLabels[status]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-1 text-xs font-black text-muted-foreground">
                    관리자 메모
                    <input
                      name="adminMemo"
                      defaultValue={inquiry.admin_memo ?? ""}
                      placeholder="처리 메모"
                      className="h-10 rounded-[8px] border-2 border-border bg-card px-3 text-xs font-semibold text-foreground"
                    />
                  </label>
                  <div className="flex items-end">
                    <button
                      type="submit"
                      className="h-10 rounded-[8px] border-2 border-[#111111] bg-[#f2cf27] px-4 text-xs font-black text-[#111111] shadow-[3px_3px_0_#111111] transition hover:-translate-y-0.5"
                    >
                      저장
                    </button>
                  </div>
                </form>
              </article>
            );
          })
        ) : (
          <div className="rounded-[14px] border-2 border-dashed border-border bg-card px-5 py-12 text-center text-sm font-semibold text-muted-foreground">
            접수된 1:1 문의가 없습니다.
          </div>
        )}
      </div>
    </div>
  );
}
