import Link from "next/link";

import { APP_CONFIG } from "@/lib/config";

export const metadata = {
  title: "구버전(이메일) 접수",
};

const albumForms = [
  {
    label: "HWP",
    title: "음반 심의 신청서",
    href:
      "https://rwysjsmxtpuqekeltwxi.supabase.co/storage/v1/object/public/file/Onside_music_application_hangul_form(2026).hwp",
  },
  {
    label: "Word",
    title: "음반 심의 신청서",
    href:
      "https://rwysjsmxtpuqekeltwxi.supabase.co/storage/v1/object/public/file/Onside_music_application_word_form(2026).doc",
  },
];

const mvForms = [
  {
    label: "HWP",
    title: "M/V 심의 신청서",
    href:
      "https://rwysjsmxtpuqekeltwxi.supabase.co/storage/v1/object/public/file/Onside_MVapplication_hangul_form(2026).hwp",
  },
  {
    label: "Word",
    title: "M/V 심의 신청서",
    href:
      "https://rwysjsmxtpuqekeltwxi.supabase.co/storage/v1/object/public/file/Onside_MVapplication_word_form(2026).doc",
  },
];

const formGroups = [
  {
    eyebrow: "음반 심의",
    title: "음반 심의 신청서",
    description: "음반 심의용 신청서를 내려받습니다.",
    forms: albumForms,
  },
  {
    eyebrow: "M/V 심의",
    title: "M/V 심의 신청서",
    description: "뮤직비디오 심의용 신청서를 내려받습니다.",
    forms: mvForms,
  },
];

export default function FormsPage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
      <p className="text-sm font-semibold text-[#2f6f9f]">
        Legacy Email Submission
      </p>
      <h1 className="mt-3 text-2xl font-semibold text-[#2f3a4d] sm:text-3xl">
        구버전(이메일) 접수
      </h1>
      <p className="mt-3 max-w-2xl break-keep text-sm leading-6 text-[#667085]">
        신청서를 내려받아 작성한 뒤 이메일로 보내는 방식입니다. 온라인 접수와
        동일하게 심의가 진행됩니다.
      </p>

      <div className="mt-7 grid gap-4 lg:grid-cols-2">
        {formGroups.map((group) => (
          <section
            key={group.title}
            className="rounded-[8px] border border-[#d8e1ef] bg-white p-5 sm:p-6"
          >
            <p className="text-xs font-semibold text-[#667085]">
              {group.eyebrow}
            </p>
            <h2 className="mt-3 text-xl font-semibold text-[#2f3a4d]">
              {group.title}
            </h2>
            <p className="mt-2 text-sm leading-6 text-[#667085]">
              {group.description}
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              {group.forms.map((form) => (
                <Link
                  key={form.href}
                  href={form.href}
                  className="inline-flex h-10 items-center rounded-[8px] border border-[#c9d6e8] px-4 text-sm font-semibold text-[#2f3a4d] transition hover:border-[#2f6f9f] hover:text-[#2f6f9f]"
                >
                  {form.label} 다운로드
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>

      <div className="mt-5 rounded-[8px] border border-[#cbdde8] bg-[#edf4f7] p-5 text-sm leading-6 text-[#526071]">
        <p className="font-semibold text-[#2f3a4d]">이메일 접수 방법</p>
        <p className="mt-1">
          작성한 신청서와 음원/영상 파일을{" "}
          <a
            href={`mailto:${APP_CONFIG.supportEmail}`}
            className="font-semibold text-[#2f6f9f] underline underline-offset-2"
          >
            {APP_CONFIG.supportEmail}
          </a>
          로 보내주세요.
        </p>
      </div>
    </div>
  );
}
