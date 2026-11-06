import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { JsonLd } from "@/components/seo/json-ld";
import { loadAlbumPackages } from "@/lib/review-guide-pricing";
import { absoluteUrl, breadcrumbJsonLd, pageMetadata } from "@/lib/seo";
import { getLocalStationLogoSource } from "@/lib/station-logos";
import { STATION_GROUPS, STATION_GUIDES, stationSummary } from "@/lib/station-guides";

// Public, crawlable: rebuilt hourly so package edits show within the hour.
export const revalidate = 3600;

export const metadata = pageMetadata({
  title: `음반 심의·뮤직비디오 심의 접수처 · 영등위·KBS·MBC·SBS부터 국악방송까지 ${STATION_GUIDES.length}곳`,
  description: "온사이드가 뮤직비디오 심의와 음반 심의를 접수하는 곳의 목록입니다. 영등위(영상물등급위원회) 등급분류와 ETN·Mnet 뮤직비디오 심의, KBS·MBC·SBS 지상파, YTN·TBS·TBN 보도·교통, CBS·PBC·BBS·WBS·극동방송 종교, KISS·경인 iFM·국악방송, Arirang까지 접수처별 신청 방법과 비용을 안내합니다.",
  path: "/guide/stations",
  keywords: ["영등위 심의", "뮤직비디오 심의 접수처", "음반 심의 방송국", "방송국 심의 목록", "라디오 심의 방송국", "KBS MBC SBS 심의", "방송국별 심의", "심의 방송국 패키지"],
});

export default async function StationGuidesPage() {
  const packages = await loadAlbumPackages();
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
      <JsonLd data={breadcrumbJsonLd([{ name: "홈", path: "/" }, { name: "심의 안내", path: "/guide" }, { name: "방송국별 안내", path: "/guide/stations" }])} />
      <JsonLd data={{
        "@context": "https://schema.org",
        "@type": "ItemList",
        name: "온사이드 심의 접수 방송국",
        itemListElement: STATION_GUIDES.map((station, index) => ({
          "@type": "ListItem", position: index + 1, name: station.name, url: absoluteUrl(`/guide/stations/${station.slug}`),
        })),
      }} />

      <nav aria-label="현재 위치" className="text-xs font-bold text-muted-foreground">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li><Link href="/" className="underline-offset-4 hover:underline">홈</Link></li>
          <li aria-hidden="true">/</li>
          <li><Link href="/guide" className="underline-offset-4 hover:underline">심의 안내</Link></li>
          <li aria-hidden="true">/</li>
          <li aria-current="page" className="text-foreground">방송국별 안내</li>
        </ol>
      </nav>

      <header className="mt-5">
        <p className="bauhaus-kicker">방송국별 안내</p>
        <h1 className="font-display mt-4 break-keep text-3xl font-black leading-tight text-foreground sm:text-4xl">음반 심의·뮤직비디오 심의 접수 방송국</h1>
        <p className="mt-5 break-keep text-base leading-8 text-foreground/85">
          뮤직비디오를 온라인에 유통하려면 영등위(영상물등급위원회) 등급분류를 받고, 필요하면 Mnet·ETN을 함께 추가합니다. TV에 송출할 뮤직비디오는 KBS·MBC·SBS·ETN 방송국별 심의를 받습니다. 음반 심의는 방송국마다 따로 받으며, 온사이드는 KBS·MBC·SBS 3곳 패키지부터 15곳 패키지까지 방송국 묶음으로 접수합니다. 접수처를 고르면 심의 안내, 포함 패키지와 비용, 결과 확인 방법을 볼 수 있습니다.
        </p>
      </header>

      {STATION_GROUPS.map((group) => {
        const stations = STATION_GUIDES.filter((station) => station.group === group);
        if (!stations.length) return null;
        return (
          <section key={group} className="mt-10">
            <h2 className="font-display break-keep text-2xl font-black text-foreground">{group}</h2>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {stations.map((station) => {
                const logo = getLocalStationLogoSource(station);
                const summary = stationSummary(station, packages);
                return (
                  <li key={station.slug}>
                    <Link href={`/guide/stations/${station.slug}`} className="group flex min-h-20 items-center gap-4 rounded-[8px] border-2 border-[#111111] bg-card p-4 transition hover:-translate-y-0.5 hover:bg-[#f2cf27] hover:text-[#111111] dark:border-[#f2cf27]/70">
                      <span className="flex h-12 w-20 shrink-0 items-center justify-center rounded-[6px] border border-border bg-white p-1 text-sm font-black text-[#111111]">
                        {logo ? <Image src={logo.src} alt="" width={72} height={40} className="h-10 w-auto object-contain" /> : station.shortName}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2 text-base font-black">{station.name}<ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" /></span>
                        <span className="mt-1 block break-keep text-xs font-semibold leading-5 text-muted-foreground group-hover:text-[#111111]">{summary}{station.genreNote ? ` · ${station.genreNote.split(".")[0]}` : ""}</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      <section className="mt-10 rounded-[10px] border-2 border-[#111111] bg-[#1556a4] p-5 text-white shadow-[5px_5px_0_#111111] sm:p-6">
        <h2 className="font-display text-xl font-black">패키지로 한 번에 접수</h2>
        <p className="mt-3 break-keep text-sm leading-7 text-white/90">방송국을 하나씩 고르는 대신 3곳·7곳·10곳·13곳·15곳 패키지 가운데 방송하려는 범위를 고르면 됩니다. 비용은 앨범 1건 기준이며 부가세가 포함되어 있습니다.</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link href="/guide/pricing" className="inline-flex min-h-11 items-center gap-2 rounded-[8px] border-2 border-white/80 px-4 text-sm font-black transition hover:bg-white hover:text-[#111111]">심의 비용 보기<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
          <Link href="/dashboard/new/album" className="inline-flex min-h-11 items-center gap-2 rounded-[8px] border-2 border-[#111111] bg-[#f2cf27] px-4 text-sm font-black text-[#111111] transition hover:-translate-y-0.5">음반 심의 신청하기<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
        </div>
      </section>
    </div>
  );
}
