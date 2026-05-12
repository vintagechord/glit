import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  Disc3,
  Film,
  FileText,
  Search,
} from "lucide-react";

import { TrackLookupModalTrigger } from "@/features/track/track-lookup-modal";

const primaryTasks = [
  {
    title: "음반 심의 신청",
    description: "앨범 정보, 수록곡, 음원 파일을 제출합니다.",
    href: "/dashboard/new/album",
    icon: Disc3,
    meta: "방송국 패키지 선택",
  },
  {
    title: "뮤비 심의 신청",
    description: "온라인 업로드용 또는 방송 송출용 MV 심의를 접수합니다.",
    href: "/dashboard/new/mv",
    icon: Film,
    meta: "영상 파일 제출",
  },
];

const resultRows = [
  {
    label: "접수 현황",
    value: "진행중인 심의와 결제 상태 확인",
  },
  {
    label: "방송국별 결과",
    value: "접수 상태, 트랙 결과, 수정 요청 확인",
  },
  {
    label: "비회원 조회",
    value: "접수 완료 시 받은 코드로 확인",
  },
];

const compactProcess = [
  "신청서 작성",
  "파일 제출",
  "결제 확인",
  "결과 안내",
];

export default function Home() {
  return (
    <div className="bg-[#fbfcfe]">
      <section className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-10 sm:px-6 sm:py-14 lg:grid-cols-[0.95fr_1.05fr] lg:items-start">
        <div className="pt-2">
          <p className="text-sm font-semibold text-[#1268b3]">
            ONSIDE REVIEW SYSTEM
          </p>
          <h1 className="mt-4 break-keep text-3xl font-semibold leading-tight text-[#26324a] sm:text-5xl">
            심의 신청과 결과 확인에 집중합니다
          </h1>
          <p className="mt-5 max-w-xl break-keep text-base leading-7 text-[#667085]">
            필요한 메뉴만 먼저 보여드립니다. 음반 심의, 뮤직비디오 심의,
            결과 확인으로 바로 이동하세요.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/dashboard/new"
              className="inline-flex h-12 items-center justify-center rounded-[8px] bg-[#1268b3] px-5 text-sm font-semibold text-white transition hover:bg-[#0f5797]"
            >
              심의 신청
              <ArrowRight className="ml-2 h-4 w-4" aria-hidden />
            </Link>
            <Link
              href="/dashboard"
              className="inline-flex h-12 items-center justify-center rounded-[8px] border border-[#c9d6e8] bg-white px-5 text-sm font-semibold text-[#26324a] transition hover:border-[#1268b3] hover:text-[#1268b3]"
            >
              결과 확인
            </Link>
          </div>
        </div>

        <div className="rounded-[8px] border border-[#d8e1ef] bg-white">
          <div className="border-b border-[#e4e9f2] px-5 py-4 sm:px-6">
            <h2 className="text-lg font-semibold text-[#26324a]">
              심의 접수
            </h2>
          </div>
          <div className="divide-y divide-[#edf1f7]">
            {primaryTasks.map((task) => {
              const Icon = task.icon;
              return (
                <Link
                  key={task.href}
                  href={task.href}
                  className="group grid gap-4 px-5 py-5 transition hover:bg-[#f7fbff] sm:grid-cols-[48px_minmax(0,1fr)_auto] sm:items-center sm:px-6"
                >
                  <span className="flex h-12 w-12 items-center justify-center rounded-[8px] bg-[#eef6ff] text-[#1268b3]">
                    <Icon className="h-6 w-6" aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-base font-semibold text-[#26324a]">
                      {task.title}
                    </span>
                    <span className="mt-1 block break-keep text-sm leading-6 text-[#667085]">
                      {task.description}
                    </span>
                  </span>
                  <span className="inline-flex items-center gap-2 text-sm font-semibold text-[#1268b3]">
                    {task.meta}
                    <ArrowRight
                      className="h-4 w-4 transition group-hover:translate-x-0.5"
                      aria-hidden
                    />
                  </span>
                </Link>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#e4e9f2] bg-[#fbfcfe] px-5 py-4 text-sm sm:px-6">
            <Link
              href="/dashboard/new/album?mode=oneclick"
              className="font-semibold text-[#526071] transition hover:text-[#1268b3]"
            >
              원클릭 음반 접수
            </Link>
            <Link
              href="/forms"
              className="font-semibold text-[#526071] transition hover:text-[#1268b3]"
            >
              이메일 접수 서식
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-6xl gap-6 px-4 pb-14 sm:px-6 lg:grid-cols-[1fr_0.8fr]">
        <div className="rounded-[8px] border border-[#d8e1ef] bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e4e9f2] px-5 py-4 sm:px-6">
            <div>
              <h2 className="text-lg font-semibold text-[#26324a]">
                결과 안내
              </h2>
              <p className="mt-1 text-sm text-[#667085]">
                접수 이후에는 진행 상태와 결과만 빠르게 확인할 수 있습니다.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href="/dashboard"
                className="inline-flex h-10 items-center rounded-[8px] bg-[#1268b3] px-4 text-sm font-semibold text-white transition hover:bg-[#0f5797]"
              >
                내 접수 현황
              </Link>
              <TrackLookupModalTrigger
                label="비회원 코드 조회"
                modalTitle="비회원 코드 입력"
                className="inline-flex h-10 items-center rounded-[8px] border border-[#c9d6e8] bg-white px-4 text-sm font-semibold text-[#26324a] transition hover:border-[#1268b3] hover:text-[#1268b3]"
              />
            </div>
          </div>

          <div className="divide-y divide-[#edf1f7]">
            {resultRows.map((row) => (
              <div
                key={row.label}
                className="grid gap-2 px-5 py-4 text-sm sm:grid-cols-[150px_minmax(0,1fr)] sm:px-6"
              >
                <span className="font-semibold text-[#26324a]">{row.label}</span>
                <span className="text-[#667085]">{row.value}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-[8px] border border-[#d8e1ef] bg-white px-5 py-5 sm:px-6">
          <div className="flex items-center gap-2 text-sm font-semibold text-[#1268b3]">
            <ClipboardList className="h-4 w-4" aria-hidden />
            접수 흐름
          </div>
          <ol className="mt-4 space-y-3">
            {compactProcess.map((item, index) => (
              <li
                key={item}
                className="flex items-center gap-3 text-sm text-[#526071]"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#eef6ff] text-xs font-semibold text-[#1268b3]">
                  {index + 1}
                </span>
                <span className="font-medium text-[#26324a]">{item}</span>
                {index === compactProcess.length - 1 ? (
                  <CheckCircle2 className="ml-auto h-4 w-4 text-[#1f9d6a]" aria-hidden />
                ) : null}
              </li>
            ))}
          </ol>
          <div className="mt-5 rounded-[8px] bg-[#f7fbff] px-4 py-3 text-sm leading-6 text-[#667085]">
            <div className="flex items-start gap-2">
              <FileText className="mt-1 h-4 w-4 shrink-0 text-[#1268b3]" aria-hidden />
              <p>
                로그인 접수는 마이페이지에 자동 저장되고, 비회원 접수는 조회
                코드로 확인할 수 있습니다.
              </p>
            </div>
            <div className="mt-3 flex items-start gap-2">
              <Search className="mt-1 h-4 w-4 shrink-0 text-[#1268b3]" aria-hidden />
              <p>
                방송국별 접수 상태와 승인/수정 요청 결과는 접수 현황에서
                확인하세요.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
