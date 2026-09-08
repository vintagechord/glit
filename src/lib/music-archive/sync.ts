import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { consumeRateLimit } from "@/lib/request-rate-limit";
import { ArchiveError, archiveDatabaseError } from "./http";
import { getMusicProviderStatuses, type MusicBrainzCursor } from "./providers";
import { collectAppleStep, type AppleCursor } from "./apple";
import { collectMusicBrainzStep, MusicProviderError } from "./musicbrainz";
import { type ArchiveLibrary, type ArchiveSyncJob } from "./model";
import { getOwnedLibrary } from "./service";
import { mergeArchiveImports } from "./import";

export async function acquireArchiveProviderPermit(provider: "musicbrainz" | "apple" = "musicbrainz") {
  const { data, error } = await createAdminClient().rpc("reserve_music_archive_provider_slot", { p_provider: provider });
  archiveDatabaseError(error);
  const wait = Number(data);
  if (!Number.isFinite(wait) || wait < 0 || wait > 5000) throw new MusicProviderError("rate_limited", "공유 호출 한도에 도달했습니다. 잠시 후 이어서 시도해주세요.", 6);
  if (wait) await new Promise(resolve => setTimeout(resolve, wait));
}

function syncPermission(provider: string) {
  const support = getMusicProviderStatuses().find(item => item.id === provider);
  if (!support || support.status !== "available" || !["musicbrainz", "apple"].includes(provider)) throw new ArchiveError(support?.message ?? "이 제공처는 수동 연결을 지원합니다.", 422, support?.status ?? "UNSUPPORTED");
}
/** Each confirmed catalog profile has its own durable cursor, even within one provider. */
export async function enqueueArchiveSync(owner: string, library: ArchiveLibrary, provider: string, externalArtistId?: string) {
  syncPermission(provider);
  if (library.archived_at) throw new ArchiveError("아티스트를 복구한 뒤 수집해주세요.", 409);
  const connections = library.data.connections.filter(item => item.provider === provider && item.confirmed && item.externalArtistId && (!externalArtistId || item.externalArtistId === externalArtistId));
  if (!connections.length) throw new ArchiveError("아티스트 후보를 확인하고 제공처를 먼저 연결해주세요.", 422);
  const rate = consumeRateLimit({ namespace: "archive-sync", identifier: owner, limit: 10, windowMs: 3600000 });
  if (!rate.allowed) throw new ArchiveError("새 동기화는 시간당 10회까지 가능합니다. 기존 작업의 이어서 수집을 이용해주세요.", 429);
  const admin = createAdminClient();
  const jobs: ArchiveSyncJob[] = [];
  let missed = 0;
  let failure: unknown;
  for (const connection of connections) {
    try {
      const { data: existing, error: existingError } = await admin.from("music_archive_jobs").select("*").eq("owner_id", owner).eq("library_id", library.id).eq("provider", provider).eq("external_artist_id", connection.externalArtistId!).in("status", ["queued", "running", "partial", "blocked"]).maybeSingle();
      archiveDatabaseError(existingError);
      if (existing) {
        // A result-window limit cannot advance by retrying the same cursor.
        if (["partial", "blocked"].includes(existing.status) && existing.cursor?.providerCursor?.phase !== "limited") jobs.push((await resumeArchiveSync(owner, existing.id)).job);
        else jobs.push(existing);
        continue;
      }
      const { data, error } = await admin.from("music_archive_jobs").insert({ id: randomUUID(), owner_id: owner, library_id: library.id, provider, external_artist_id: connection.externalArtistId, status: "queued", cursor: {}, counts: {} }).select("*").single();
      if (error?.code === "23505") {
        // A simultaneous request may have reserved this exact profile first.
        const { data: concurrent, error: concurrentError } = await admin.from("music_archive_jobs").select("*").eq("owner_id", owner).eq("library_id", library.id).eq("provider", provider).eq("external_artist_id", connection.externalArtistId!).in("status", ["queued", "running", "partial", "blocked"]).maybeSingle();
        archiveDatabaseError(concurrentError);
        if (concurrent) { jobs.push(concurrent); continue; }
      }
      archiveDatabaseError(error);
      jobs.push(data);
    } catch (error) { missed += 1; failure = error; }
  }
  if (!jobs.length) throw failure ?? new ArchiveError("앨범 불러오기를 시작하지 못했습니다.", 503);
  return { job: jobs[0], jobs, runLibraryId: library.id, ...(missed ? { syncNotice: "일부 연결의 불러오기는 시작하지 못했습니다. 시작한 작업은 계속 진행되며 나머지는 잠시 후 다시 시도해주세요." } : {}) };
}
export async function resumeArchiveSync(actor: string, jobId: string, adminRetry = false) {
  const admin = createAdminClient();
  let query = admin.from("music_archive_jobs").select("*").eq("id", jobId);
  if (!adminRetry) query = query.eq("owner_id", actor);
  const { data: job, error } = await query.maybeSingle();
  archiveDatabaseError(error);
  if (!job) throw new ArchiveError("수집 작업을 찾을 수 없습니다.", 404);
  syncPermission(job.provider);
  const library = await getOwnedLibrary(job.owner_id, job.library_id);
  if (library.archived_at || !library.data.connections.some(item => item.provider === job.provider && item.externalArtistId === job.external_artist_id && item.confirmed)) throw new ArchiveError("아티스트 연결이 변경되었습니다. 새 수집을 시작해주세요.", 409);
  if (job.status === "completed" || job.status === "cancelled") throw new ArchiveError("완료되거나 취소된 작업입니다. 새 동기화를 시작해주세요.", 409);
  if (job.status === "running" && job.lease_until && Date.parse(job.lease_until) > Date.now()) return { job, runLibraryId: library.id };
  if (Date.parse(job.available_at) > Date.now()) throw new ArchiveError("제공처의 재시도 대기 시간이 남았습니다. 잠시 후 이어서 수집해주세요.", 429, "RETRY_AFTER");
  const { data, error: updateError } = await admin.from("music_archive_jobs").update({ status: "queued", error_code: null, error_message: null, lease_token: null, lease_until: null, updated_at: new Date().toISOString() }).eq("id", job.id).eq("status", job.status).eq("updated_at", job.updated_at).select("*").maybeSingle();
  archiveDatabaseError(updateError);
  if (!data) throw new ArchiveError("작업 상태가 변경되었습니다. 새로고침해주세요.", 409);
  if (adminRetry) {
    const { error: auditError } = await admin.from("music_archive_events").insert({ owner_id: job.owner_id, library_id: job.library_id, actor_id: actor, action: "admin_retry", before_version: library.version, after_version: library.version, details: { job_id: job.id } });
    archiveDatabaseError(auditError);
  }
  return { job: data, runLibraryId: library.id };
}

