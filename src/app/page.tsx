import Link from "next/link";
import { ArrowRight, Disc3, Film } from "lucide-react";

import { HomeSessionPanel } from "@/features/home/home-session-panel";

export default function Home() {
  return (
    <div className="bg-[#fbfcfe]">
      <section className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-10 sm:px-6 sm:py-14 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
        <div className="pt-2">
          <p className="text-sm font-semibold text-[#2f6f9f]">
            SINCE 2017
          </p>
          <h1 className="mt-4 break-keep text-3xl font-semibold leading-tight text-[#2f3a4d] sm:text-5xl">
            음반, 뮤비 심의를 쉽고 빠르게!
          </h1>
          <p className="mt-5 max-w-xl break-keep text-base leading-7 text-[#667085]">
            온사이드는 창작물의 TV, Radio, 온라인 송출을 위한 심의를
            대행합니다.
          </p>
        </div>

        <div className="space-y-4">
          <div className="rounded-[8px] border border-[#d8e1ef] bg-white">
            <div className="border-b border-[#e4e9f2] px-5 py-4 sm:px-6">
              <h2 className="text-lg font-semibold text-[#2f3a4d]">
                심의 접수
              </h2>
            </div>
            <div className="space-y-3 p-4 sm:p-5">
              <div className="rounded-[8px] border border-[#d8e1ef] bg-[#fbfcfe] p-4">
                <div className="flex items-center gap-4">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[8px] bg-[#edf4f7] text-[#2f6f9f]">
                    <Disc3 className="h-6 w-6" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-base font-semibold text-[#2f3a4d]">
                      음반 심의 신청
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Link
                        href="/dashboard/new/album"
                        className="group inline-flex h-9 items-center rounded-[8px] border border-[#c9d6e8] bg-white px-3 text-xs font-semibold text-[#2f3a4d] transition hover:border-[#2f6f9f] hover:text-[#2f6f9f]"
                      >
                        방송국 패키지 선택
                        <ArrowRight
                          className="ml-2 h-3.5 w-3.5 transition group-hover:translate-x-0.5"
                          aria-hidden
                        />
                      </Link>
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-[8px] border border-[#d8e1ef] bg-[#fbfcfe] p-4">
                <div className="flex items-center gap-4">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[8px] bg-[#edf4f7] text-[#2f6f9f]">
                    <Film className="h-6 w-6" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-base font-semibold text-[#2f3a4d]">
                      뮤비 심의 신청
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Link
                        href="/dashboard/new/mv?type=distribution"
                        className="group inline-flex h-9 items-center rounded-[8px] border border-[#c9d6e8] bg-white px-3 text-xs font-semibold text-[#2f3a4d] transition hover:border-[#2f6f9f] hover:text-[#2f6f9f]"
                      >
                        온라인 유통용
                        <ArrowRight
                          className="ml-2 h-3.5 w-3.5 transition group-hover:translate-x-0.5"
                          aria-hidden
                        />
                      </Link>
                      <Link
                        href="/dashboard/new/mv?type=broadcast"
                        className="group inline-flex h-9 items-center rounded-[8px] border border-[#c9d6e8] bg-white px-3 text-xs font-semibold text-[#2f3a4d] transition hover:border-[#2f6f9f] hover:text-[#2f6f9f]"
                      >
                        공중파·케이블 방송용
                        <ArrowRight
                          className="ml-2 h-3.5 w-3.5 transition group-hover:translate-x-0.5"
                          aria-hidden
                        />
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 pb-14 sm:px-6">
        <div className="mb-4">
          <p className="text-sm font-semibold text-[#2f6f9f]">
            Review Status
          </p>
          <h2 className="mt-2 text-2xl font-semibold text-[#2f3a4d]">
            실시간 심의 현황
          </h2>
        </div>
        <HomeSessionPanel />
      </section>
    </div>
  );
}
