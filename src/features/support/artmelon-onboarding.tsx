"use client";

import { usePathname } from "next/navigation";
import { Disc3, PackageCheck, Store } from "lucide-react";

import { SupportInquiryModal } from "./support-inquiry-modal";

export function ArtmelonOnboarding() {
  const isEnglish = usePathname().startsWith("/en");
  const steps = isEnglish
    ? [
        { icon: Disc3, title: "Tell us about your release", body: "Include your Onside review reference or album and artist name so we can check your review history." },
        { icon: Store, title: "Choose what you want to sell", body: "CDs, LPs and other merchandise are welcome. Tell us the items, available quantities and planned release date." },
        { icon: PackageCheck, title: "Plan your Artmelon store", body: "We will connect you with onboarding guidance and help you confirm the selling terms and delivery arrangements." },
      ]
    : [
        { icon: Disc3, title: "심의한 음반을 알려주세요", body: "접수번호 또는 음반명·아티스트명을 남겨주시면 온사이드 심의 이력을 확인합니다." },
        { icon: Store, title: "판매할 상품을 정하세요", body: "CD, LP, 그 외 굿즈까지. 상품 종류와 준비 수량, 판매 희망 일정을 알려주세요." },
        { icon: PackageCheck, title: "입점 안내를 받아보세요", body: "심의 회원의 이력을 바탕으로 아트멜론 입점을 연결하고, 판매 조건과 배송 준비 사항을 안내합니다." },
      ];

  return (
    <section id="artmelon" aria-labelledby="artmelon-heading" className="mt-12 scroll-mt-36 rounded-[10px] border-2 border-border bg-card p-5 sm:p-8">
      <p className="text-xs font-black tracking-widest text-muted-foreground">ONSIDE × ARTMELON</p>
      <h2 id="artmelon-heading" className="mt-3 break-keep text-2xl font-black text-foreground">
        {isEnglish ? "Your music, in your fans’ hands" : "당신의 음악을 팬들의 손에"}
      </h2>
      <p className="mt-3 max-w-3xl break-keep text-sm leading-7 text-muted-foreground">
        {isEnglish
          ? "Onside review members can get help connecting with Artmelon to sell physical releases and merchandise. If your distributor does not offer a CD, LP or merchandise sales service, start here."
          : "온사이드에서 심의를 진행한 회원은 아트멜론 입점을 더 수월하게 준비할 수 있습니다. 유통사가 실물음반이나 굿즈 판매를 지원하지 않아도, CD와 LP부터 굿즈까지 팬들에게 전할 수 있도록 연결합니다."}
      </p>
      <ol className="mt-6 grid gap-5 md:grid-cols-3">
        {steps.map(({ icon: Icon, title, body }, index) => (
          <li key={title} className="rounded-[8px] border border-border p-4">
            <div className="flex items-center justify-between">
              <Icon className="h-6 w-6 text-foreground" aria-hidden="true" />
              <span className="text-xs font-black text-muted-foreground">0{index + 1}</span>
            </div>
            <h3 className="mt-4 text-sm font-black">{title}</h3>
            <p className="mt-2 break-keep text-sm leading-6 text-muted-foreground">{body}</p>
          </li>
        ))}
      </ol>
      <div className="mt-6 flex flex-col items-start gap-3">
        <SupportInquiryModal
          triggerLabel={isEnglish ? "Ask about Artmelon onboarding" : "아트멜론 입점 상담"}
          dialogTitle={isEnglish ? "Artmelon onboarding" : "아트멜론 입점 상담"}
          initialTitle={isEnglish ? "[Artmelon] Onside member onboarding" : "[아트멜론] 온사이드 심의 회원 입점 상담"}
          initialBody={isEnglish
            ? "Artist / album:\nOnside review reference (if available):\nItems to sell (CD / LP / merchandise):\nAvailable quantities:\nPreferred sale date:\nQuestions:\n"
            : "아티스트 / 음반명:\n온사이드 접수번호 (확인 가능한 경우):\n판매할 상품 (CD / LP / 굿즈):\n준비 수량:\n판매 희망 일정:\n궁금한 점:\n"}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[8px] border-2 border-[#111111] bg-[#f2cf27] px-5 py-3 text-sm font-black text-[#111111] shadow-[3px_3px_0_#111111] transition hover:-translate-y-0.5"
        />
        <p className="text-xs leading-5 text-muted-foreground">
          {isEnglish ? "Onboarding and selling terms are confirmed during the consultation." : "입점 및 판매 조건은 상담을 통해 개별 안내합니다."}
        </p>
      </div>
    </section>
  );
}