/** One bounded API step per lease. after() and the optional worker share durable state. */
export async function runArchiveJob(libraryId?: string) {
  const admin = createAdminClient();
  const token = randomUUID();
  const { data, error } = await admin.rpc("lease_music_archive_job", { p_lease_token: token, p_library_id: libraryId ?? null });
  archiveDatabaseError(error);
  const job = (Array.isArray(data) ? data[0] : data) as ArchiveSyncJob | undefined;
  if (!job?.id) return false;
  try {
    const before = await getOwnedLibrary(job.owner_id, job.library_id);
    if (before.archived_at || !before.data.connections.some(item => item.provider === job.provider && item.externalArtistId === job.external_artist_id && item.confirmed)) throw new ArchiveError("연결이 변경되어 수집이 취소되었습니다.", 409, "CONNECTION_CHANGED");
    const cursor = job.cursor.providerCursor ? job.cursor.providerCursor as unknown as MusicBrainzCursor : null;
    const releaseIds = new Set(Array.isArray(job.cursor.releaseIds) ? job.cursor.releaseIds as string[] : []);
    syncPermission(job.provider);
    const step = job.provider === "apple"
      ? await collectAppleStep(job.external_artist_id, job.cursor.providerCursor as unknown as AppleCursor ?? null, { acquirePermit: () => acquireArchiveProviderPermit("apple") })
      : await collectMusicBrainzStep(job.external_artist_id, cursor, { acquirePermit: () => acquireArchiveProviderPermit("musicbrainz") });
    // Refetch after the network wait; optimistic commit still protects a concurrent edit.
    const library = await getOwnedLibrary(job.owner_id, job.library_id);
    const merged = mergeArchiveImports(library.data, step.releases, { combineManagedProfiles: library.data.connections.filter(item => item.provider === job.provider && item.confirmed).length > 1 });
    const connection = merged.connections.find(item => item.provider === job.provider && item.externalArtistId === job.external_artist_id);
    if (connection) { connection.checkedAt = step.checkedAt; connection.status = "automatic"; }
    for (const release of step.releases) {
      const payload: Record<string, unknown> = Object.fromEntries(Object.entries(release).filter(([key]) => key !== "participation" && key !== "tracks"));
      payload.tracks = release.tracks.map(track => Object.fromEntries(Object.entries(track).filter(([key]) => key !== "managedByArtist")));
      const { error: sourceError } = await admin.from("music_archive_sources").upsert({ provider: job.provider, external_id: release.externalId, kind: "release", payload, checked_at: step.checkedAt }, { onConflict: "provider,external_id,kind" });
      archiveDatabaseError(sourceError);
    }
    for (const release of step.releases) releaseIds.add(release.externalId);
    const managedReleaseIds = new Set(merged.releases.filter(item => item.source?.provider === job.provider && releaseIds.has(item.source.externalId)).map(item => item.id));
    const counts = { releases: releaseIds.size, tracks: merged.tracks.filter(item => managedReleaseIds.has(item.releaseId)).length, managedTracks: merged.tracks.filter(item => managedReleaseIds.has(item.releaseId) && item.managed && !item.excluded).length, steps: (job.counts.steps ?? 0) + 1, consecutiveErrors: 0 };
    const { error: commitError } = await admin.rpc("commit_music_archive_step", { p_job: job.id, p_token: token, p_version: library.version, p_data: merged, p_cursor: { providerCursor: step.nextCursor, releaseIds: [...releaseIds], scopeNote: step.scopeNote }, p_counts: counts, p_status: step.status === "completed" ? "completed" : "queued", p_checked_at: step.checkedAt });
    archiveDatabaseError(commitError);
    return true;
  } catch (error) {
    const code = error instanceof MusicProviderError ? error.code : error instanceof ArchiveError ? error.code : "SYNC_FAILED";
    const blocked = ["permission_required", "configuration_required"].includes(code);
    const cancelled = code === "CONNECTION_CHANGED";
    const retrySeconds = error instanceof MusicProviderError ? error.retryAfterSeconds ?? 30 : 15;
    const consecutiveErrors = (job.counts.consecutiveErrors ?? 0) + 1;
    const temporary = ["temporary_error", "rate_limited", "VERSION_CONFLICT"].includes(code);
    const message = error instanceof MusicProviderError || error instanceof ArchiveError ? error.message : "수집을 마치지 못했습니다. 저장된 범위부터 이어서 시도할 수 있습니다.";
    const { error: updateError } = await admin.from("music_archive_jobs").update({ status: cancelled ? "cancelled" : blocked ? "blocked" : temporary && consecutiveErrors < 3 ? "queued" : "partial", counts: { ...job.counts, consecutiveErrors }, error_code: code, error_message: message, available_at: new Date(Date.now() + retrySeconds * 1000).toISOString(), lease_token: null, lease_until: null, updated_at: new Date().toISOString() }).eq("id", job.id).eq("lease_token", token);
    archiveDatabaseError(updateError);
    return true;
  }
}

export async function runArchiveBatch(libraryId?: string, maximumSteps = 15) {
  const started = Date.now();
  for (let step = 0; step < maximumSteps && Date.now() - started < 45000; step++) if (!await runArchiveJob(libraryId)) break;
}
