import { HeroMotionToggle } from "@/components/site/hero-motion-toggle";
import { STATION_GUIDES } from "@/lib/station-guides";

const SHAPES = ["circle", "square", "triangle"] as const;

// One period of the waveform, in viewBox units. The SVG holds two periods
// side by side, so sliding it by half loops without a seam.
const WAVE_PERIOD = 480;
const WAVE_HEIGHT = 64;
const WAVE_STEP = 5;

/**
 * Bars of an audio waveform, mirrored around the centre line: a slow
 * envelope (phrases getting louder and quieter) times a fixed per-bar grain.
 * Every term repeats once per period, so both copies match at the seam.
 */
function waveformPath() {
  const bars = WAVE_PERIOD / WAVE_STEP;
  const middle = WAVE_HEIGHT / 2;
  const reach = middle - 2;
  let path = "";
  for (let index = 0; index < bars * 2; index += 1) {
    const bar = index % bars;
    const turn = (bar / bars) * Math.PI * 2;
    const envelope =
      0.5 + 0.27 * Math.sin(2 * turn + 0.6) + 0.15 * Math.sin(5 * turn + 1.9) + 0.06 * Math.sin(11 * turn);
    const grain = 0.6 + 0.4 * Math.abs((Math.sin(bar * 12.9898) * 43758.5453) % 1);
    const half = Math.min(reach, Math.max(1.5, envelope * grain * reach));
    const x = index * WAVE_STEP + WAVE_STEP / 2;
    path += `M${x} ${(middle - half).toFixed(1)}V${(middle + half).toFixed(1)}`;
  }
  return path;
}

const WAVEFORM_PATH = waveformPath();

function StationList({ hidden = false }: { hidden?: boolean }) {
  return (
    <ul aria-label={hidden ? undefined : "심의 접수처"} aria-hidden={hidden || undefined}>
      {STATION_GUIDES.map((station, index) => (
        <li key={station.slug}>
          <span className="onside-hero-mark" data-shape={SHAPES[index % SHAPES.length]} aria-hidden="true" />
          {station.shortName}
        </li>
      ))}
    </ul>
  );
}

/**
 * The home page's opening banner. The headline stays real text (search
 * engines and the English pack read it) and leads; a quiet waveform drifts
 * beneath it and the broadcasters Onside submits to run along the band.
 * Everything is drawn in CSS and inline SVG, so nothing waits on an image.
 */
export function HomeHeroBanner({ lines }: { lines: readonly [string, string] }) {
  return (
    <div className="onside-hero-frame">
      <section className="onside-hero-banner" data-hero-banner data-hero-motion="on">
        <div className="onside-hero-copy">
          <p className="onside-hero-since">Since 2017</p>
          <h1 className="onside-hero-title">
            <span>{lines[0]}</span>
            <span>{lines[1]}</span>
          </h1>
        </div>
        <div className="onside-hero-wave" aria-hidden="true">
          <svg viewBox={`0 0 ${WAVE_PERIOD * 2} ${WAVE_HEIGHT}`} preserveAspectRatio="none" focusable="false">
            <path d={WAVEFORM_PATH} />
          </svg>
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
