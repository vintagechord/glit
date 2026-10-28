import type { ArchiveData, ArchiveTrack } from "@/lib/music-archive/model";

/** Read linked works without inferring track ownership or registration status. */
export function trackCopyrightCredits(data: Pick<ArchiveData, "recordings" | "works">, tracks: ArchiveTrack[]) {
  if (!tracks.length) return [];
  const recordings = new Map(data.recordings.map(recording => [recording.id, recording]));
  const worksById = new Map(data.works.map(work => [work.id, work]));
  return tracks.flatMap(track => {
    const works = (recordings.get(track.recordingId ?? "")?.workIds ?? []).flatMap(id => {
      const work = worksById.get(id);
      return work ? [work] : [];
    });
    const contributors = [...new Map(works.flatMap(work => work.contributors ?? [])
      .map(person => [JSON.stringify([person.name.trim(), person.role]), { ...person, name: person.name.trim() }])).values()];
    const institutionNumbers = [...new Map(works.flatMap(work => work.institutionNumbers ?? [])
      .map(entry => [JSON.stringify([entry.agency, entry.number]), entry])).values()];
    const writers = [...new Set(works.filter(work => !work.contributors?.length).map(work => work.writers?.trim()).filter(Boolean))];
    return contributors.length || institutionNumbers.length || writers.length ? [{ track, contributors, institutionNumbers, writers }] : [];
  });
}

type TrackCredits = ReturnType<typeof trackCopyrightCredits>[number];
export function CopyrightCreditDetails({ credits }: { credits: TrackCredits }) {
  return <div className="space-y-1 break-words">
    {(["lyrics", "composition", "arrangement"] as const).map(role => {
      const people = credits.contributors.filter(person => person.role === role);
      return people.length ? <p key={role}><span className="mr-2 font-semibold">{{ lyrics: "작사", composition: "작곡", arrangement: "편곡" }[role]}</span>{people.map(person => person.name).join(", ")}</p> : null;
    })}
    {credits.writers.map(writers => <p key={writers}>{writers}</p>)}
    {credits.institutionNumbers.map(entry => <p key={JSON.stringify([entry.agency, entry.number])} className="text-muted-foreground">{entry.agency} · {entry.number}</p>)}
  </div>;
}
