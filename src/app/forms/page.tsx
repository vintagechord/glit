import Link from "next/link";

import { APP_CONFIG } from "@/lib/config";

export const metadata = {
  title: "신청서(구양식)",
};

export default function FormsPage() {
  const albumForms = [
    {
      label: "HWP",
      title: "음반 심의 신청서 (한글)",
      href: "/forms/Onside_music_application_hangul_form.hwp",
    },
    {
      label: "Word",
      title: "음반 심의 신청서 (Word)",
      href: "/forms/Onside_music_application_word_form.doc",
    },
  ];

  const mvForms = [
    {
      label: "HWP",
      title: "M/V 심의 신청서 (한글)",
      href: "/forms/Onside_MVapplication_hangul_form.hwp",
    },
    {
      label: "Word",
      title: "M/V 심의 신청서 (Word)",
      href: "/forms/Onside_MVapplication_word_form.doc",
    },
  ];

  const albumRequired = [
    "의뢰인 *",
    "기획사 *",
    "유통사 *",
    "연락처 *",
    "이메일 *",
    "가수명 *",
    "앨범명 *",
    "발매일 *",
    "장르 *",
    "심의 요청 방송국 *",
    "타이틀곡 지정 *",
  ];

  const mvRequired = [
    "의뢰인 *",
    "기획사 *",
    "연락처 *",
    "이메일 *",
    "MV 제목 *",
    "아티스트명 *",
    "러닝타임 *",
    "파일 포맷 *",
    "심의 목적/방송국 선택 *",
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
    "타이틀곡 지정해 주시고 4곡 이상의 앨범일 경우 원음방송 심의를 위해 3곡을 지정 해주세요. (원음방송은 앨범당 3곡만 심의가 가능합니다.)",
    "YTN과 평화방송의 경우 타이틀곡(1곡)만 심의 가능합니다.",
  ];

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-12">
      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
        Forms
      </p>
      <h1 className="font-display mt-2 text-3xl text-foreground">
        신청서(구양식) 다운로드 및 이메일 접수
      </h1>
      <p className="mt-3 text-sm text-muted-foreground">
        온라인 신청이 어렵거나 번거로운 경우, 신청서를 내려받아 작성 후 이메일로
        접수할 수 있습니다. 음반 심의와 M/V 심의를 구분해 다운로드하세요.
      </p>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section className="rounded-[28px] border border-border/60 bg-card/80 p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            음반 심의
          </p>
          <h2 className="mt-3 text-xl font-semibold text-foreground">
            음반 심의 신청서
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            음반 심의용 신청서를 다운로드하여 작성하세요.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            {albumForms.map((form) => (
              <Link
                key={form.href}
                href={form.href}
                className="inline-flex rounded-full bg-foreground px-5 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-background"
              >
                {form.label} 다운로드
              </Link>
            ))}
          </div>
          <div className="mt-6 rounded-2xl border border-border/60 bg-background/70 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              필수 입력 항목 (*)
            </p>
            <ul className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
              {albumRequired.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </section>

        <section className="rounded-[28px] border border-border/60 bg-card/80 p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            M/V 심의
          </p>
          <h2 className="mt-3 text-xl font-semibold text-foreground">
            M/V 심의 신청서
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            M/V 심의용 신청서를 다운로드하여 작성하세요.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            {mvForms.map((form) => (
              <Link
                key={form.href}
                href={form.href}
                className="inline-flex rounded-full bg-foreground px-5 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-background"
              >
                {form.label} 다운로드
              </Link>
            ))}
          </div>
          <div className="mt-6 rounded-2xl border border-border/60 bg-background/70 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              필수 입력 항목 (*)
            </p>
            <ul className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
              {mvRequired.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </section>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
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
      </div>

      <div className="mt-8 rounded-[28px] border border-dashed border-border/60 bg-background/70 p-6 text-sm text-muted-foreground">
        작성 완료된 신청서와 음원/영상 파일을 이메일{" "}
        <span className="font-semibold text-foreground">
          {APP_CONFIG.supportEmail}
        </span>
        로 보내주시면 접수 안내를 드립니다.
      </div>
    </div>
  );
}
