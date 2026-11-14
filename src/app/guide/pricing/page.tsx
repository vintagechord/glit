import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { AlbumPriceTable, MvPriceTable } from "@/components/guide/price-tables";
import { GuideTrustFacts, GuideUpdatedLine } from "@/components/guide/trust-facts";
import { JsonLd } from "@/components/seo/json-ld";
import { quoteAlbumBundle } from "@/lib/album-payment-discount";
import { GUIDE_CONTENT_UPDATED } from "@/lib/onside-trust";
import { loadAlbumPackages } from "@/lib/review-guide-pricing";
import { MV_PRICE_ROWS } from "@/lib/review-guides";
import { breadcrumbJsonLd, faqJsonLd, pageMetadata, serviceJsonLd, webPageJsonLd } from "@/lib/seo";
import { MV_BASE_ONLINE_PRICE_KRW, MV_STATION_PRICE_KRW } from "@/lib/submission-station-selection";

// Public, crawlable: rebuilt hourly and at once when an admin edits packages.
export const revalidate = 3600;

export const metadata = pageMetadata({
  title: "음반 심의 비용·뮤직비디오 심의 비용 안내 (부가세 포함)",
  description: "음반 심의 비용은 방송국 패키지별로 앨범 1건 기준 5만 원(KBS·MBC·SBS 3곳)부터 15만 원(15곳)까지, 뮤직비디오 심의 비용은 온라인 유통용 등급분류 3만 원부터입니다. 음반 2건 이상을 함께 결제하면 2번째 앨범부터 50% 할인됩니다. 부가세 포함 금액, 카드·무통장 결제, 현금영수증·세금계산서 발급을 안내합니다.",
  path: "/guide/pricing",
  keywords: ["음반심의 비용", "음반 심의 비용", "음원 심의 비용", "앨범 심의 비용", "뮤직비디오 심의 비용", "뮤비 심의 비용", "영등위 심의 비용", "방송국 심의 비용", "심의 대행 비용", "심의 대행 가격", "KBS 심의 비용"],
});

const won = (value: number) => `${value.toLocaleString("ko-KR")}원`;

