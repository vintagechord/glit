"use client";

import * as React from "react";

import {
  parseAlbumTrackTablePaste,
  type AlbumTrackPasteRow,
} from "@/lib/album-track-table";

export type AlbumTrackTableRow = {
  trackTitle: string;
  performer: string;
  featuring: string;
  composer: string;
  lyricist: string;
  arranger: string;
  isTitle: boolean;
  titleRole: "" | "MAIN" | "SUB";
  broadcastSelected: boolean;
};

type EditableField =
  | "trackTitle"
  | "performer"
  | "composer"
  | "lyricist"
  | "arranger";

type AlbumTrackTableEditorProps<TTrack extends AlbumTrackTableRow> = {
  tracks: readonly TTrack[];
  rowKeys: readonly string[];
  activeIndex: number;
  onSelect: (index: number) => void;
  onUpdate: (index: number, field: EditableField, value: string) => void;
  onAddWithCredits: () => void;
  onAddBlank: () => void;
  onApplyCurrentCredits: () => void;
  onRemove: (index: number) => void;
  onMove: (fromIndex: number, toIndex: number) => void;
  onPaste: (rows: readonly AlbumTrackPasteRow[], startIndex: number) => void;
};

const columns: Array<{ field: EditableField; label: string; width: string }> = [
  { field: "trackTitle", label: "곡명", width: "min-w-[190px]" },
  { field: "performer", label: "가수명", width: "min-w-[150px]" },
  { field: "composer", label: "작곡", width: "min-w-[140px]" },
  { field: "lyricist", label: "작사", width: "min-w-[140px]" },
  { field: "arranger", label: "편곡", width: "min-w-[140px]" },
];

