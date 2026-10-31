import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, CheckCircle2 } from "lucide-react";

import { JsonLd } from "@/components/seo/json-ld";
import { loadAlbumPackages } from "@/lib/review-guide-pricing";
import { getReviewGuide, MV_PRICE_ROWS, REVIEW_GUIDES, FALLBACK_ALBUM_PACKAGES, type AlbumPackage } from "@/lib/review-guides";
import { breadcrumbJsonLd, faqJsonLd, pageMetadata, serviceJsonLd } from "@/lib/seo";

// Public, crawlable guides: rebuilt hourly so package prices stay current.
export const revalidate = 3600;
export const dynamicParams = false;

export function generateStaticParams() {
  return REVIEW_GUIDES.map((guide) => ({ slug: guide.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const guide = getReviewGuide((await params).slug);
  if (!guide) return {};
  return pageMetadata({ title: guide.title, description: guide.description, path: `/guide/${guide.slug}`, keywords: guide.keywords });
}

const won = (value: number) => `${value.toLocaleString("ko-KR")}원`;
const stationOrder = FALLBACK_ALBUM_PACKAGES.at(-1)!.stations;
const sortStations = (stations: string[]) =>
  stations.slice().sort((a, b) => (stationOrder.indexOf(a) + 1 || 99) - (stationOrder.indexOf(b) + 1 || 99));

function AlbumPriceTable({ packages }: { packages: AlbumPackage[] }) {
  return (
    <div className="overflow-x-auto rounded-[8px] border-2 border-[#111111] dark:border-[#f2cf27]">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">음반 심의 방송국 패키지 비용</caption>
        <thead className="bg-[#f2cf27] text-[#111111]">
          <tr><th scope="col" className="whitespace-nowrap px-3 py-3 font-black sm:px-4">패키지</th><th scope="col" className="whitespace-nowrap px-3 py-3 font-black sm:px-4">비용</th><th scope="col" className="px-3 py-3 font-black sm:px-4">접수 방송국</th></tr>
        </thead>
        <tbody>
          {packages.map((item) => (
            <tr key={item.name} className="border-t-2 border-[#111111] align-top dark:border-[#f2cf27]/40">
              <th scope="row" className="whitespace-nowrap px-3 py-3 font-black sm:px-4">{item.name}</th>
              <td className="whitespace-nowrap px-3 py-3 font-black tabular-nums sm:px-4">{won(item.priceKrw)}</td>
              <td className="break-keep px-3 py-3 text-xs leading-6 text-muted-foreground sm:px-4 sm:text-sm">{sortStations(item.stations).join(", ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MvPriceTable() {
  return (
    <div className="overflow-x-auto rounded-[8px] border-2 border-[#111111] dark:border-[#f2cf27]">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">뮤직비디오 심의 비용</caption>
        <thead className="bg-[#1556a4] text-white">
          <tr><th scope="col" className="px-3 py-3 font-black sm:px-4">항목</th><th scope="col" className="whitespace-nowrap px-3 py-3 font-black sm:px-4">비용(영상 1건)</th></tr>
        </thead>
        <tbody>
          {MV_PRICE_ROWS.map((row) => (
            <tr key={row.label} className="border-t-2 border-[#111111] dark:border-[#f2cf27]/40">
              <th scope="row" className="break-keep px-3 py-3 font-semibold sm:px-4">{row.label}</th>
              <td className="whitespace-nowrap px-3 py-3 font-black tabular-nums sm:px-4">{won(row.priceKrw)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function ReviewGuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const guide = getReviewGuide((await params).slug);
  if (!guide) notFound();
  const packages = guide.pricing === "mv" ? [] : await loadAlbumPackages();
  const path = `/guide/${guide.slug}`;
  const offers = guide.pricing === "mv"
    ? MV_PRICE_ROWS.map((row) => ({ name: row.label, priceKrw: row.priceKrw }))
    : packages.map((item) => ({ name: `음반 심의 ${item.name}`, priceKrw: item.priceKrw }));
  const related = guide.related.map((slug) => getReviewGuide(slug)).filter((item): item is NonNullable<typeof item> => Boolean(item));

  return (
    <article className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
      <JsonLd data={breadcrumbJsonLd([{ name: "홈", path: "/" }, { name: "심의 안내", path: "/guide" }, { name: guide.menuLabel, path }])} />
      <JsonLd data={serviceJsonLd({ name: guide.h1, serviceType: guide.serviceType, description: guide.description, path, offers })} />
      <JsonLd data={faqJsonLd(guide.faqs)} />

      <nav aria-label="현재 위치" className="text-xs font-bold text-muted-foreground">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li><Link href="/" className="underline-offset-4 hover:underline">홈</Link></li>
          <li aria-hidden="true">/</li>
          <li><Link href="/guide" className="underline-offset-4 hover:underline">심의 안내</Link></li>
          <li aria-hidden="true">/</li>
          <li aria-current="page" className="text-foreground">{guide.menuLabel}</li>
        </ol>
      </nav>

      <header className="mt-5">
        <p className="bauhaus-kicker">심의 가이드</p>
        <h1 className="font-display mt-4 break-keep text-3xl font-black leading-tight text-foreground sm:text-4xl">{guide.h1}</h1>
        <p className="mt-5 break-keep text-base leading-8 text-foreground/85">{guide.lead}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href={guide.cta.href} className="inline-flex min-h-12 items-center gap-2 rounded-[8px] border-2 border-[#111111] bg-[#f2cf27] px-5 text-sm font-black text-[#111111] shadow-[3px_3px_0_#111111] transition hover:-translate-y-0.5">
            {guide.cta.label}<ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
          {guide.cta.secondary && (
            <Link href={guide.cta.secondary.href} className="inline-flex min-h-12 items-center rounded-[8px] border-2 border-[#111111] bg-background px-5 text-sm font-black text-foreground shadow-[3px_3px_0_#111111] transition hover:-translate-y-0.5 dark:border-[#f2cf27]">
              {guide.cta.secondary.label}
            </Link>
          )}
        </div>
      </header>

      <dl className="mt-8 grid gap-3 sm:grid-cols-2">
        {guide.facts.map((fact) => (
          <div key={fact.label} className="rounded-[8px] border-2 border-[#111111] bg-card p-4 dark:border-[#f2cf27]/60">
            <dt className="text-xs font-black text-muted-foreground">{fact.label}</dt>
            <dd className="mt-1 break-keep text-sm font-black leading-6 text-foreground">{fact.value}</dd>
          </div>
        ))}
      </dl>

      {guide.sections.map((section) => (
        <section key={section.heading} className="mt-10">
          <h2 className="font-display break-keep text-2xl font-black text-foreground">{section.heading}</h2>
          {section.paragraphs?.map((paragraph) => <p key={paragraph} className="mt-4 break-keep text-[15px] leading-8 text-foreground/85">{paragraph}</p>)}
          {section.bullets && (
            <ul className="mt-4 space-y-3">
              {section.bullets.map((bullet) => (
                <li key={bullet} className="flex gap-3 break-keep text-[15px] leading-7 text-foreground/85">
                  <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-[#1556a4] dark:text-[#f2cf27]" aria-hidden="true" />
                  <span>{bullet}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}

      <section className="mt-10">
        <h2 className="font-display text-2xl font-black text-foreground">{guide.pricing === "mv" ? "뮤직비디오 심의 비용" : guide.pricing === "both" ? "방송국 심의 비용" : "심의 비용"}</h2>
        <p className="mt-3 break-keep text-sm leading-7 text-muted-foreground">음반 심의는 앨범 1건, 뮤직비디오 심의는 영상 1건 기준이며 부가세가 포함된 금액입니다. 결제 전 화면에서 선택한 항목과 총액을 다시 확인할 수 있습니다.</p>
        {guide.pricing !== "mv" && <div className="mt-4"><AlbumPriceTable packages={packages} /></div>}
        {guide.pricing !== "album" && (
          <>
            {guide.pricing === "both" && <h3 className="mt-6 text-lg font-black text-foreground">뮤직비디오 심의</h3>}
            <div className="mt-4"><MvPriceTable /></div>
          </>
        )}
      </section>

      <section className="mt-10">
        <h2 className="font-display text-2xl font-black text-foreground">자주 묻는 질문</h2>
        <div className="mt-4 space-y-3">
          {guide.faqs.map((faq) => (
            <details key={faq.question} className="group rounded-[8px] border-2 border-[#111111] bg-card p-4 dark:border-[#f2cf27]/60">
              <summary className="cursor-pointer list-none break-keep text-[15px] font-black text-foreground marker:hidden [&::-webkit-details-marker]:hidden">{faq.question}</summary>
              <p className="mt-3 break-keep text-sm leading-7 text-foreground/85">{faq.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="mt-10 rounded-[10px] border-2 border-[#111111] bg-[#1556a4] p-5 text-white shadow-[5px_5px_0_#111111] sm:p-6">
        <h2 className="font-display text-xl font-black">함께 보면 좋은 안내</h2>
        <ul className="mt-4 grid gap-2 sm:grid-cols-3">
          {related.map((item) => (
            <li key={item.slug}>
              <Link href={`/guide/${item.slug}`} className="flex min-h-11 items-center justify-between gap-2 rounded-[8px] border-2 border-white/80 px-3 text-sm font-black transition hover:bg-white hover:text-[#111111]">
                {`${item.menuLabel} 안내`}<ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs leading-6 text-white/85">심의 결과는 실제 방송 편성을 보장하지 않습니다. 궁금한 점은 <Link href="/support" className="font-black underline underline-offset-4">고객센터</Link>나 <Link href="/faq" className="font-black underline underline-offset-4">FAQ</Link>에서 확인하세요.</p>
      </section>
    </article>
  );
}
