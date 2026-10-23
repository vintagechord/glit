export type BroadcastSpecFields = {
  format?: string[];
  codec?: string[];
  resolution?: string;
  fps?: string;
  maxSize?: string;
  duration?: string;
  note?: string;
};

export type BroadcastSpec = {
  id: string;
  title: string;
  summaryBadges: string[];
  fields: BroadcastSpecFields;
  source?: { label: string; url: string };
};

export const broadcastSpecs: BroadcastSpec[] = [
  {
    id: "KBS",
    title: "KBS",
    summaryBadges: ["공식 참고 규격", "MOV/MXF", "≤1.5GB", "1분~1분30초"],
    source: { label: "RIAK 공식 FAQ · 2026-04-20", url: "https://review.riak.or.kr/community.asp?inx=3" },
    fields: {
      format: ["MOV", "MXF"],
      codec: ["MOV: Apple ProRes LT / 422 / HQ", "MXF: XDCAM / MPEG Video HD422"],
      resolution: "1920×1080",
      fps: "29.97i (인터레이스)",
      maxSize: "1.5GB 이하",
      duration: "1분 이상~1분30초 이하",
      note: "온사이드는 직접 접수합니다. 아래 규격은 RIAK 안내 기준이며 음원 심의 적격을 선행 조건으로 안내합니다. 온사이드 직접 접수 경로의 적용 규격은 담당자 확인이 필요합니다. MXF는 현재 사이트 업로드 대상이 아니므로 이메일 제출을 이용해주세요.",
    },
  },
  {
    id: "MBC",
    title: "MBC",
    summaryBadges: ["MOV", "1920×1080", "29.97fps", "≤4GB"],
    fields: {
      format: ["MOV"],
      resolution: "1920×1080",
      fps: "29.97fps",
      maxSize: "4GB 이하",
    },
  },
  {
    id: "SBS",
    title: "SBS",
    summaryBadges: ["MOV/MP4/WMV", "1920×1080", "29.97fps"],
    fields: {
      format: ["MOV", "MP4", "WMV"],
      resolution: "1920×1080",
      fps: "29.97fps",
    },
  },
];

export const kbsMvPurposeNote = `공식 참고: ${broadcastSpecs[0].fields.duration} 편집본 · ${broadcastSpecs[0].fields.maxSize}. 접수 경로별 규격은 담당자 확인이 필요합니다.`;

export const getSelectedBroadcastSpecs = (stationCodes: readonly string[]) =>
  broadcastSpecs.filter((spec) => stationCodes.includes(spec.id));
