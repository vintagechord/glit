import { HeroMotionToggle } from "@/components/site/hero-motion-toggle";
import { STATION_GUIDES } from "@/lib/station-guides";

const point = (radius: number, angle: number) =>
  `${(50 + radius * Math.cos(angle)).toFixed(2)} ${(50 + radius * Math.sin(angle)).toFixed(2)}`;

/**
 * The disc's strobe ring: 90 fine ticks round the rim, every fifteenth one
 * longer, the way a turntable platter is marked. The long ones show it turn.
 */
function strobeTicks(long: boolean) {
  let path = "";
  for (let index = 0; index < 90; index += 1) {
    if ((index % 15 === 0) !== long) continue;
    const angle = (index / 90) * Math.PI * 2;
    path += `M${point(49.6, angle)}L${point(long ? 45 : 47.4, angle)}`;
  }
  return path;
}

// Three bands of grooves with a wider gap between them, like the tracks of
// an album side.
const GROOVE_BANDS: ReadonlyArray<readonly [number, number]> = [
  [41.4, 35.6],
  [34.4, 28.8],
  [27.6, 22.4],
];
const GROOVE_RADII = GROOVE_BANDS.flatMap(([outer, inner]) => {
  const radii: number[] = [];
  for (let radius = outer; radius >= inner; radius -= 0.85) radii.push(Number(radius.toFixed(2)));
  return radii;
});

const SHORT_TICKS = strobeTicks(false);
const LONG_TICKS = strobeTicks(true);

/** A record drawn like a calibration plate, with Onside's yellow square as its label. */
function HeroDisc() {
  return (
    <svg className="onside-hero-disc" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <g className="onside-hero-disc-turn">
        <path className="onside-hero-disc-tick" d={SHORT_TICKS} />
        <path className="onside-hero-disc-tick" data-long d={LONG_TICKS} />
        <circle className="onside-hero-disc-face" cx="50" cy="50" r="42.5" />
        {GROOVE_RADII.map((radius) => (
          <circle key={radius} className="onside-hero-disc-groove" cx="50" cy="50" r={radius} />
        ))}
        <circle className="onside-hero-disc-ring" cx="50" cy="50" r="14.5" />
        <rect className="onside-hero-disc-label" x="44.5" y="44.5" width="11" height="11" rx="0.8" />
        <circle className="onside-hero-disc-hole" cx="50" cy="50" r="1.3" />
      </g>
    </svg>
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
 * The home page's opening banner. The headline stays real text (search
 * engines and the English pack read it) and stands alone at the top; a small
 * record drawn in fine lines turns slowly below it, and the band underneath
 * runs the broadcasters Onside submits to. All of it is CSS and inline SVG,
 * so nothing waits on an image.
 */
export function HomeHeroBanner({ lines }: { lines: readonly [string, string] }) {
  return (
    <div className="onside-hero-frame">
      <section className="onside-hero-banner" data-hero-banner data-hero-motion="on">
        <div className="onside-hero-copy">
          <h1 className="onside-hero-title">
            <span>{lines[0]}</span>
            <span>{lines[1]}</span>
          </h1>
        </div>
        <div className="onside-hero-stage">
          <HeroDisc />
        </div>
        <div className="onside-hero-band">
          <div className="onside-hero-ticker">
            <div className="onside-hero-track">
              <StationList />
              <StationList hidden />
            </div>
          </div>
          <p className="onside-hero-since">Since 2017</p>
          <HeroMotionToggle />
        </div>
      </section>
    </div>
  );
}
