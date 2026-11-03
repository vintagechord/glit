import type { ArchiveTask, ArchiveTrack } from "@/lib/music-archive/model";
import { getLocalStationLogoSource, stationLogoSources } from "@/lib/station-logos";
import { buildRejectedSongsLabel } from "@/lib/station-review-display";

export type ReviewStationEntry = { task: ArchiveTask; track?: ArchiveTrack };

export type ReviewStationRow = {
  agency: string;
  logoSrc: string | null;
  label: string;
  /** A bauhaus-status-chip tone, as ReviewResultControl expects. */
  tone: string;
  summary: string | null;
  entries: ReviewStationEntry[];
};

const isRejected = (task: ArchiveTask) => ["ineligible", "rejected"].includes(task.result);
const isEligible = (task: ArchiveTask) => task.result === "eligible";
const isInProgress = (task: ArchiveTask) => ["submitted", "processing", "preparing", "needs_changes"].includes(task.status);

const stationOrder = (agency: string) => {
  const source = getLocalStationLogoSource({ name: agency });
  const index = source ? stationLogoSources.indexOf(source) : -1;
  return index < 0 ? stationLogoSources.length : index;
};

/**
 * Review records of one album (or one song) folded per station, the way the
 * live status and result pages show a station (owner decision 2026-11-03):
 * an all-clear station reads "적격", any rejected song reads "N곡 부적격",
 * and the popup lists every song's record with its reason.
 */
export function groupReviewRecordsByStation(records: ArchiveTask[], tracks: ArchiveTrack[]): ReviewStationRow[] {
  const byAgency = new Map<string, ArchiveTask[]>();
  for (const task of records) {
    if (task.kind !== "review") continue;
    byAgency.set(task.agency, [...(byAgency.get(task.agency) ?? []), task]);
  }
  const trackIndex = new Map(tracks.map((track, index) => [track.id, index]));
  const songCount = Math.max(tracks.length, 1);
  return [...byAgency.entries()]
    .sort(([a], [b]) => stationOrder(a) - stationOrder(b) || a.localeCompare(b, "ko"))
    .map(([agency, tasks]) => {
      const entries = tasks
        .map((task) => ({ task, track: tracks.find((track) => track.id === task.trackId) }))
        .sort((a, b) => (trackIndex.get(a.task.trackId) ?? tracks.length) - (trackIndex.get(b.task.trackId) ?? tracks.length));
      // A song can hold several histories at one station; count songs, not records.
      const rejected = new Set(tasks.filter(isRejected).map((task) => task.trackId));
      const eligible = new Set(tasks.filter((task) => isEligible(task) && !rejected.has(task.trackId)).map((task) => task.trackId));
      const base = { agency, logoSrc: getLocalStationLogoSource({ name: agency })?.src ?? null, entries };
      if (rejected.size) {
        return { ...base, label: songCount > 1 ? buildRejectedSongsLabel(rejected.size) : "부적격", tone: "bauhaus-status-chip--danger", summary: null };
      }
      if (tasks.some(isInProgress)) {
        return { ...base, label: "심의 진행 중", tone: "bauhaus-status-chip--progress", summary: eligible.size ? `${eligible.size}곡 적격` : null };
      }
      if (eligible.size >= songCount) return { ...base, label: "적격", tone: "bauhaus-status-chip--success", summary: null };
      if (eligible.size) {
        return { ...base, label: `${eligible.size}곡 적격`, tone: "bauhaus-status-chip--info", summary: `${songCount - eligible.size}곡 미입력` };
      }
      const label = tasks.some((task) => task.status === "completed") ? "심의 완료" : tasks.every((task) => task.status === "not_started") ? "심의 미진행" : "확인 필요";
      return { ...base, label, tone: "bauhaus-status-chip--waiting", summary: null };
    });
}
