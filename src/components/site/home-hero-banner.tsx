import { HeroMotionToggle } from "@/components/site/hero-motion-toggle";
import { STATION_GUIDES } from "@/lib/station-guides";

const SHAPES = ["circle", "square", "triangle"] as const;

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
 * The home page's opening poster. The headline stays real text (search
 * engines and the English pack read it); the record, play tile and the
 * running band of broadcasters are drawn in CSS, so nothing waits on an image.
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
          <p className="bauhaus-kicker onside-hero-since" style={{ textTransform: "none" }}>
            Since 2017
          </p>
        </div>
        <div className="onside-hero-record" aria-hidden="true" />
        <div className="onside-hero-play" aria-hidden="true" />
        <div className="onside-hero-band">
          <div className="onside-hero-track">
            <StationList />
            <StationList hidden />
          </div>
          <HeroMotionToggle />
        </div>
      </section>
    </div>
  );
}
