import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, CheckCircle2, ExternalLink } from "lucide-react";

import { GuideTrustFacts, GuideUpdatedLine } from "@/components/guide/trust-facts";
import { JsonLd } from "@/components/seo/json-ld";
import { albumPreparationItems, mvPreparationItems } from "@/lib/onside-content";
import { GUIDE_CONTENT_UPDATED } from "@/lib/onside-trust";
import { loadAlbumPackages } from "@/lib/review-guide-pricing";
import { breadcrumbJsonLd, faqJsonLd, pageMetadata, serviceJsonLd, webPageJsonLd } from "@/lib/seo";
import { getLocalStationLogoSource } from "@/lib/station-logos";
import { getStationGuide, josa, packagesIncluding, relatedStationGuides, STATION_GUIDES, stationFaqs, stationRadioGuide, stationSchedule, won } from "@/lib/station-guides";
import { MV_BASE_ONLINE_PRICE_KRW } from "@/lib/submission-station-selection";

// Public, crawlable: rebuilt hourly, so package edits reach every station page.
export const revalidate = 3600;
export const dynamicParams = false;

export function generateStaticParams() {
  return STATION_GUIDES.map((guide) => ({ station: guide.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ station: string }> }) {
  const guide = getStationGuide((await params).station);
  if (!guide) return {};
  return pageMetadata({ title: guide.title, description: guide.description, path: `/guide/stations/${guide.slug}`, keywords: guide.keywords });
}

export default async function StationGuidePage({ params }: { params: Promise<{ station: string }> }) {
  const guide = getStationGuide((await params).station);
  if (!guide) notFound();
  const packages = await loadAlbumPackages();
  const including = packagesIncluding(guide.code, packages);
  const faqs = stationFaqs(guide, packages);
  const radio = stationRadioGuide(guide);
  const related = relatedStationGuides(guide);
  const path = `/guide/stations/${guide.slug}`;
  const offers = [
    ...including.map((pkg) => ({ name: `음반 심의 ${pkg.name} (${guide.shortName} 포함)`, priceKrw: pkg.priceKrw })),
    ...(guide.mv?.base ? [{ name: "온라인 유통용 뮤직비디오 심의 (영상물등급위원회 등급분류)", priceKrw: guide.mv.base }] : []),
    ...(guide.mv?.online ? [{ name: `온라인 유통용 뮤직비디오 심의 ${guide.shortName} 추가`, priceKrw: guide.mv.online }] : []),
    ...(guide.mv?.broadcast ? [{ name: `${guide.shortName} 뮤직비디오 심의 (방송국별)`, priceKrw: guide.mv.broadcast }] : []),
    ...(guide.mv?.delivery ? [{ name: `${guide.shortName} 뮤직비디오 방송용 입고`, priceKrw: guide.mv.delivery }] : []),
  ];
  const kinds = [guide.album ? "음반 심의" : "", guide.mv ? (guide.mv.delivery ? "뮤직비디오 입고" : "뮤직비디오 심의") : ""].filter(Boolean).join("·");
  const logo = getLocalStationLogoSource(guide);
  const kicker = guide.group === "뮤직비디오" ? kinds : `${guide.group} · ${kinds}`;
  const mvApplyHref = guide.mv?.base || guide.mv?.online ? "/dashboard/new/mv?type=distribution" : "/dashboard/new/mv?type=broadcast";
  const route = guide.mv?.base
    ? "온라인 유통용 심의 (Mnet 추가 선택)"
    : guide.mv?.delivery ? "방송국별 신청에서 입고 선택"
    : guide.mv?.online && guide.mv.broadcast ? "온라인 유통용 추가 옵션 · 방송국별 심의" : guide.mv?.online ? "온라인 유통용 추가 옵션" : "방송국별 심의";
  const applyStep = guide.album
    ? `${guide.shortName}${josa(guide, "이/가")} 포함된 방송국 패키지 선택`
    : guide.mv?.base
      ? "온라인 유통용 심의 선택 (필요하면 Mnet 추가)"
      : guide.mv?.delivery ? `방송국별 신청에서 ${guide.shortName} 입고 선택 (KBS·MBC·SBS 심의와 함께 결제 가능)`
      : guide.mv?.online ? `온라인 유통용 심의에 ${guide.shortName} 추가${guide.mv.broadcast ? " 또는 방송국별 심의에서 선택" : ""}` : `방송국별 심의에서 ${guide.shortName} 선택`;

  return (
    <article className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
      <JsonLd data={breadcrumbJsonLd([{ name: "홈", path: "/" }, { name: "심의 안내", path: "/guide" }, { name: "방송국별 안내", path: "/guide/stations" }, { name: guide.name, path }])} />
      <JsonLd data={serviceJsonLd({ name: `${guide.shortName} ${kinds} 대행`, serviceType: `${kinds} 대행`, description: guide.description, path, offers })} />
      <JsonLd data={faqJsonLd(faqs)} />
      <JsonLd data={webPageJsonLd({ name: guide.title, description: guide.description, path, dateModified: GUIDE_CONTENT_UPDATED })} />

      <nav aria-label="현재 위치" className="text-xs font-bold text-muted-foreground">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li><Link href="/" className="underline-offset-4 hover:underline">홈</Link></li>
          <li aria-hidden="true">/</li>
          <li><Link href="/guide" className="underline-offset-4 hover:underline">심의 안내</Link></li>
          <li aria-hidden="true">/</li>
          <li><Link href="/guide/stations" className="underline-offset-4 hover:underline">방송국별 안내</Link></li>
          <li aria-hidden="true">/</li>
          <li aria-current="page" className="text-foreground">{guide.name}</li>
        </ol>
      </nav>

      <header className="mt-5">
        <div className="flex flex-wrap items-center gap-4">
          <span className="flex h-16 w-28 items-center justify-center rounded-[8px] border-2 border-[#111111] bg-white p-2 text-base font-black text-[#111111] dark:border-[#f2cf27]">
            {logo ? <Image src={logo.src} alt={`${guide.name} 로고`} width={96} height={48} className="h-12 w-auto object-contain" priority /> : guide.shortName}
          </span>
          <p className="bauhaus-kicker">{kicker}</p>
        </div>
        <h1 className="font-display mt-4 break-keep text-3xl font-black leading-tight text-foreground sm:text-4xl">{guide.title}</h1>
        <GuideUpdatedLine />
        <p className="mt-5 break-keep text-base leading-8 text-foreground/85">{guide.lead}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          {guide.album ? (
            <Link href="/dashboard/new/album" className="inline-flex min-h-12 items-center gap-2 rounded-[8px] border-2 border-[#111111] bg-[#f2cf27] px-5 text-sm font-black text-[#111111] shadow-[3px_3px_0_#111111] transition hover:-translate-y-0.5">
              음반 심의 신청하기<ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          ) : null}
          {guide.mv ? (
            <Link href={mvApplyHref} className={`inline-flex min-h-12 items-center gap-2 rounded-[8px] border-2 border-[#111111] px-5 text-sm font-black shadow-[3px_3px_0_#111111] transition hover:-translate-y-0.5 ${guide.album ? "bg-background text-foreground dark:border-[#f2cf27]" : "bg-[#f2cf27] text-[#111111]"}`}>
              {guide.mv.delivery ? "뮤직비디오 입고 신청하기" : "뮤직비디오 심의 신청하기"}<ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          ) : null}
          <Link href="/track" className="inline-flex min-h-12 items-center rounded-[8px] border-2 border-[#111111] bg-background px-5 text-sm font-black text-foreground shadow-[3px_3px_0_#111111] transition hover:-translate-y-0.5 dark:border-[#f2cf27]">결과 조회</Link>
        </div>
      </header>

      <dl className="mt-8 grid gap-3 sm:grid-cols-2">
        <div className="rounded-[8px] border-2 border-[#111111] bg-card p-4 dark:border-[#f2cf27]/60">
          <dt className="text-xs font-black text-muted-foreground">{guide.mv?.delivery ? "신청 종류" : "심의 종류"}</dt>
          <dd className="mt-1 break-keep text-sm font-black leading-6 text-foreground">{kinds}</dd>
        </div>
        <div className="rounded-[8px] border-2 border-[#111111] bg-card p-4 dark:border-[#f2cf27]/60">
          <dt className="text-xs font-black text-muted-foreground">{guide.album ? "포함 패키지" : "신청 경로"}</dt>
          <dd className="mt-1 break-keep text-sm font-black leading-6 text-foreground">
            {guide.album && including[0]
              ? `${including[0].name}(${won(including[0].priceKrw)})부터 ${including.length}개 패키지`
              : route}
          </dd>
        </div>
        {guide.mv?.broadcast ? (
          <div className="rounded-[8px] border-2 border-[#111111] bg-card p-4 dark:border-[#f2cf27]/60">
            <dt className="text-xs font-black text-muted-foreground">{guide.shortName} 뮤직비디오 심의</dt>
            <dd className="mt-1 break-keep text-sm font-black leading-6 text-foreground">영상 1건 {won(guide.mv.broadcast)} (방송국별 심의)</dd>
          </div>
        ) : null}
        {guide.mv?.base || guide.mv?.delivery ? (
          <div className="rounded-[8px] border-2 border-[#111111] bg-card p-4 dark:border-[#f2cf27]/60">
            <dt className="text-xs font-black text-muted-foreground">{guide.mv.delivery ? "입고비" : "비용"}</dt>
            <dd className="mt-1 break-keep text-sm font-black leading-6 text-foreground">영상 1건 {won(guide.mv.base ?? guide.mv.delivery ?? 0)} · 부가세 포함</dd>
          </div>
        ) : null}
        {guide.mv?.online ? (
          <div className="rounded-[8px] border-2 border-[#111111] bg-card p-4 dark:border-[#f2cf27]/60">
            <dt className="text-xs font-black text-muted-foreground">온라인 유통용 추가</dt>
            <dd className="mt-1 break-keep text-sm font-black leading-6 text-foreground">기본 {won(MV_BASE_ONLINE_PRICE_KRW)} + {guide.shortName} {won(guide.mv.online)}</dd>
          </div>
        ) : null}
        <div className="rounded-[8px] border-2 border-[#111111] bg-card p-4 dark:border-[#f2cf27]/60">
          <dt className="text-xs font-black text-muted-foreground">기간</dt>
          <dd className="mt-1 break-keep text-sm font-black leading-6 text-foreground">{guide.album ? "접수 3~7영업일 이내 목표 · 결과 최대 약 3주" : "자료 확인 후 접수 · 제출처와 보완 여부에 따라 다름"}</dd>
        </div>
      </dl>

      <section className="mt-10">
        <h2 className="font-display break-keep text-2xl font-black text-foreground">{guide.shortName} {guide.mv?.delivery ? "입고" : "심의"}는 무엇인가요?</h2>
        {guide.about.map((paragraph) => <p key={paragraph} className="mt-4 break-keep text-[15px] leading-8 text-foreground/85">{paragraph}</p>)}
        {guide.genreNote ? (
          <p className="mt-4 rounded-[8px] border-2 border-[#111111] bg-[#f2cf27] p-4 text-sm font-black leading-7 text-[#111111]">{guide.genreNote}</p>
        ) : null}
      </section>

      {guide.album ? (
        <section className="mt-10">
          <h2 className="font-display break-keep text-2xl font-black text-foreground">{guide.shortName}{josa(guide, "이/가")} 포함된 음반 심의 패키지</h2>
          <p className="mt-3 break-keep text-sm leading-7 text-muted-foreground">온사이드는 방송국 패키지 단위로 접수합니다. 아래 패키지를 고르면 {guide.shortName}에 접수되며, 비용은 앨범 1건 기준이고 부가세가 포함된 금액입니다.</p>
          <div className="mt-4 overflow-x-auto rounded-[8px] border-2 border-[#111111] dark:border-[#f2cf27]">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">{guide.shortName}{josa(guide, "이/가")} 포함된 음반 심의 패키지</caption>
              <thead className="bg-[#f2cf27] text-[#111111]">
                <tr><th scope="col" className="whitespace-nowrap px-3 py-3 font-black sm:px-4">패키지</th><th scope="col" className="whitespace-nowrap px-3 py-3 font-black sm:px-4">비용</th><th scope="col" className="px-3 py-3 font-black sm:px-4">함께 접수하는 방송국</th></tr>
              </thead>
              <tbody>
                {including.map((pkg) => (
                  <tr key={pkg.name} className="border-t-2 border-[#111111] align-top dark:border-[#f2cf27]/40">
                    <th scope="row" className="whitespace-nowrap px-3 py-3 font-black sm:px-4">{pkg.name}</th>
                    <td className="whitespace-nowrap px-3 py-3 font-black tabular-nums sm:px-4">{won(pkg.priceKrw)}</td>
                    <td className="break-keep px-3 py-3 text-xs leading-6 text-muted-foreground sm:px-4 sm:text-sm">{pkg.stations.join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="mt-10">
        <h2 className="font-display break-keep text-2xl font-black text-foreground">{guide.shortName} {guide.mv?.delivery ? "입고" : "심의"} 준비물과 진행 순서</h2>
        <ul className="mt-4 space-y-3">
          {(guide.album ? albumPreparationItems : mvPreparationItems).map((item) => (
            <li key={item} className="flex gap-3 break-keep text-[15px] leading-7 text-foreground/85">
              <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-[#1556a4] dark:text-[#f2cf27]" aria-hidden="true" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
        <ol className="mt-5 space-y-2 break-keep text-[15px] leading-7 text-foreground/85">
          <li>1. 온라인 신청서 작성과 파일 업로드{guide.album ? " (발매된 앨범은 멜론·지니 링크)" : ""}</li>
          <li>2. {applyStep}</li>
          <li>3. 카드 결제 또는 무통장 입금 · 현금영수증·세금계산서 발급 가능</li>
          <li>4. 접수: {stationSchedule(guide)}</li>
          <li>5. 결과 확인: {guide.mv?.delivery ? "조회 코드와 마이페이지에 '입고 완료'로 표시되고, 안내 메일로도 알려드립니다." : guide.mv?.base ? "조회 코드와 마이페이지에서 등급 결과와 영등위 심의필증, 등급 이미지, 등급 표시 사용 예시 PDF를 내려받고, 안내 메일로도 알려드립니다." : "조회 코드와 마이페이지에 방송국별 결과가 표시되고, 안내 메일로도 알려드립니다."}</li>
        </ol>
      </section>

      {radio ? (
        <section className="mt-10">
          <h2 className="font-display break-keep text-2xl font-black text-foreground">심의 후 {guide.shortName} 라디오에 신청곡 보내기</h2>
          <p className="mt-4 break-keep text-[15px] leading-8 text-foreground/85">{radio.introduction.ko}</p>
          <p className="mt-3 break-keep text-[15px] leading-8 text-foreground/85">{radio.route.ko}</p>
          <ul className="mt-4 space-y-3">
            <li className="flex gap-3 break-keep text-[15px] leading-7">
              <ExternalLink className="mt-1 h-4 w-4 shrink-0 text-[#1556a4] dark:text-[#f2cf27]" aria-hidden="true" />
              <a href={radio.directoryUrl} target="_blank" rel="noopener noreferrer" className="font-black underline underline-offset-4">{radio.name} 프로그램 목록</a>
            </li>
            {radio.participationLink ? (
              <li className="flex gap-3 break-keep text-[15px] leading-7">
                <ExternalLink className="mt-1 h-4 w-4 shrink-0 text-[#1556a4] dark:text-[#f2cf27]" aria-hidden="true" />
                <span><a href={radio.participationLink.url} target="_blank" rel="noopener noreferrer" className="font-black underline underline-offset-4">{radio.participationLink.name}</a> · {radio.participationLink.description.ko}</span>
              </li>
            ) : null}
            {radio.programs.map((program) => (
              <li key={program.url} className="flex gap-3 break-keep text-[15px] leading-7">
                <ExternalLink className="mt-1 h-4 w-4 shrink-0 text-[#1556a4] dark:text-[#f2cf27]" aria-hidden="true" />
                <span>
                  <a href={program.url} target="_blank" rel="noopener noreferrer" className="font-black underline underline-offset-4">{program.name}</a> · {program.description.ko}{" "}
                  <a href={program.messageUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">신청곡 게시판</a> · <a href={program.playlistUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">선곡표</a>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-4 break-keep text-sm leading-7 text-muted-foreground">{radio.followUp.ko} 링크는 {radio.verifiedAt}에 확인한 공식 주소이며, 온사이드가 대신 신청하지는 않습니다.</p>
        </section>
      ) : null}

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

      <section className="mt-10 rounded-[10px] border-2 border-[#111111] bg-[#1556a4] p-5 text-white shadow-[5px_5px_0_#111111] sm:p-6">
        <h2 className="font-display text-xl font-black">다른 방송국 안내</h2>
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {related.map((item) => (
            <li key={item.slug}>
              <Link href={`/guide/stations/${item.slug}`} className="flex min-h-11 items-center justify-between gap-2 rounded-[8px] border-2 border-white/80 px-3 text-sm font-black transition hover:bg-white hover:text-[#111111]">
                {item.name}<ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </li>
          ))}
          <li>
            <Link href="/guide/stations" className="flex min-h-11 items-center justify-between gap-2 rounded-[8px] border-2 border-white/80 px-3 text-sm font-black transition hover:bg-white hover:text-[#111111]">
              접수처 전체 보기<ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </li>
          <li>
            <Link href={guide.album ? "/guide/album-review" : "/guide/mv-review"} className="flex min-h-11 items-center justify-between gap-2 rounded-[8px] border-2 border-white/80 px-3 text-sm font-black transition hover:bg-white hover:text-[#111111]">
              {guide.album ? "음반 심의 안내" : "뮤직비디오 심의 안내"}<ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </li>
        </ul>
        <p className="mt-4 text-xs leading-6 text-white/85">심의 결과는 실제 방송 편성을 보장하지 않습니다. 궁금한 점은 <Link href="/support" className="font-black underline underline-offset-4">고객센터</Link>나 <Link href="/faq" className="font-black underline underline-offset-4">FAQ</Link>에서 확인하세요.</p>
      </section>
    </article>
  );
}
