import Link from "next/link";

import { APP_CONFIG } from "@/lib/config";

export const metadata = {
  title: "구버전 신청서 작성",
};

export default function FormsPage() {
  const albumForms = [
    {
      label: "HWP",
      title: "음반 심의 신청서 (한글)",
      href:
        "https://rwysjsmxtpuqekeltwxi.supabase.co/storage/v1/object/public/file/Onside_music_application_hangul_form(2026).hwp",
    },
    {
      label: "Word",
      title: "음반 심의 신청서 (Word)",
      href:
        "https://rwysjsmxtpuqekeltwxi.supabase.co/storage/v1/object/public/file/Onside_music_application_word_form(2026).doc",
    },
  ];

  const mvForms = [
    {
      label: "HWP",
      title: "뮤직비디오 심의 신청서 (한글)",
      href:
        "https://rwysjsmxtpuqekeltwxi.supabase.co/storage/v1/object/public/file/Onside_MVapplication_hangul_form(2026).hwp",
    },
    {
      label: "Word",
      title: "뮤직비디오 심의 신청서 (Word)",
      href:
        "https://rwysjsmxtpuqekeltwxi.supabase.co/storage/v1/object/public/file/Onside_MVapplication_word_form(2026).doc",
    },
  ];

  return (
    <div className="page-centered mx-auto w-full max-w-5xl px-6 py-12">
      <p className="bauhaus-kicker">이메일 접수</p>
      <h1 className="font-display mt-4 text-3xl font-black text-foreground">
        구버전 신청서 작성 방식
      </h1>
      <p className="mt-4 max-w-3xl text-base font-semibold leading-relaxed text-muted-foreground">
        온라인 접수가 어려울 때 신청서 파일을 작성해 이메일로 보내는 대체 접수입니다.
        <span className="mt-2 block">
          온라인 신청과 중복으로 진행하지 말고, 작성한 신청서와 음원/영상을{" "}
          <span className="font-semibold text-foreground">
            이메일로 보내주세요.
          </span>{" "}
        </span>
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Link
          href="https://onside17.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-[8px] border-2 border-[#111111] bg-white px-5 py-2 text-xs font-black uppercase tracking-normal text-[#111111] shadow-[3px_3px_0_#111111] transition hover:-translate-y-0.5 hover:bg-[#f2cf27] hover:shadow-[5px_5px_0_#111111] dark:border-[#f2cf27] dark:bg-[#171717] dark:text-white dark:shadow-[3px_3px_0_#f2cf27]"
        >
          구버전 사이트에서 접수
          <span aria-hidden>↗</span>
        </Link>
        <span className="text-xs text-muted-foreground">
          진행 현황과 결제 기록 관리는 온라인 접수가 더 빠릅니다.
        </span>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section className="group relative overflow-hidden rounded-[10px] border-2 border-[#111111] bg-card p-6 text-foreground shadow-[6px_6px_0_#111111] transition hover:-translate-y-1 dark:border-[#f2cf27] dark:shadow-[6px_6px_0_#f2cf27]">
          <div aria-hidden="true" className="absolute right-0 top-0 h-12 w-12 bg-[#f2cf27]" />
          <p className="text-xs font-black uppercase tracking-normal text-muted-foreground">
            음반 심의
          </p>
          <h2 className="mt-3 text-xl font-black">
            음반 심의 신청서
          </h2>
          <p className="mt-2 text-sm font-semibold text-muted-foreground">
            신청서 파일을 받아 작성하세요.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            {albumForms.map((form) => (
              <Link
                key={form.href}
                href={form.href}
                className="inline-flex rounded-[8px] border-2 border-[#111111] bg-white px-5 py-2 text-xs font-black uppercase tracking-normal text-[#111111] transition hover:-translate-y-0.5 hover:bg-[#f2cf27]"
              >
                {form.label} 다운로드
              </Link>
            ))}
          </div>
        </section>

        <section className="group relative overflow-hidden rounded-[10px] border-2 border-[#111111] bg-card p-6 text-foreground shadow-[6px_6px_0_#111111] transition hover:-translate-y-1 dark:border-[#f2cf27] dark:shadow-[6px_6px_0_#f2cf27]">
          <div aria-hidden="true" className="absolute right-0 top-0 h-12 w-12 bg-[#1556a4]" />
          <p className="text-xs font-black uppercase tracking-normal text-muted-foreground">
            뮤직비디오 심의
          </p>
          <h2 className="mt-3 text-xl font-black">
            뮤직비디오 심의 신청서
          </h2>
          <p className="mt-2 text-sm font-semibold text-muted-foreground">
            신청서 파일을 받아 작성하세요.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            {mvForms.map((form) => (
              <Link
                key={form.href}
                href={form.href}
                className="inline-flex rounded-[8px] border-2 border-[#111111] bg-white px-5 py-2 text-xs font-black uppercase tracking-normal text-[#111111] transition hover:-translate-y-0.5 hover:bg-[#f2cf27]"
              >
                {form.label} 다운로드
              </Link>
            ))}
          </div>
        </section>
      </div>

      <div className="mt-8 rounded-[10px] border-2 border-[#111111] bg-[#f2cf27] p-6 text-sm text-black shadow-[6px_6px_0_#111111] dark:shadow-[6px_6px_0_#f2cf27]">
        <div className="flex flex-wrap items-start gap-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-[8px] border-2 border-[#111111] bg-white text-base font-black text-black live-blink">
            !
          </div>
          <div className="space-y-2">
            <p className="text-xs font-black uppercase tracking-normal text-black">
              필독
            </p>
            <p className="text-sm font-semibold text-slate-900">
              작성 완료된 신청서와 음원/영상 파일을 이메일{" "}
              <span className="font-bold text-slate-900">
                {APP_CONFIG.supportEmail}
              </span>
              로 보내주시면 접수 안내를 드립니다.
            </p>
            <p className="text-xs text-black/80">
              신청서와 음원/영상 파일을 모두 보내셔야 접수가 가능합니다.
            </p>
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-4 rounded-[10px] border-2 border-[#111111] bg-card p-6 shadow-[6px_6px_0_#111111] dark:border-[#f2cf27] dark:shadow-[6px_6px_0_#f2cf27] lg:grid-cols-2">
        <div>
          <p className="text-xs font-black uppercase tracking-normal text-muted-foreground">
            메일 제목 템플릿
          </p>
          <div className="mt-3 space-y-2 text-sm font-semibold text-foreground">
            <p>[음반심의 신청] 아티스트명 / 앨범명 / 신청자명</p>
            <p>[뮤직비디오심의 신청] 아티스트명 / 곡명 / 온라인용 또는 TV송출용</p>
          </div>
        </div>
        <div>
          <p className="text-xs font-black uppercase tracking-normal text-muted-foreground">
            첨부 체크리스트
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs font-black text-foreground">
            {[
              "신청서",
              "음원 WAV",
              "가사",
              "번역 가사",
              "영상 파일",
              "사업자등록증/세금계산서 정보",
              "연락처",
            ].map((item) => (
              <span
                key={item}
                className="rounded-[6px] border-2 border-border bg-background px-3 py-1"
              >
                {item}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