export function AlbumTrackTableEditor<TTrack extends AlbumTrackTableRow>({
  tracks,
  rowKeys,
  activeIndex,
  onSelect,
  onUpdate,
  onAddWithCredits,
  onAddBlank,
  onApplyCurrentCredits,
  onRemove,
  onMove,
  onPaste,
}: AlbumTrackTableEditorProps<TTrack>) {
  const [pasteText, setPasteText] = React.useState("");
  const parsedPaste = React.useMemo(
    () => parseAlbumTrackTablePaste(pasteText),
    [pasteText],
  );

  const applyPaste = () => {
    if (parsedPaste.rows.length === 0) return;
    onPaste(parsedPaste.rows, 0);
    setPasteText("");
  };

  return (
    <section aria-labelledby="album-track-table-title" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 id="album-track-table-title" className="text-sm font-black text-foreground">
            트랙 빠른 입력
          </h3>
          <p className="mt-1 text-xs font-semibold text-muted-foreground">
            곡별 값은 표에서 비교하고, 가사와 타이틀 설정은 상세 편집에서 입력합니다.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {tracks.length > 1 ? (
            <button
              type="button"
              onClick={onApplyCurrentCredits}
              className="rounded-full border-2 border-border bg-background px-3 py-2 text-xs font-black text-foreground transition hover:border-foreground"
            >
              빈 참여진 채우기
            </button>
          ) : null}
          <button
            type="button"
            onClick={onAddWithCredits}
            className="rounded-full border-2 border-foreground bg-foreground px-3 py-2 text-xs font-black text-background transition hover:-translate-y-0.5 hover:bg-[#f2cf27] hover:text-[#111111]"
          >
            같은 참여진으로 추가
          </button>
          <button
            type="button"
            onClick={onAddBlank}
            className="rounded-full border-2 border-dashed border-border bg-background px-3 py-2 text-xs font-black text-muted-foreground transition hover:border-foreground hover:text-foreground"
          >
            빈 트랙 추가
          </button>
        </div>
      </div>

      <details className="rounded-[14px] border border-border/70 bg-background/60 px-4 py-3">
        <summary className="cursor-pointer text-xs font-black text-foreground">
          여러 트랙 붙여넣기
        </summary>
        <div className="mt-3 space-y-3">
          <p className="text-xs font-semibold leading-5 text-muted-foreground">
            Excel·Sheets의 곡명·가수명·작곡·작사·편곡 열을 그대로 붙여넣으세요. 입력된 열만 반영됩니다.
          </p>
          <textarea
            value={pasteText}
            onChange={(event) => setPasteText(event.target.value)}
            placeholder={"곡명\t가수명\t작곡\t작사\t편곡\n첫 번째 곡\t가수 A\t작곡가\t작사가\t편곡가"}
            className="min-h-32 w-full resize-y rounded-[12px] border-2 border-border bg-background px-3 py-3 font-mono text-sm text-foreground outline-none transition focus:border-foreground"
            aria-label="붙여넣을 트랙 표"
          />
          {parsedPaste.issues.length > 0 || parsedPaste.ignoredHeaders.length > 0 ? (
            <div className="rounded-[10px] border border-[#e7b900]/60 bg-[#f2cf27]/10 px-3 py-2 text-xs font-semibold text-foreground">
              {[...parsedPaste.issues, ...(parsedPaste.ignoredHeaders.length > 0
                ? [`반영하지 않는 열: ${parsedPaste.ignoredHeaders.join(", ")}`]
                : [])].join(" ")}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold text-muted-foreground">
              {parsedPaste.rows.length > 0
                ? `${parsedPaste.rows.length}개 트랙 확인`
                : "붙여넣은 내용이 여기에 반영됩니다."}
            </span>
            <button
              type="button"
              onClick={applyPaste}
              disabled={parsedPaste.rows.length === 0}
              className="rounded-full bg-foreground px-4 py-2 text-xs font-black text-background transition hover:bg-[#f2cf27] hover:text-[#111111] disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
            >
              표에 적용
            </button>
          </div>
        </div>
      </details>

      <div
        className="overflow-x-auto rounded-[14px] border-2 border-[#111111] bg-background focus:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:border-[#f2cf27]"
        role="region"
        aria-label="트랙 표 입력"
        tabIndex={0}
      >
        <table className="w-full min-w-[980px] border-collapse text-left text-xs">
          <caption className="sr-only">
            트랙별 곡명, 가수명, 작곡, 작사, 편곡 빠른 입력
          </caption>
          <thead className="bg-foreground text-background">
            <tr>
              <th scope="col" className="w-12 px-3 py-3 text-center font-black">#</th>
              {columns.map((column) => (
                <th key={column.field} scope="col" className={`${column.width} px-2 py-3 font-black`}>
                  {column.label}{column.field === "lyricist" || column.field === "arranger" ? "" : " *"}
                </th>
              ))}
              <th scope="col" className="min-w-[188px] px-3 py-3 text-right font-black">작업</th>
            </tr>
          </thead>
          <tbody>
            {tracks.map((track, index) => {
              const active = index === activeIndex;
              return (
                <tr
                  key={rowKeys[index] ?? `track-row-${index}`}
                  className={`border-t border-border/70 ${active ? "bg-[#f2cf27]/14" : "bg-background"}`}
                >
                  <th scope="row" className="px-3 py-2 text-center font-black text-foreground">
                    {index + 1}
                  </th>
                  {columns.map((column) => (
                    <td key={column.field} className="px-1.5 py-2">
                      <input
                        value={track[column.field]}
                        onFocus={() => onSelect(index)}
                        onChange={(event) => onUpdate(index, column.field, event.target.value)}
                        aria-label={`${index + 1}번 트랙 ${column.label}`}
                        data-preflight-field={column.field}
                        data-track-index={index}
                        className="h-10 w-full rounded-[8px] border border-border/80 bg-card px-2.5 text-sm text-foreground outline-none transition focus:border-foreground"
                      />
                    </td>
                  ))}
                  <td className="px-2 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => onMove(index, index - 1)}
                        disabled={index === 0}
                        aria-label={`${index + 1}번 트랙 위로 이동`}
                        className="h-9 rounded-[8px] border border-border px-2 font-black disabled:opacity-30"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => onMove(index, index + 1)}
                        disabled={index === tracks.length - 1}
                        aria-label={`${index + 1}번 트랙 아래로 이동`}
                        className="h-9 rounded-[8px] border border-border px-2 font-black disabled:opacity-30"
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        aria-current={active ? "true" : undefined}
                        onClick={() => onSelect(index)}
                        className={`h-9 rounded-[8px] border-2 px-2.5 font-black ${active ? "border-[#111111] bg-[#f2cf27] text-[#111111]" : "border-border bg-background text-foreground"}`}
                      >
                        상세
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemove(index)}
                        disabled={tracks.length === 1}
                        aria-label={`${index + 1}번 트랙 삭제`}
                        className="h-9 rounded-[8px] border border-rose-300 px-2 text-rose-700 disabled:opacity-30 dark:text-rose-200"
                      >
                        삭제
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
