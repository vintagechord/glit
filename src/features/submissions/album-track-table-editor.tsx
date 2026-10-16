"use client";

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
}: AlbumTrackTableEditorProps<TTrack>) {
  return (
    <section aria-labelledby="album-track-table-title" className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 id="album-track-table-title" className="text-sm font-black text-foreground">
            트랙 빠른 입력
          </h3>
          <p className="mt-1 text-xs font-semibold text-muted-foreground">
            곡별 정보를 입력하고, 가사와 타이틀 설정은 상세 편집에서 입력합니다.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {tracks.length > 1 ? (
            <button
              type="button"
              onClick={onApplyCurrentCredits}
              className="min-h-11 rounded-full border-2 border-border bg-background px-3 py-2 text-xs font-black text-foreground transition hover:border-foreground"
            >
              빈 참여진 채우기
            </button>
          ) : null}
          <button
            type="button"
            onClick={onAddWithCredits}
            className="min-h-11 rounded-full border-2 border-foreground bg-foreground px-3 py-2 text-xs font-black text-background transition hover:-translate-y-0.5 hover:bg-[#f2cf27] hover:text-[#111111]"
          >
            같은 참여진으로 추가
          </button>
          <button
            type="button"
            onClick={onAddBlank}
            className="min-h-11 rounded-full border-2 border-dashed border-border bg-background px-3 py-2 text-xs font-black text-muted-foreground transition hover:border-foreground hover:text-foreground"
          >
            빈 트랙 추가
          </button>
        </div>
      </div>

      <div
        className="min-w-0 max-w-full rounded-[14px] focus:outline-none focus-visible:ring-2 focus-visible:ring-ring md:overflow-x-auto md:border-2 md:border-[#111111] md:bg-background dark:md:border-[#f2cf27]"
        role="region"
        aria-label="트랙 표 입력"
        tabIndex={0}
      >
        <table className="block w-full text-left text-xs md:table md:min-w-[980px] md:border-collapse">
          <caption className="sr-only">
            트랙별 곡명, 가수명, 작곡, 작사, 편곡 빠른 입력
          </caption>
          <thead className="hidden bg-foreground text-background md:table-header-group">
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
          <tbody className="grid gap-4 md:table-row-group">
            {tracks.map((track, index) => {
              const active = index === activeIndex;
              return (
                <tr
                  key={rowKeys[index] ?? `track-row-${index}`}
                  className={`grid min-w-0 grid-cols-1 gap-3 rounded-[14px] border-2 border-border/70 p-3 sm:grid-cols-2 md:table-row md:rounded-none md:border-0 md:border-t md:p-0 ${active ? "bg-[#f2cf27]/14" : "bg-background"}`}
                >
                  <th scope="row" className="col-span-full text-left font-black text-foreground md:px-3 md:py-2 md:text-center">
                    <span className="md:hidden">트랙 </span>{index + 1}
                  </th>
                  {columns.map((column) => (
                    <td key={column.field} className="block min-w-0 md:table-cell md:px-1.5 md:py-2">
                      <span aria-hidden="true" className="mb-1.5 block font-semibold text-muted-foreground md:hidden">
                        {column.label}{column.field === "lyricist" || column.field === "arranger" ? "" : " *"}
                      </span>
                      <input
                        value={track[column.field]}
                        onFocus={() => onSelect(index)}
                        onChange={(event) => onUpdate(index, column.field, event.target.value)}
                        aria-label={`${index + 1}번 트랙 ${column.label}`}
                        data-preflight-field={column.field}
                        data-track-index={index}
                        className="h-11 min-w-0 w-full rounded-[8px] border border-border/80 bg-card px-2.5 text-base text-foreground outline-none transition focus:border-foreground md:h-10 md:text-sm"
                      />
                    </td>
                  ))}
                  <td className="col-span-full block md:table-cell md:px-2 md:py-2">
                    <div className="flex flex-wrap items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => onMove(index, index - 1)}
                        disabled={index === 0}
                        aria-label={`${index + 1}번 트랙 위로 이동`}
                        className="h-11 min-w-11 rounded-[8px] border border-border px-2 font-black disabled:opacity-30 md:h-9 md:min-w-0"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => onMove(index, index + 1)}
                        disabled={index === tracks.length - 1}
                        aria-label={`${index + 1}번 트랙 아래로 이동`}
                        className="h-11 min-w-11 rounded-[8px] border border-border px-2 font-black disabled:opacity-30 md:h-9 md:min-w-0"
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        aria-current={active ? "true" : undefined}
                        onClick={() => onSelect(index)}
                        className={`h-11 min-w-11 rounded-[8px] border-2 px-2.5 font-black md:h-9 md:min-w-0 ${active ? "border-[#111111] bg-[#f2cf27] text-[#111111]" : "border-border bg-background text-foreground"}`}
                      >
                        상세
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemove(index)}
                        disabled={tracks.length === 1}
                        aria-label={`${index + 1}번 트랙 삭제`}
                        className="h-11 min-w-11 rounded-[8px] border-2 border-foreground/60 bg-card px-2 font-semibold text-foreground transition enabled:hover:border-foreground enabled:hover:bg-foreground enabled:hover:text-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-30 md:h-9 md:min-w-0"
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
