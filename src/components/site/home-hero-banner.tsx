import { HeroMotionToggle } from "@/components/site/hero-motion-toggle";
import { STATION_GUIDES } from "@/lib/station-guides";

const LABEL_TEXT = "ONSIDE · ALBUM & MUSIC VIDEO REVIEW · ";

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

/**
 * The home page's opening banner. A "Since 2017" badge sits above the
 * headline, which stays real text (search engines and the English pack read
 * it); a record turns in the bottom-right corner, and the band underneath
 * runs the broadcasters Onside submits to.
 */
export function HomeHeroBanner({ lines }: { lines: readonly [string, string] }) {
  return (
    <div className="onside-hero-frame">
      <section className="onside-hero-banner" data-hero-banner data-hero-motion="on">
        <HeroRecord />
        <div className="onside-hero-copy">
          <p className="onside-hero-since">Since 2017</p>
          <div className="onside-hero-headline">
            <h1 className="onside-hero-title">
              <span>{lines[0]}</span>
              <span>{lines[1]}</span>
            </h1>
          </div>
        </div>
        <div className="onside-hero-band">
          <div className="onside-hero-ticker">
            <div className="onside-hero-track">
              <StationList />
              <StationList hidden />
            </div>
          </div>
          <HeroMotionToggle />
        </div>
      </section>
    </div>
  );
}
