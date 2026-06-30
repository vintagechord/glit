"use client";

import * as React from "react";
import { Gift, Newspaper, type LucideIcon } from "lucide-react";

export type CreditUseTab = "magazine" | "services";

type CreditUseTabsProps = {
  initialTab: CreditUseTab;
  magazinePanel: React.ReactNode;
  servicesPanel: React.ReactNode;
};

const tabs: Array<{
  key: CreditUseTab;
  title: string;
  description: string;
  meta: string;
  icon: LucideIcon;
}> = [
  {
    key: "magazine",
    title: "워터멜론 매거진",
    description: "아티스트/앨범 소개 콘텐츠 발행 요청",
    meta: "1크레딧",
    icon: Newspaper,
  },
  {
    key: "services",
    title: "서비스 이용권",
    description: "녹음실, 관리자 등록 등 연계 서비스 신청",
    meta: "이용권별 차감",
    icon: Gift,
  },
];

const selectedTabTone: Record<
  CreditUseTab,
  {
    card: string;
    icon: string;
    meta: string;
  }
> = {
  magazine: {
    card: "border-[#111111] bg-[#f2cf27] text-[#111111] shadow-[5px_5px_0_#1556a4]",
    icon: "border-[#111111] bg-white text-[#111111]",
    meta: "border-[#111111]/25 text-[#111111]/78",
  },
  services: {
    card: "border-[#111111] bg-[#1556a4] text-white shadow-[5px_5px_0_#f2cf27]",
    icon: "border-white bg-white text-[#1556a4]",
    meta: "border-white/35 text-white/85",
  },
};

function updateTabUrl(tab: CreditUseTab) {
  const url = new URL(window.location.href);

  if (tab === "services") {
    url.searchParams.set("tab", "services");
  } else {
    url.searchParams.delete("tab");
  }
  url.hash = "credit-use";

  window.history.replaceState(
    null,
    "",
    `${url.pathname}${url.search}${url.hash}`,
  );
}

export function CreditUseTabs({
  initialTab,
  magazinePanel,
  servicesPanel,
}: CreditUseTabsProps) {
  const [activeTab, setActiveTab] = React.useState<CreditUseTab>(initialTab);

  const selectTab = (tab: CreditUseTab) => {
    setActiveTab(tab);
    updateTabUrl(tab);
  };

  return (
    <>
      <div className="mb-6">
        <h2 className="text-2xl font-black text-foreground">
          크레딧 사용처
        </h2>
        <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-muted-foreground">
          원하는 사용처를 선택해 신청을 이어가세요.
        </p>
        <div
          role="tablist"
          aria-label="크레딧 사용처"
          className="mt-4 grid gap-3 md:grid-cols-2"
        >
          {tabs.map((tab) => {
            const selected = activeTab === tab.key;
            const selectedTone = selectedTabTone[tab.key];
            const Icon = tab.icon;

            return (
              <button
                key={tab.key}
                type="button"
                id={`credit-use-tab-${tab.key}`}
                role="tab"
                aria-selected={selected}
                aria-controls={`credit-use-panel-${tab.key}`}
                onClick={() => selectTab(tab.key)}
                className={`flex min-h-[116px] items-stretch gap-4 rounded-[10px] border-2 p-4 text-left transition-[background-color,border-color,color,box-shadow,transform] duration-75 ${
                  selected
                    ? selectedTone.card
                    : "border-border bg-card text-foreground hover:-translate-y-0.5 hover:border-[#1556a4]"
                }`}
              >
                <span
                  className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-[8px] border-2 transition-[background-color,border-color,color] duration-75 ${
                    selected
                      ? selectedTone.icon
                      : "border-border bg-background text-[#1556a4]"
                  }`}
                >
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="block text-lg font-black">{tab.title}</span>
                  <span className="mt-1 block text-xs font-semibold leading-5 opacity-75">
                    {tab.description}
                  </span>
                  <span
                    className={`mt-auto w-fit rounded-[6px] border px-2 py-1 text-[10px] font-black ${
                      selected
                        ? selectedTone.meta
                        : "border-border text-muted-foreground"
                    }`}
                  >
                    {tab.meta}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div
        id="credit-use-panel-magazine"
        role="tabpanel"
        aria-labelledby="credit-use-tab-magazine"
        hidden={activeTab !== "magazine"}
      >
        {magazinePanel}
      </div>
      <div
        id="credit-use-panel-services"
        role="tabpanel"
        aria-labelledby="credit-use-tab-services"
        hidden={activeTab !== "services"}
      >
        {servicesPanel}
      </div>
    </>
  );
}
