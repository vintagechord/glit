import Link from "next/link";

import type { AlbumStationProgress } from "@/lib/admin/album-station-progress";
import { stationResultsAnchor, stationReviewAnchor } from "@/lib/admin/station-anchors";
import { brandStatusTones } from "@/lib/brand-status-tones";

/**
 * The stations of a paid album that have a result (above, owner request
 * 2026-11-26) and those that still have none, each linking to its form on the
 * application page. 적격 reads as a green chip, a refusal names itself in red.
 * Nothing is shown once every result is in.
 */
export function PendingStationStrip({
  progress,
  detailHref,
}: {
  progress: AlbumStationProgress | undefined;
  detailHref: string;
}) {
  if (!progress || progress.pending.length === 0) return null;
  const noneEntered = progress.completed === 0;
  const chip = "inline-flex min-h-7 items-center gap-1 rounded-[6px] border-2 px-2 py-0.5 text-[11px] font-black transition hover:-translate-y-0.5";
  return (
    <div className="mt-3 grid min-w-0 gap-2 border-t-2 border-dashed border-border pt-3">
      {progress.entered.length > 0 ? (
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11px] font-black text-foreground">
            결과 입력 {progress.entered.length}곳
          </span>
          {progress.entered.map((station) => (
            <Link
              key={`${station.code ?? station.name}`}
              prefetch={false}
              href={`${detailHref}#${stationReviewAnchor(station.code)}`}
              title={`${station.name} · ${station.label}`}
              className={`${chip} ${station.rejected ? brandStatusTones.danger : brandStatusTones.success}`}
            >
              <span>{station.shortName}</span>
              {station.rejected ? <span className="font-semibold">· {station.label}</span> : null}
            </Link>
          ))}
        </div>
      ) : null}
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[11px] font-black text-foreground">
          결과 미입력 {progress.pending.length}곳
          <span className="ml-1 font-semibold text-muted-foreground">
            ({progress.completed}/{progress.total} 입력)
          </span>
        </span>
        {noneEntered ? (
          <Link
            prefetch={false}
            href={`${detailHref}#${stationResultsAnchor}`}
            className={`${chip} ${brandStatusTones.neutral}`}
          >
            전체 방송사
          </Link>
        ) : (
          progress.pending.map((station) => (
            <Link
              key={`${station.code ?? station.name}`}
              prefetch={false}
              href={`${detailHref}#${stationReviewAnchor(station.code)}`}
              title={station.attention ? `${station.name} · ${station.attention}` : `${station.name} 결과 입력`}
              className={`${chip} ${station.attention ? brandStatusTones.danger : brandStatusTones.warning}`}
            >
              <span>{station.shortName}</span>
              {station.attention ? <span className="font-semibold">· {station.attention}</span> : null}
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
