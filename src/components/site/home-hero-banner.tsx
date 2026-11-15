import { ArrowRight, Check, Link2 } from "lucide-react";

import { HeroCarouselControls } from "@/components/site/hero-carousel-controls";
import { HeroLink, HeroText, HeroTitle, HeroWord } from "@/components/site/hero-text";
import { HERO_INTERVAL_DEFAULT, heroHeadingSlideId, type HeroDesign, type HeroSlide } from "@/lib/home-hero-banners";
import { ONSIDE_FAMILY } from "@/lib/onside-why";
import { STATION_GUIDES } from "@/lib/station-guides";

const LABEL_TEXT = "ONSIDE · ALBUM & MUSIC VIDEO REVIEW · ";

/**
 * The width of each design's own headline in ems, per language. A longer
 * edited headline raises it (see HeroTitle); a shorter one keeps this size.
 */
const TITLE_FLOOR: Record<HeroDesign, { ko: number; en: number }> = {
  record: { ko: 9.6, en: 11.2 },
  url: { ko: 8.3, en: 9.6 },
  certificate: { ko: 8.2, en: 10.2 },
  reasons: { ko: 8.2, en: 10.6 },
};

/**
 * A large record whose centre sits on the banner's bottom-right corner, so
 * about a quarter of it shows, with a tonearm resting on the grooves. The
 * vinyl and its printed label turn; the light on the vinyl and the tonearm
 * stay put, the way a real record turns under a fixed lamp. Drawn in CSS and
 * inline SVG, so nothing waits on an image.
 */
function HeroRecord() {
  return (
    <div className="onside-hero-lp" aria-hidden="true" data-no-translate>
      <div className="onside-hero-lp-body">
        <div className="onside-hero-lp-vinyl">
          <svg className="onside-hero-lp-label" viewBox="0 0 100 100" focusable="false">
            <defs>
              <path id="onside-hero-lp-arc" d="M50 50m-37 0a37 37 0 1 1 74 0a37 37 0 1 1-74 0" />
            </defs>
            <circle className="onside-hero-lp-paper" cx="50" cy="50" r="49.5" />
            <circle className="onside-hero-lp-print" cx="50" cy="50" r="45" />
            <text className="onside-hero-lp-type">
              <textPath href="#onside-hero-lp-arc" textLength="232" lengthAdjust="spacing">
                {LABEL_TEXT.repeat(2)}
              </textPath>
            </text>
            <circle className="onside-hero-lp-print" cx="50" cy="50" r="27" />
            <circle className="onside-hero-lp-spindle" cx="50" cy="50" r="4" />
          </svg>
        </div>
        <div className="onside-hero-lp-sheen" />
        <svg className="onside-hero-tonearm" viewBox="0 0 200 200" focusable="false">
          <defs>
            <linearGradient id="onside-hero-arm-metal" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#f5f6f8" />
              <stop offset="0.55" stopColor="#a4a8ae" />
              <stop offset="1" stopColor="#e3e5e9" />
            </linearGradient>
            <radialGradient id="onside-hero-arm-pivot" cx="0.35" cy="0.3" r="0.8">
              <stop offset="0" stopColor="#fafafa" />
              <stop offset="0.5" stopColor="#9da1a7" />
              <stop offset="1" stopColor="#4b4e53" />
            </radialGradient>
          </defs>
          <path className="onside-hero-tonearm-rod" d="M96.5 5.5L57 44" />
          <g transform="translate(56.4 44.6) rotate(135.7)">
            <rect x="-1.6" y="-2.7" width="9.4" height="5.4" rx="0.9" fill="#1c1d20" stroke="#5a5d62" strokeWidth="0.4" />
            <rect x="6.1" y="-1.7" width="2.2" height="3.4" rx="0.4" fill="#c7cace" />
          </g>
          <circle cx="98" cy="4" r="8.5" fill="url(#onside-hero-arm-pivot)" />
          <circle cx="98" cy="4" r="3.4" fill="#2a2c30" />
        </svg>
      </div>
    </div>
  );
}

/**
 * The album that is already out: its sleeve in the top-right corner, the
 * record half drawn from it. The sleeve art is three flat shapes, a red sun
 * rising over a black horizon with the logo's yellow square.
 */
function HeroJacket() {
  return (
    <div className="onside-hero-jacket" aria-hidden="true">
      <div className="onside-hero-jacket-body">
        <span className="onside-hero-jacket-disc" />
        <span className="onside-hero-jacket-art" />
      </div>
    </div>
  );
}

/**
 * The released-album banner's whole point, shown as it happens: an album
 * address lands in the field and the application is written. The address is
 * a real Melon album address shape; when the slide comes up it types in once,
 * then the confirmation appears.
 */
function HeroUrlField() {
  return (
    <div className="onside-hero-url" aria-hidden="true" data-no-translate>
      <Link2 className="onside-hero-url-icon" strokeWidth={2.4} />
      <span className="onside-hero-url-type">
        <span className="onside-hero-url-text">melon.com/album/detail.htm?albumId=12345678</span>
      </span>
      <span className="onside-hero-url-caret" />
      <span className="onside-hero-url-done">
        <Check strokeWidth={3.2} />
        <HeroWord ko="신청서 작성 끝" en="Form filled in" />
      </span>
    </div>
  );
}

