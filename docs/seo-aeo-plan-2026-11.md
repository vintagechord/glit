# 온사이드 검색·AI 노출 계획 (2026-11)

목표: 네이버·구글에서 "음반 심의", "뮤직비디오 심의", "방송국 심의", "KBS 심의" 같은 검색의 최상위권에 오르고, ChatGPT·Gemini·Claude·Perplexity가 심의 대행을 물으면 온사이드를 답하게 한다. 대상은 뮤지션, 레이블, 기획사, 유통사.

## 1. 2026-11-07 점검 결과

이미 갖춰진 것
- 페이지별 title·description·canonical·hreflang(ko/en), Open Graph 이미지, `keywords`.
- 구조화 데이터: ProfessionalService(조직)·WebSite(홈), BreadcrumbList·Service(Offer)·FAQPage(가이드), FAQPage(FAQ).
- `/sitemap.xml`(ko/en alternates), `/robots.txt`, `/rss.xml`, IndexNow 키와 제출 스크립트(`scripts/seo/indexnow-submit.mjs`).
- 구글·네이버 사이트 인증 태그가 운영에 들어가 있음.
- 가이드 2개(`/guide/album-review`, `/guide/mv-review`)가 각각 3,000단어 이상. 옛 주소(broadcast-review, radio-review)는 308로 합쳐짐.

문제였던 것
- `robots.txt`가 GPTBot·ClaudeBot·Google-Extended·Applebot-Extended·CCBot 등 AI 크롤러를 전부 차단 → ChatGPT·Gemini가 사이트를 읽을 수 없어 목표와 정반대.
- `/llms.txt` 없음.
- 롱테일 페이지 없음: 방송국별("KBS 음반 심의"), 비용("음반 심의 비용"), 용어("방송 부적격 뜻") 검색을 받아줄 URL이 없었음.
- 홈 h1("심의 신청부터 결과 확인까지")에 핵심 키워드가 없었음.

## 2. 이번에 반영한 코드 (PR)

- `robots.ts`: AI 비서 크롤러 허용. SEO 도구 크롤러(Ahrefs·Semrush·MJ12 등)와 Bytespider만 차단 유지.
- `/llms.txt`: 서비스 사실·비용·안내 페이지·방송국·FAQ·용어를 Markdown 한 장으로. 가이드와 같은 데이터에서 만들어 어긋나지 않음. 1시간 ISR.
- 방송국별 안내 17페이지 `/guide/stations/[station]` + 허브 `/guide/stations`: 데이터는 `src/lib/station-guides.ts`. 포함 패키지·비용은 운영 카탈로그에서 읽고, KBS·MBC·SBS·CBS·Arirang은 심의 후 신청곡 보내는 공식 링크까지 실음. Service·FAQPage·Breadcrumb JSON-LD.
- `/guide/pricing`: 음반·뮤직비디오 비용 총정리 + 결제·증빙 FAQ.
- `/guide/glossary`: 용어 23개, DefinedTermSet JSON-LD.
- 홈 h1 → "음반·뮤직비디오 심의, 신청부터 결과 확인까지". 홈·가이드 목차·푸터·가이드 하단에 새 페이지 링크.
- 조직 JSON-LD에 `sameAs`(onside17.com)·`slogan` 추가. 사이트맵에 21개 URL 추가, lastmod 2026-11-07.
- 영문 alias(`/en/guide/stations…`, `/en/guide/pricing`, `/en/guide/glossary`): 본문은 한국어 페이지, canonical은 한국어.

배포 뒤 할 일
1. `node scripts/seo/indexnow-submit.mjs` 실행 (네이버·Bing에 새 URL 알림).
2. Google Search Console·네이버 서치어드바이저에서 사이트맵 재요청, `/guide/stations/kbs` 등 URL 검사로 색인 요청.
3. 1~2주 뒤 Search Console "검색 결과" 보고서에서 새 페이지 노출·클릭 확인.

