"use client";

import { useActionState, useState } from "react";
import type { AdminActionState } from "@/features/admin/actions";
import { ArtistThumbnailUploader } from "./artist-thumbnail-uploader";

export function ArtistEditorForm({ artistId, initialName, initialThumbnailUrl, action }: {
  artistId: string; initialName: string; initialThumbnailUrl?: string | null;
  action: (previous: AdminActionState, data: FormData) => Promise<AdminActionState>;
}) {
  const [name, setName] = useState(initialName);
  const [uploading, setUploading] = useState(false);
  const [state, save, pending] = useActionState(async (previous: AdminActionState, form: FormData) => {
    try { return await action(previous, form); }
    catch (error) { return { error: error instanceof Error ? error.message : "저장하지 못했습니다. 다시 시도해주세요." }; }
  }, {});
  return <form action={save} className="mt-4 space-y-4"><fieldset disabled={pending} className="grid gap-4 md:grid-cols-2">
    <input type="hidden" name="artistId" value={artistId} />
    <label className="space-y-2"><span className="text-xs font-semibold text-muted-foreground">아티스트명</span><input name="name" value={name} onChange={event => setName(event.target.value)} required maxLength={500} className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm" /><span className="block text-xs text-muted-foreground">이름을 변경해도 연결된 심의는 유지됩니다.</span></label>
    <div className="space-y-2"><p className="text-xs font-semibold text-muted-foreground">썸네일 이미지</p><ArtistThumbnailUploader initialUrl={initialThumbnailUrl} onBusyChange={setUploading} /></div>
    {state.error && <p role="alert" className="rounded-xl bg-red-500/10 p-3 text-sm text-red-700 md:col-span-2">{state.error}</p>}
    {state.message && <p role="status" className="rounded-xl bg-emerald-500/10 p-3 text-sm text-emerald-800 md:col-span-2">{state.message}</p>}
    <div className="flex justify-end md:col-span-2"><button type="submit" disabled={pending || uploading} className="rounded-full bg-foreground px-5 py-2 text-sm font-semibold text-background disabled:cursor-not-allowed disabled:opacity-50">{pending ? "저장 중..." : uploading ? "이미지 처리 중..." : "저장"}</button></div>
  </fieldset></form>;
}
