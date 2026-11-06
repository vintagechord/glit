/** Slugs and labels of the review guides, light enough for client bundles. */
export const REVIEW_GUIDE_LINKS = [
  { slug: "album-review", menuLabel: "음반 심의" },
  { slug: "mv-review", menuLabel: "뮤직비디오 심의" },
] as const;

/** The topic pages under /guide that are not a review type: linked from the footer, home and guide index. */
export const GUIDE_TOPIC_LINKS = [
  { path: "/guide/stations", label: "방송국별 안내", summary: "영등위·KBS·MBC·SBS부터 국악방송까지 접수처 18곳" },
  { path: "/guide/pricing", label: "심의 비용", summary: "방송국 패키지 · 뮤직비디오 항목별 비용" },
  { path: "/guide/glossary", label: "심의 용어집", summary: "적격·부적격·등급분류·필증 뜻" },
] as const;
