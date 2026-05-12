import Link from "next/link";
import { ArrowRight, Disc3, Film } from "lucide-react";

import { ResultCheckButton } from "@/features/track/result-check-button";

const primaryTasks = [
  {
    title: "음반 심의 신청",
    description: "앨범 정보와 음원 파일을 제출합니다.",
    href: "/dashboard/new/album",
    icon: Disc3,
    meta: "음반 심의",
  },
  {
    title: "뮤비 심의 신청",
    description: "뮤직비디오 심의를 접수합니다.",
    href: "/dashboard/new/mv",
    icon: Film,
    meta: "뮤비 심의",
  },
];

export default function Home() {
  return (
    <div className="bg-[#fbfcfe]">
      <section className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-10 sm:px-6 sm:py-14 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
        <div className="pt-2">
          <p className="text-sm font-semibold text-[#2f6f9f]">
            ONSIDE REVIEW SYSTEM
          </p>
          <h1 className="mt-4 break-keep text-3xl font-semibold leading-tight text-[#2f3a4d] sm:text-5xl">
            음반, 뮤비 심의를 쉽고 빠르게!
          </h1>
          <p className="mt-5 max-w-xl break-keep text-base leading-7 text-[#667085]">
            신청하고, 결과를 확인하는 일에만 집중할 수 있게 정리했습니다.
          </p>
        </div>

        <div className="space-y-4">
          <div className="rounded-[8px] border border-[#d8e1ef] bg-white">
            <div className="border-b border-[#e4e9f2] px-5 py-4 sm:px-6">
              <h2 className="text-lg font-semibold text-[#2f3a4d]">
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
                    className="group grid gap-4 px-5 py-5 transition hover:bg-[#f7fafc] sm:grid-cols-[48px_minmax(0,1fr)_auto] sm:items-center sm:px-6"
                  >
                    <span className="flex h-12 w-12 items-center justify-center rounded-[8px] bg-[#edf4f7] text-[#2f6f9f]">
                      <Icon className="h-6 w-6" aria-hidden />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-base font-semibold text-[#2f3a4d]">
                        {task.title}
                      </span>
                      <span className="mt-1 block break-keep text-sm leading-6 text-[#667085]">
                        {task.description}
                      </span>
                    </span>
                    <span className="inline-flex items-center gap-2 text-sm font-semibold text-[#2f6f9f]">
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
          </div>

          <div className="rounded-[8px] border border-[#d8e1ef] bg-white p-5 sm:p-6">
            <ResultCheckButton
              label="결과 확인"
              className="flex h-12 w-full items-center justify-center rounded-[8px] bg-[#2f6f9f] px-5 text-sm font-semibold text-white transition hover:bg-[#285f87]"
            />
          </div>
        </div>
      </section>
    </div>
  );
}