/**
 * What a distributor asks for with a music video: the video carrying its
 * rating mark, and the certificate that proves the rating. A lit sheet of
 * paper stamped 심의필 in red, over a frame of the video.
 */
function HeroCertificate() {
  return (
    <div className="onside-hero-cert" aria-hidden="true" data-no-translate>
      <div className="onside-hero-cert-frame">
        <span className="onside-hero-cert-mark">ALL</span>
      </div>
      <div className="onside-hero-cert-paper">
        <span className="onside-hero-cert-title"><HeroWord ko="등급분류 필증" en="Rating certificate" /></span>
        <span className="onside-hero-cert-rule" />
        <span className="onside-hero-cert-line" />
        <span className="onside-hero-cert-line" />
        <span className="onside-hero-cert-line" />
        <span className="onside-hero-cert-seal"><HeroWord ko="심의필" en="RATED" /></span>
      </div>
    </div>
  );
}

/**
 * 빈티지하우스's music brands as a short pile of cases seen spine-on, the way
 * records and tapes sit on a shelf: Onside's on top in the logo's yellow, the
 * beat market, the store, the studio and the repair shop under it.
 */
function HeroShelf() {
  return (
    <div className="onside-hero-shelf" aria-hidden="true" data-no-translate>
      <ul>
        {ONSIDE_FAMILY.map((brand) => (
          <li key={brand.key} data-brand={brand.key}>
            <span className="onside-hero-shelf-cap" />
            <HeroWord ko={brand.name} en={brand.nameEn} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function StationList({ hidden = false }: { hidden?: boolean }) {
  return (
    <ul aria-label={hidden ? undefined : "심의 접수처"} aria-hidden={hidden || undefined}>
      {STATION_GUIDES.map((station) => (
        <li key={station.slug}>
          <span className="onside-hero-mark" aria-hidden="true" />
          {station.shortName}
        </li>
      ))}
    </ul>
  );
}

function HeroSlideView({ slide, position, count, heading, linked }: { slide: HeroSlide; position: number; count: number; heading: boolean; linked: boolean }) {
  const { design, ko, en } = slide;
  return (
    <div
      className={`onside-hero-slide onside-hero-slide--${design}`}
      data-hero-slide
      data-hero-design={design}
      data-active={position === 0 ? "" : undefined}
      role="group"
      aria-roledescription="slide"
      aria-label={`${position + 1} / ${count}`}
    >
      {design === "record" ? <HeroRecord /> : null}
      {design === "url" ? <HeroJacket /> : null}
      {design === "certificate" ? <HeroCertificate /> : null}
      {design === "reasons" ? <HeroShelf /> : null}
      <div className="onside-hero-copy">
        {design === "record" && ko.badge ? <HeroText className="onside-hero-since" ko={ko.badge} en={en?.badge ?? null} /> : null}
        <div className="onside-hero-headline">
          <HeroTitle as={heading ? "h1" : "h2"} ko={ko.headline} en={en?.headline ?? null} floor={TITLE_FLOOR[design]} />
        </div>
        {design === "certificate" && ko.body ? <HeroText className="onside-hero-body" ko={ko.body} en={en?.body ?? null} /> : null}
        {design === "url" ? <HeroUrlField /> : null}
        {/* The whole banner is the link; this says where it goes. */}
        {design === "reasons" && ko.body ? (
          <p className="onside-hero-cta" {...(en?.body ? { "data-no-translate": true } : {})}>
            <HeroWord ko={ko.body} en={en?.body ?? ko.body} />
            <ArrowRight aria-hidden="true" strokeWidth={2.8} />
          </p>
        ) : null}
      </div>
      {linked && slide.linkUrl ? <HeroLink href={slide.linkUrl} ko={ko.headline} en={en?.headline ?? null} /> : null}
    </div>
  );
}

/**
 * The home page's opening banner: a short carousel of the banners set under
 * 메인 배너 관리. Headlines stay real text (search engines read the brand
 * banner's as the page's h1). The slides swipe on their own; the band
 * underneath runs the broadcasters Onside submits to and holds the controls.
 * `preview` is the admin page's look at one banner: no page heading, no link.
 */
export function HomeHeroBanner({
  slides,
  intervalSeconds = HERO_INTERVAL_DEFAULT,
  preview = false,
}: {
  slides: HeroSlide[];
  intervalSeconds?: number;
  preview?: boolean;
}) {
  const headingId = preview ? null : heroHeadingSlideId(slides);
  return (
    <div className="onside-hero-frame">
      <section
        className="onside-hero-banner"
        data-hero-banner
        data-hero-motion="on"
        data-hero-field={slides[0]?.design}
        aria-roledescription="carousel"
        aria-label="온사이드 안내 배너"
      >
        <div className="onside-hero-slides" data-hero-slides>
          {slides.map((slide, position) => (
            <HeroSlideView key={slide.id} slide={slide} position={position} count={slides.length} heading={slide.id === headingId} linked={!preview} />
          ))}
        </div>
        <div className="onside-hero-band">
          <div className="onside-hero-ticker">
            <div className="onside-hero-track">
              <StationList />
              <StationList hidden />
            </div>
          </div>
          <HeroCarouselControls count={slides.length} intervalSeconds={intervalSeconds} />
        </div>
      </section>
    </div>
  );
}