## 3. 앞으로 한 달 계획

### 1주차 — 측정 기반과 엔티티
- [ ] Search Console·네이버 서치어드바이저 데이터 확인 체계 (주 1회 캡처).
- [ ] 네이버 스마트플레이스·Google 비즈니스 프로필 등록 (사업자: (주)빈티지하우스, 김포). 지도·리뷰·전화가 AI 답변의 근거가 된다.
- [ ] 조직 `sameAs`에 공식 SNS·블로그·유튜브·네이버 플레이스 주소 추가 (주소 받으면 코드 반영).
- [ ] 온사이드 소개(`/about`)에 연혁·누적 접수 수·운영 방식 등 사실 문장 보강 → AI가 인용할 "누구인가" 문단.

### 2주차 — 콘텐츠 허브
- [ ] 매거진을 글 단위 URL(`/magazine/[slug]`)과 Article JSON-LD·RSS로 바꿔 꾸준히 발행할 수 있는 블로그로 전환. 지금은 크레딧·발행 요청 페이지라 검색에 기여하지 않음.
- [ ] 첫 글 10편(질문형 제목): "음반 심의 부적격 사유 TOP", "심의 가사 제출 체크리스트", "발매 전 vs 발매 후 심의", "뮤직비디오 등급분류 19금 기준", "KBS·MBC·SBS 심의 기간", "라디오 신청곡 보내는 법", "심의용 CD가 필요한 경우", "외국어 가사 번역 요령", "세금계산서·현금영수증", "독립 뮤지션이 방송국 심의를 받아야 하는 이유".
- [ ] 각 글 하단에 신청 CTA와 관련 가이드 링크.

### 3주차 — 네이버 집중
- [ ] 네이버 블로그·카페·지식iN은 네이버 검색 상단을 차지하므로, 공식 네이버 블로그를 열고 매거진 글을 요약 + 사이트 링크로 재게시 (주 2회).
- [ ] 지식iN "음반 심의", "뮤비 심의" 질문에 공식 답변 (회사 계정, 광고성 아닌 사실 답변 + 링크).
- [ ] 네이버 서치어드바이저 "웹페이지 수집 요청"으로 신규 URL 즉시 반영.

### 4주차 — AI 답변 점검과 보강
- [ ] ChatGPT·Gemini·Claude·Perplexity에 "한국 음반 심의 대행", "뮤직비디오 심의 어디서", "KBS 가요 심의 신청" 등 20개 질문을 던져 온사이드 언급 여부 표로 기록 (매주 반복).
- [ ] 언급이 없는 질문은 그 질문을 제목으로 한 글이나 FAQ를 추가 → 다음 주 재측정.
- [ ] 고객 후기·사례(아티스트 동의 하에)를 `/about` 또는 매거진에 실어 신뢰 신호 확보. 평점 구조화 데이터는 실제 리뷰 시스템이 생긴 뒤에만.

### 계속할 것
- 공개 페이지가 바뀔 때마다 IndexNow 실행, 사이트맵 lastmod 갱신.
- 비용·방송국이 바뀌면 가이드·llms.txt는 자동 반영되지만 `station-guides.ts`의 문장(포함 패키지 설명)은 확인.
- Core Web Vitals는 현재 양호(ISR·정적 가이드). 새 페이지도 모두 정적/ISR.

## 4. 코드 밖에서 사장님이 결정할 것
- 공식 SNS·블로그·유튜브 주소와 네이버 플레이스 등록 여부.
- 매거진을 블로그로 바꾸는 방향(기존 크레딧·발행 요청 기능과의 관계).
- 후기·사례 공개 범위, 누적 접수 수 같은 숫자를 사이트에 밝힐지.
- 유료 검색 광고(네이버 파워링크·구글 Ads)를 병행할지 — 코드 작업과 별개로 초기 유입에는 가장 빠른 수단.
