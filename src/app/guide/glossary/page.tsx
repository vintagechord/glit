import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { JsonLd } from "@/components/seo/json-ld";
import { GLOSSARY_TERM_COUNT, REVIEW_GLOSSARY } from "@/lib/review-glossary";
import { breadcrumbJsonLd, definedTermSetJsonLd, pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "심의 용어집 · 적격·부적격·보완 요청·등급분류·필증 뜻",
  description: "음반 심의와 뮤직비디오 심의에서 쓰는 용어를 설명합니다. 음반 심의와 방송국 심의·라디오 심의의 관계, 적격·부적격·부분 적격·보완 요청, 조회 코드, 영상물등급위원회 등급분류, 필증과 등급 표기 이미지, 발매 전·후 접수, 방송국 패키지까지 처음 신청하는 분을 위한 용어 정리입니다.",
  path: "/guide/glossary",
  keywords: ["심의 용어", "음반 심의 적격", "음반 심의 부적격", "심의 보완 요청", "방송 부적격 뜻", "영상물등급위원회 등급분류", "뮤직비디오 필증", "청소년관람불가 뮤직비디오", "심의 조회 코드"],
});

const anchor = (term: string) => `term-${term.replace(/[^\p{L}\p{N}]+/gu, "-").toLowerCase()}`;

export default function GlossaryPage() {
  const allTerms = REVIEW_GLOSSARY.flatMap((section) => section.terms);
  return (
    <article className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
      <JsonLd data={breadcrumbJsonLd([{ name: "홈", path: "/" }, { name: "심의 안내", path: "/guide" }, { name: "심의 용어집", path: "/guide/glossary" }])} />
      <JsonLd data={definedTermSetJsonLd({ name: "온사이드 심의 용어집", description: metadata.description ?? "", path: "/guide/glossary", terms: allTerms })} />

      <nav aria-label="현재 위치" className="text-xs font-bold text-muted-foreground">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li><Link href="/" className="underline-offset-4 hover:underline">홈</Link></li>
          <li aria-hidden="true">/</li>
          <li><Link href="/guide" className="underline-offset-4 hover:underline">심의 안내</Link></li>
          <li aria-hidden="true">/</li>
          <li aria-current="page" className="text-foreground">심의 용어집</li>
        </ol>
      </nav>

      <header className="mt-5">
        <p className="bauhaus-kicker">용어집 · {GLOSSARY_TERM_COUNT}개</p>
        <h1 className="font-display mt-4 break-keep text-3xl font-black leading-tight text-foreground sm:text-4xl">심의 용어집</h1>
        <p className="mt-5 break-keep text-base leading-8 text-foreground/85">
          처음 심의를 신청하면 적격·부적격·보완 요청 같은 결과 표시와 등급분류·필증 같은 뮤직비디오 용어가 낯설 수 있습니다. 온사이드 화면과 안내 메일에 나오는 용어를 뜻 그대로 정리했습니다.
        </p>
      </header>

      <nav aria-label="용어 바로가기" className="mt-8 rounded-[8px] border-2 border-[#111111] bg-card p-4 dark:border-[#f2cf27]/60">
        <ul className="flex flex-wrap gap-2">
          {allTerms.map((item) => (
            <li key={item.term}>
              <a href={`#${anchor(item.term)}`} className="inline-flex min-h-8 items-center rounded-[6px] border border-[#111111]/40 bg-background px-2.5 text-xs font-black text-foreground transition hover:bg-[#f2cf27] hover:text-[#111111] dark:border-white/40">{item.term}</a>
            </li>
          ))}
        </ul>
      </nav>

      {REVIEW_GLOSSARY.map((section) => (
        <section key={section.heading} className="mt-10">
          <h2 className="font-display break-keep text-2xl font-black text-foreground">{section.heading}</h2>
          <dl className="mt-4 space-y-3">
            {section.terms.map((item) => (
              <div key={item.term} id={anchor(item.term)} className="scroll-mt-24 rounded-[8px] border-2 border-[#111111] bg-card p-4 dark:border-[#f2cf27]/60">
                <dt className="break-keep text-base font-black text-foreground">
                  {item.term}
                  {item.aliases?.length ? <span className="ml-2 text-xs font-bold text-muted-foreground">{item.aliases.join(" · ")}</span> : null}
                </dt>
                <dd className="mt-2 break-keep text-sm leading-7 text-foreground/85">
                  {item.definition}
                  {item.link ? <Link href={item.link.href} className="ml-1 font-black text-[#1556a4] underline underline-offset-4 dark:text-[#f2cf27]">{item.link.label} →</Link> : null}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}

      <section className="mt-10 rounded-[10px] border-2 border-[#111111] bg-[#1556a4] p-5 text-white shadow-[5px_5px_0_#111111] sm:p-6">
        <h2 className="font-display text-xl font-black">함께 보면 좋은 안내</h2>
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {[
            { href: "/guide/album-review", label: "음반 심의 안내" },
            { href: "/guide/mv-review", label: "뮤직비디오 심의 안내" },
            { href: "/guide/stations", label: "방송국별 안내" },
            { href: "/guide/pricing", label: "심의 비용" },
          ].map((item) => (
            <li key={item.href}>
              <Link href={item.href} className="flex min-h-11 items-center justify-between gap-2 rounded-[8px] border-2 border-white/80 px-3 text-sm font-black transition hover:bg-white hover:text-[#111111]">
                {item.label}<ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </article>
  );
}
