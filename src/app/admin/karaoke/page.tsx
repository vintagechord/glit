import { updateKaraokeStatusFormAction } from "@/features/karaoke/actions";
import { formatDateTime } from "@/lib/format";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata = {
  title: "노래방 요청 관리",
};

const statusOptions = ["REQUESTED", "IN_REVIEW", "COMPLETED"];

export default async function AdminKaraokePage({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const supabase = createServerSupabase();
  let query = supabase
    .from("karaoke_requests")
    .select("id, title, artist, contact, notes, status, created_at")
    .order("created_at", { ascending: false });

  if (searchParams.status) {
    query = query.eq("status", searchParams.status);
  }

  const { data: requests } = await query;

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-12">
      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
        Admin
      </p>
      <h1 className="font-display mt-2 text-3xl text-foreground">
        노래방 등록 요청 관리
      </h1>

      <form className="mt-6 flex flex-wrap items-center gap-3 rounded-[28px] border border-border/60 bg-card/80 p-4">
        <select
          name="status"
          defaultValue={searchParams.status ?? ""}
          className="rounded-2xl border border-border/70 bg-background px-4 py-2 text-sm"
        >
          <option value="">전체 상태</option>
          {statusOptions.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-full bg-foreground px-5 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-background"
        >
          필터 적용
        </button>
      </form>

      <div className="mt-6 space-y-4">
        {requests && requests.length > 0 ? (
          requests.map((request) => (
            <div
              key={request.id}
              className="rounded-2xl border border-border/60 bg-card/80 p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    {request.title}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {request.artist ?? "-"} · {request.contact}
                  </p>
                </div>
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(request.created_at)}
                </p>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                {request.notes ?? "요청 사항 없음"}
              </p>
              <form
                action={updateKaraokeStatusFormAction}
                className="mt-4 flex flex-wrap items-center gap-3"
              >
                <input type="hidden" name="requestId" value={request.id} />
                <select
                  name="status"
                  defaultValue={request.status}
                  className="rounded-2xl border border-border/70 bg-background px-4 py-2 text-xs"
                >
                  {statusOptions.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="rounded-full bg-foreground px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-background"
                >
                  상태 저장
                </button>
              </form>
            </div>
          ))
        ) : (
          <div className="rounded-2xl border border-dashed border-border/60 bg-background/70 px-4 py-6 text-xs text-muted-foreground">
            요청이 없습니다.
          </div>
        )}
      </div>
    </div>
  );
}