export default async function PricingGuidePage() {
  const packages = await loadAlbumPackages();
  const cheapest = packages[0];
  const largest = packages.at(-1);
  const faqs = [
    { question: "음반 심의 비용은 어떻게 계산되나요?", answer: `선택한 방송국 패키지 금액이 앨범 1건마다 적용됩니다. ${cheapest ? `${cheapest.name}(${cheapest.stations.join("·")})는 ${won(cheapest.priceKrw)}` : "3곳 패키지는 50,000원"}이고, ${largest ? `${largest.name}는 ${won(largest.priceKrw)}` : "15곳 패키지는 150,000원"}입니다. 모두 부가세가 포함된 금액입니다.` },
    { question: "여러 앨범을 한 번에 신청하면 할인이 되나요?", answer: `네. 음반 2건 이상을 함께 결제하면 2번째 앨범부터 50% 할인됩니다. ${cheapest ? `${cheapest.name} 앨범 2건은 ${won(quoteAlbumBundle(cheapest.priceKrw, 2).totalKrw)}, 3건은 ${won(quoteAlbumBundle(cheapest.priceKrw, 3).totalKrw)}입니다. ` : ""}패키지가 서로 다르면 금액이 가장 큰 앨범 1건에 정상 가격이, 나머지 앨범에 각 패키지 금액의 50%가 적용됩니다. 장바구니에서 함께 선택해 결제할 때 적용되며, 뮤직비디오 심의에는 적용되지 않습니다.` },
    { question: "음원(디지털 싱글) 1곡도 같은 금액인가요?", answer: "네. 음반 심의 비용은 곡 수와 관계없이 앨범 1건 기준이라, 음원으로만 낸 싱글 1곡도 선택한 방송국 패키지 금액이 적용됩니다." },
    { question: "이미 발매된 앨범은 추가 비용이 있나요?", answer: "없습니다. 멜론 또는 지니 앨범 링크로 접수하면 신청서를 따로 쓰지 않고 같은 패키지 금액으로 진행합니다." },
    { question: "뮤직비디오 심의 비용은 얼마인가요?", answer: `온라인 유통용 심의는 영상물등급위원회 등급분류 기본 ${won(MV_BASE_ONLINE_PRICE_KRW)}에 Mnet을 추가할 수 있고, TV 송출용 방송국별 심의는 KBS·MBC·SBS 방송사별 금액이, ETN 방송용 입고는 입고비 ${won(MV_STATION_PRICE_KRW.ETN)}이 더해집니다. 영상 1건 기준이며 부가세가 포함된 금액입니다.` },
    { question: "결제 방법과 증빙은 어떻게 되나요?", answer: "PC에서는 카드 결제 또는 무통장 입금, 모바일에서는 무통장 입금을 이용하거나 저장한 신청을 PC에서 이어서 카드 결제할 수 있습니다. 결제 후 현금영수증, 세금계산서, 거래내역서를 발급할 수 있습니다." },
    { question: "긴급 심의는 추가 비용이 있나요?", answer: "일정과 방송국 조건에 따라 다르며 추가 비용이 발생할 수 있습니다. 긴급 접수는 신청 전에 문의해 주세요." },
    { question: "심의용 CD·가사집 제작 비용은 별도인가요?", answer: "정식 CD로 발매한 앨범은 실제 CD가 필요할 수 있고, 디지털 음반은 심의용 CD와 가사집 제작을 지원합니다. 추가 비용 여부는 접수 시 안내합니다." },
  ];
  const offers = [
    ...packages.map((pkg) => ({ name: `음반 심의 ${pkg.name}`, priceKrw: pkg.priceKrw })),
    ...MV_PRICE_ROWS.map((row) => ({ name: `뮤직비디오 심의 ${row.label}`, priceKrw: row.priceKrw })),
  ];

  return (
    <article className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
      <JsonLd data={breadcrumbJsonLd([{ name: "홈", path: "/" }, { name: "심의 안내", path: "/guide" }, { name: "심의 비용", path: "/guide/pricing" }])} />
      <JsonLd data={serviceJsonLd({ name: "음반 심의·뮤직비디오 심의 대행", serviceType: "심의 대행", description: metadata.description ?? "", path: "/guide/pricing", offers })} />
      <JsonLd data={faqJsonLd(faqs)} />
      <JsonLd data={webPageJsonLd({ name: "음반 심의 비용·뮤직비디오 심의 비용 안내", description: metadata.description ?? "", path: "/guide/pricing", dateModified: GUIDE_CONTENT_UPDATED })} />

      <nav aria-label="현재 위치" className="text-xs font-bold text-muted-foreground">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li><Link href="/" className="underline-offset-4 hover:underline">홈</Link></li>
          <li aria-hidden="true">/</li>
          <li><Link href="/guide" className="underline-offset-4 hover:underline">심의 안내</Link></li>
          <li aria-hidden="true">/</li>
          <li aria-current="page" className="text-foreground">심의 비용</li>
        </ol>
      </nav>

      <header className="mt-5">
        <p className="bauhaus-kicker">심의 비용</p>
        <h1 className="font-display mt-4 break-keep text-3xl font-black leading-tight text-foreground sm:text-4xl">음반 심의 비용 · 뮤직비디오 심의 비용</h1>
        <GuideUpdatedLine />
        <p className="mt-5 break-keep text-base leading-8 text-foreground/85">
          음반 심의는 방송국 패키지별 금액이 앨범 1건마다 적용되고, 2건 이상을 함께 결제하면 2번째 앨범부터 50% 할인됩니다. 뮤직비디오 심의는 영상 1건에 선택한 항목의 금액이 더해집니다. 아래 금액은 모두 부가세가 포함되어 있으며, 결제 전 화면에서 선택한 항목과 총액을 다시 확인할 수 있습니다.
        </p>
      </header>

      <dl className="mt-8 grid gap-3 sm:grid-cols-3">
        <div className="rounded-[8px] border-2 border-[#111111] bg-card p-4 dark:border-[#f2cf27]/60">
          <dt className="text-xs font-black text-muted-foreground">음반 심의</dt>
          <dd className="mt-1 break-keep text-sm font-black leading-6 text-foreground">{cheapest ? `${won(cheapest.priceKrw)}(${cheapest.stationCount}곳)` : "50,000원(3곳)"}부터 · 앨범 1건 · 2번째 앨범부터 50%</dd>
        </div>
        <div className="rounded-[8px] border-2 border-[#111111] bg-card p-4 dark:border-[#f2cf27]/60">
          <dt className="text-xs font-black text-muted-foreground">뮤직비디오 심의</dt>
          <dd className="mt-1 break-keep text-sm font-black leading-6 text-foreground">{won(MV_BASE_ONLINE_PRICE_KRW)}(온라인 유통용 기본)부터 · 영상 1건</dd>
        </div>
        <div className="rounded-[8px] border-2 border-[#111111] bg-card p-4 dark:border-[#f2cf27]/60">
          <dt className="text-xs font-black text-muted-foreground">결제·증빙</dt>
          <dd className="mt-1 break-keep text-sm font-black leading-6 text-foreground">카드·무통장 · 현금영수증·세금계산서</dd>
        </div>
      </dl>

      <section className="mt-10">
        <h2 className="font-display text-2xl font-black text-foreground">음반 심의 비용 (방송국 패키지)</h2>
        <p className="mt-3 break-keep text-sm leading-7 text-muted-foreground">방송하려는 범위에 맞춰 3곳·7곳·10곳·13곳·15곳 가운데 고릅니다. 극동방송(CCM)과 국악방송(국악)은 장르가 맞는 음반만 접수하므로, 일반 가요는 13곳 패키지까지가 맞습니다. 방송국별 자세한 안내는 <Link href="/guide/stations" className="font-black underline underline-offset-4">방송국별 안내</Link>에서 볼 수 있습니다.</p>
        <div className="mt-4"><AlbumPriceTable packages={packages} /></div>
      </section>

      <section className="mt-10">
        <h2 className="font-display text-2xl font-black text-foreground">뮤직비디오 심의 비용</h2>
        <p className="mt-3 break-keep text-sm leading-7 text-muted-foreground">온라인 유통용 심의는 영상물등급위원회 등급분류 기본 금액에 Mnet을 추가하는 방식이고, TV 송출용 방송국별 심의는 방송사마다 따로 금액이 붙습니다. ETN은 심의 없이 방송용 입고로 접수합니다.</p>
        <div className="mt-4"><MvPriceTable /></div>
      </section>

      <section className="mt-10">
        <h2 className="font-display text-2xl font-black text-foreground">비용에 포함되는 것</h2>
        <ul className="mt-4 space-y-2 break-keep text-[15px] leading-7 text-foreground/85">
          <li>· 신청서와 자료 정리, 방송국 접수, 결과 수령과 안내 (심의 대행 전체 과정)</li>
          <li>· 발매된 앨범의 멜론·지니 링크 접수 (추가금 없음)</li>
          <li>· 조회 코드와 마이페이지의 방송국별 진행 현황·결과, 결과 안내 메일</li>
          <li>· 뮤직비디오 온라인 유통용: 등급 결과·필증·등급 표기 이미지와 사용 안내</li>
        </ul>
      </section>

      <GuideTrustFacts />

      <section className="mt-10">
        <h2 className="font-display text-2xl font-black text-foreground">자주 묻는 질문</h2>
        <div className="mt-4 space-y-3">
          {faqs.map((faq) => (
            <details key={faq.question} className="group rounded-[8px] border-2 border-[#111111] bg-card p-4 dark:border-[#f2cf27]/60">
              <summary className="cursor-pointer list-none break-keep text-[15px] font-black text-foreground marker:hidden [&::-webkit-details-marker]:hidden">{faq.question}</summary>
              <p className="mt-3 break-keep text-sm leading-7 text-foreground/85">{faq.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="mt-10 flex flex-col gap-4 rounded-[10px] border-2 border-[#111111] bg-[#f2cf27] p-5 text-[#111111] shadow-[8px_8px_0_#111111] sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <h2 className="font-display text-xl font-black">결제 전 화면에서 총액을 다시 확인할 수 있습니다</h2>
        <div className="flex flex-wrap gap-2">
          <Link href="/dashboard/new/album" className="inline-flex min-h-11 items-center gap-2 rounded-[8px] border-2 border-[#111111] bg-[#111111] px-4 text-xs font-black text-white shadow-[2px_2px_0_#111111] transition hover:-translate-y-0.5">음반 심의 신청<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
          <Link href="/dashboard/new/mv" className="inline-flex min-h-11 items-center gap-2 rounded-[8px] border-2 border-[#111111] bg-white px-4 text-xs font-black shadow-[2px_2px_0_#111111] transition hover:-translate-y-0.5">뮤직비디오 심의 신청<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
        </div>
      </section>
    </article>
  );
}
