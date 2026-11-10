import { HeroMotionToggle } from "@/components/site/hero-motion-toggle";
import { STATION_GUIDES } from "@/lib/station-guides";

/**
 * A turntable seen from above, drawn in CSS: a metal platter with strobe dots
 * round its rim, a black record with track gaps in its grooves, a paper label
 * printed with the Onside mark, and the spindle. The platter, record and label
 * turn together; the light on the vinyl and the spindle stay put, the way a
 * real record catches a fixed light as it spins.
 */
function HeroTurntable() {
  return (
    <div className="onside-hero-turntable" aria-hidden="true">
      <div className="onside-hero-platter">
        <div className="onside-hero-vinyl">
          <div className="onside-hero-vinyl-label">
            <span className="onside-hero-vinyl-mark" />
            <span className="onside-hero-vinyl-name">ONSIDE</span>
          </div>
        </div>
      </div>
      <div className="onside-hero-vinyl-sheen" />
      <div className="onside-hero-spindle" />
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
 * it); a turntable turns in the space to its right, and the band underneath
 * runs the broadcasters Onside submits to. All of it is CSS, so nothing waits
 * on an image.
 */
export function HomeHeroBanner({ lines }: { lines: readonly [string, string] }) {
  return (
    <div className="onside-hero-frame">
      <section className="onside-hero-banner" data-hero-banner data-hero-motion="on">
        <div className="onside-hero-copy">
          <p className="onside-hero-since">Since 2017</p>
          <div className="onside-hero-headline">
            <h1 className="onside-hero-title">
              <span>{lines[0]}</span>
              <span>{lines[1]}</span>
            </h1>
            <HeroTurntable />
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
