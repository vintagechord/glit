import { APP_CONFIG } from "@/lib/config";

export const metadata = {
  title: "About Us",
};

const requiredFields = [
  { label: "의뢰인", note: "담당자 성함" },
  { label: "기획사", note: "기획사명" },
  { label: "유통사", note: "유통사명" },
  { label: "연락처", note: "담당자 연락처" },
  { label: "이메일", note: "수신 가능한 이메일" },
  { label: "가수명", note: "한글/영문 모두 표기" },
  { label: "앨범명", note: "정확한 앨범명" },
  { label: "발매일", note: "정식 발매일" },
  { label: "장르", note: "주 장르 선택" },
  { label: "심의 요청 방송국", note: "패키지 또는 방송국 선택" },
  { label: "타이틀곡", note: "타이틀곡 지정" },
];

const lyricNotes = [
  "작곡 정보는 필수이며, 연주곡/Inst./MR인 경우 작사란은 비워두시면 됩니다.",
  "가사가 외국어가 있을 경우 미번역시 심의가 진행되지 않습니다. 간단한 영어라도 필히 번역하여 작성해주세요.",
  "컴필레이션 앨범의 경우 가사 입력란 상단에 각 트랙별 가수를 표기해주세요.",
  "10트랙 이상의 앨범은 신청서(한글/워드)로 작성하여 메일로 보내주세요.",
];

const cautionNotes = [
  "코러스, 나레이션, 반복하는 후렴을 포함하여 모든 가사를 수록해야 합니다.",
  "음원과 다르게 고의로 가사(욕설 및 선정성 문구 포함)를 누락하는 경우 심의가 불가하며, 향후 방송사에서 해당 음반기획사의 심의를 거부할 수 있습니다.",
  "외국어 가사에는 반드시 번역을 나란히 기재해주세요. (예: 10월이면 벌써 Red Light (번역 : 빨간 불))",
  "실물 CD가 있는 경우 심의 신청서와 곡 순서는 반드시 일치해야 합니다.",
];

const titleNotes = [
  "타이틀곡 지정해 주시고 4곡 이상의 앨범일 경우 원음방송 심의를 위해 3곡을 지정 해주세요. (원음방송은 앨범당 3곡만 심의가 가능합니다.)",
  "YTN과 평화방송의 경우 타이틀곡(1곡)만 심의 가능합니다.",
];

export default function AboutPage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-12">
      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
        About Us
      </p>
      <h1 className="font-display mt-2 text-3xl text-foreground">
        Onside 심의 접수 안내
      </h1>
      <p className="mt-3 text-sm text-muted-foreground">
        신청서 작성 및 심의 접수를 위한 핵심 정보를 정리했습니다. 필수 입력
        항목은 * 표시로 구분되며, 누락 시 접수가 지연될 수 있습니다.
      </p>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section className="rounded-[28px] border border-border/60 bg-card/80 p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            필수 입력 항목
          </p>
          <ul className="mt-4 space-y-3 text-sm text-muted-foreground">
            {requiredFields.map((item) => (
              <li key={item.label} className="flex flex-col gap-1">
                <span className="font-semibold text-foreground">
                  {item.label} <span className="text-rose-500">*</span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {item.note}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-[28px] border border-border/60 bg-card/80 p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            음원 정보 및 가사 입력
          </p>
          <ul className="mt-4 space-y-3 text-sm text-muted-foreground">
            {lyricNotes.map((note) => (
              <li key={note} className="list-disc pl-5">
                {note}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="rounded-[28px] border border-border/60 bg-card/80 p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            유의사항
          </p>
          <ul className="mt-4 space-y-3 text-sm text-muted-foreground">
            {cautionNotes.map((note) => (
              <li key={note} className="list-disc pl-5">
                {note}
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-[28px] border border-border/60 bg-card/80 p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            타이틀곡 및 원음방송
          </p>
          <ul className="mt-4 space-y-3 text-sm text-muted-foreground">
            {titleNotes.map((note) => (
              <li key={note} className="list-disc pl-5">
                {note}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="mt-8 rounded-[28px] border border-dashed border-border/60 bg-background/70 p-6 text-sm text-muted-foreground">
        작성된 신청서와 음원/자료는 이메일로 접수할 수 있습니다. 문의 또는
        접수 이메일: {" "}
        <span className="font-semibold text-foreground">
          {APP_CONFIG.supportEmail}
        </span>
      </div>
    </div>
  );
}
