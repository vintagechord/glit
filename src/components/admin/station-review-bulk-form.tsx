"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { stationReviewStatusOptions } from "@/constants/review-status";
import { updateStationReviewsBulkAction } from "@/features/admin/actions";
import type { BulkStationReviewInput } from "@/lib/admin/review-management";

type Station = { stationId: string; reviewId?: string | null; expectedUpdatedAt: string | null; name: string };

export function StationReviewBulkForm({ submissionId, stations, broadcast }: { submissionId: string; stations: Station[]; broadcast: boolean }) {
  const router = useRouter();
  const [selected, setSelected] = React.useState<string[]>([]);
  const [status, setStatus] = React.useState<BulkStationReviewInput["status"]>("SENT");
  const [rating, setRating] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const pending = React.useRef(false);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (pending.current || !selected.length) return;
    pending.current = true; setBusy(true); setMessage(null); setError(null);
    try {
      const result = await updateStationReviewsBulkAction({ submissionId, status,
        stations: stations.filter(station => selected.includes(station.stationId)).map(({ name: _name, ...station }) => { void _name; return station; }),
        ...(broadcast && status === "APPROVED" && rating ? { ageRating: rating as "ALL" | "12" | "15" | "19" } : {}),
      });
      if (result.error) { setError(result.error); return; }
      setMessage(result.message || "선택한 방송사를 저장했습니다."); setSelected([]); router.refresh();
    } catch { setError("저장 결과를 확인하지 못했습니다. 최신 화면에서 결과를 확인해주세요."); }
    finally { pending.current = false; setBusy(false); }
  }
  return <form onSubmit={save} className="rounded-2xl border border-border/60 bg-background p-4" aria-label="방송사 일괄 저장">
    <h3 className="font-semibold">방송사 선택 · 일괄 저장</h3>
    <p className="mt-1 text-xs text-muted-foreground">선택한 방송사의 상태와 대상 곡 결과를 함께 변경합니다. 메모는 유지하며 이메일은 발송하지 않습니다.</p>
    <div className="my-3 flex flex-wrap gap-3">
      <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={selected.length === stations.length && !!stations.length} disabled={busy} onChange={event => setSelected(event.target.checked ? stations.map(station => station.stationId) : [])} />전체 선택</label>
      {stations.map(station => <label key={station.stationId} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selected.includes(station.stationId)} disabled={busy} onChange={event => setSelected(previous => event.target.checked ? [...previous, station.stationId] : previous.filter(id => id !== station.stationId))} />{station.name}</label>)}
    </div>
    <div className="flex flex-wrap items-center gap-3">
      <select aria-label="일괄 적용할 방송사 상태" value={status} disabled={busy} onChange={event => setStatus(event.target.value as BulkStationReviewInput["status"])} className="min-h-11 rounded-xl border border-border bg-background px-3 py-2 text-sm">{stationReviewStatusOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
      {broadcast && status === "APPROVED" ? <select aria-label="일괄 적용할 연령 등급" value={rating} disabled={busy} onChange={event => setRating(event.target.value)} className="min-h-11 rounded-xl border border-border bg-background px-3 py-2 text-sm"><option value="">기존 등급 유지</option><option value="ALL">전체 시청가</option><option value="12">12세 이상</option><option value="15">15세 이상</option><option value="19">19세 이상</option></select> : null}
      <button disabled={busy || !selected.length} className="min-h-11 rounded-full bg-foreground px-5 py-2 text-sm font-semibold text-background disabled:opacity-50">{busy ? "저장 중…" : `선택한 ${selected.length}개 방송사 저장`}</button>
    </div>
    <p className="mt-2 text-xs text-muted-foreground">선택한 방송사 중 하나라도 최신 정보와 다르면 전체 저장을 취소합니다. WBS 대상곡이 미확정이면 개별 곡을 먼저 확인하세요.</p>
    {error ? <p role="alert" className="mt-3 text-sm text-rose-700">{error}</p> : null}
    {message ? <p role="status" className="mt-3 text-sm text-emerald-700">{message}</p> : null}
  </form>;
}
