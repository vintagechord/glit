import Link from "next/link";

export const metadata = {
  title: "심의 안내",
};

const guideContent = {
  album: {
    title: "음반(음원) 심의 안내",
    description:
      "음반 심의는 트랙 정보, 가사, 음원 파일이 필수입니다. 외국어 가사는 번역본을 함께 제출해주세요.",
    points: [
      "트랙명, 작곡/작사, 피처링 정보를 정확히 기입합니다.",
      "음원 파일은 WAV/ZIP 포맷으로 업로드합니다.",
      "심의 결과는 방송국별로 승인/수정 요청이 표시됩니다.",
    ],
  },
  mv: {
    title: "뮤직비디오 심의 안내",
    description:
      "MV 심의는 유통용/방송용으로 구분하여 접수합니다. 영상 파일과 메타데이터를 함께 제출해주세요.",
    points: [
      "MP4/MOV 영상 파일을 업로드합니다.",
      "러닝타임과 포맷 정보를 입력합니다.",
      "방송 송출용 심의는 별도 기준이 적용될 수 있습니다.",
    ],
  },
};

export default function GuidePage({
  searchParams,
}: {
  searchParams: { tab?: string };
}) {
  const tab = searchParams.tab === "mv" ? "mv" : "album";
  const content = guideContent[tab];

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-12">
      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
        Guide
      </p>
      <h1 className="font-display mt-2 text-3xl text-foreground">심의 안내</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        음반과 MV 심의 접수 준비사항을 확인하세요.
      </p>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          href="/guide?tab=album"
          className={`rounded-full border px-5 py-2 text-xs font-semibold uppercase tracking-[0.2em] ${
            tab === "album"
              ? "border-foreground bg-foreground text-background"
              : "border-border/60 text-foreground"
          }`}
        >
          음반 심의
        </Link>
        <Link
          href="/guide?tab=mv"
          className={`rounded-full border px-5 py-2 text-xs font-semibold uppercase tracking-[0.2em] ${
            tab === "mv"
              ? "border-foreground bg-foreground text-background"
              : "border-border/60 text-foreground"
          }`}
        >
          MV 심의
        </Link>
      </div>

      <div className="mt-8 rounded-[28px] border border-border/60 bg-card/80 p-6">
        <h2 className="text-xl font-semibold text-foreground">
          {content.title}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {content.description}
        </p>
        <div className="mt-4 space-y-3 text-sm text-muted-foreground">
          {content.points.map((point) => (
            <div
              key={point}
              className="rounded-2xl border border-border/60 bg-background/70 px-4 py-3"
            >
              {point}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
