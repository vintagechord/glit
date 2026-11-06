"use client";

import * as React from "react";
import Link from "next/link";
import { CheckCircle2, FileSearch, Plus, Trash2, UploadCloud } from "lucide-react";

import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import { MV_DESIRED_RATING_OPTIONS } from "@/lib/mv-request-options";
import type { IntakeDraft, IntakeKind, IntakeTrackDraft } from "@/lib/admin/reference-import";

type IntakePackage = { id: string; name: string; stationCount: number; priceKrw: number; stations: string[] };
type StationPrice = { code: string; priceKrw: number };
type Options = { packages: IntakePackage[]; mv: { basePriceKrw: number; onlineOptions: StationPrice[]; broadcastStations: StationPrice[] } };
type Created = { submissionId: string; guestToken: string; trackUrl: string; detailPath: string; created: boolean };

const kindLabels: Record<IntakeKind, { title: string; note: string }> = {
  ALBUM: { title: "음반 심의", note: "방송사별 음반 접수 · 패키지 선택" },
  MV_DISTRIBUTION: { title: "뮤비 온라인 심의", note: "영등위 · 유통사 제출용" },
  MV_BROADCAST: { title: "뮤비 방송용 심의", note: "KBS·MBC·SBS 심의 · ETN 입고" },
};

const emptyTrack = (): IntakeTrackDraft => ({
  trackTitle: "", isTitle: false, performer: "", featuring: "", composer: "", lyricist: "", arranger: "", lyrics: "", translatedLyrics: "",
});

const emptyDraft = (kind: IntakeKind): IntakeDraft => ({
  kind, format: "manual", fileName: "", warnings: [],
  applicant: { name: "", email: "", phone: "" },
  album: { title: "", artistName: "", artistNameEn: "", releaseDate: "", genre: "", distributor: "", productionCompany: "", previousRelease: "", artistType: "", artistMembers: "" },
  tracks: kind === "ALBUM" ? [emptyTrack()] : [],
  mv: {
    title: "", artistName: "", releaseDate: "", genre: "", runtime: "", director: "", leadActor: "", storyline: "",
    productionCompany: "", agency: "", albumTitle: "", productionDate: "", distributionCompany: "", businessRegNo: "",
    usage: "", desiredRating: "", memo: "", songTitleKr: "", songTitleEn: "", composer: "", lyricist: "", arranger: "", lyrics: "",
  },
});

const inputClass = "w-full min-w-0 rounded-[8px] border-2 border-border bg-background px-3 py-2 text-sm font-semibold text-foreground outline-none transition focus:border-[#1556a4]";
const won = (value: number) => `${value.toLocaleString()}원`;

function Field({ label, required, children, wide }: { label: string; required?: boolean; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={`grid min-w-0 gap-1 ${wide ? "md:col-span-2" : ""}`}>
      <span className="text-[11px] font-black text-muted-foreground">
        {label}{required ? <span className="ml-0.5 text-[#d9362c]">*</span> : null}
      </span>
      {children}
    </label>
  );
}

function Section({ title, children, note }: { title: string; children: React.ReactNode; note?: string }) {
  return (
    <section className="rounded-[12px] border-2 border-border bg-card p-4">
      <h2 className="text-base font-black text-foreground">{title}</h2>
      {note ? <p className="mt-1 text-xs font-semibold text-muted-foreground">{note}</p> : null}
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function DirectIntakeForm() {
  const [kind, setKind] = React.useState<IntakeKind>("ALBUM");
  const [file, setFile] = React.useState<File | null>(null);
  const [draft, setDraft] = React.useState<IntakeDraft | null>(null);
  const [options, setOptions] = React.useState<Options | null>(null);
  const [optionsError, setOptionsError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<"analyze" | "submit" | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [created, setCreated] = React.useState<Created | null>(null);
  const [guest, setGuest] = React.useState({ name: "", phone: "", email: "", company: "" });
  const [packageId, setPackageId] = React.useState("");
  const [stationCodes, setStationCodes] = React.useState<string[]>([]);
  const [paid, setPaid] = React.useState<boolean | null>(null);
  const [adminMemo, setAdminMemo] = React.useState("");
  const requestId = React.useRef<string | null>(null);

  React.useEffect(() => {
    fetchWithTimeout("/api/admin/intake", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || "패키지 목록을 불러오지 못했습니다.");
        setOptions(body as Options);
      })
      .catch((reason) => setOptionsError(reason instanceof Error ? reason.message : "패키지 목록을 불러오지 못했습니다."));
  }, []);

  const startDraft = (next: IntakeDraft) => {
    setDraft(next);
    setGuest((current) => ({
      name: current.name || next.applicant.name,
      phone: current.phone || next.applicant.phone,
      email: current.email || next.applicant.email,
      company: current.company,
    }));
    requestId.current = crypto.randomUUID();
    setCreated(null);
  };

  async function analyze() {
    if (!file || busy) return;
    setBusy("analyze"); setError(null);
    try {
      const form = new FormData();
      form.set("kind", kind);
      form.set("file", file);
      const response = await fetchWithTimeout("/api/admin/intake/analyze", { method: "POST", body: form }, 90_000);
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.draft) throw new Error(body.error || "신청서를 분석하지 못했습니다.");
      const next = body.draft as IntakeDraft;
      startDraft(next.kind === "ALBUM" && next.tracks.length === 0 ? { ...next, tracks: [emptyTrack()] } : next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "신청서를 분석하지 못했습니다.");
    } finally { setBusy(null); }
  }

  const reset = () => {
    setDraft(null); setFile(null); setCreated(null); setError(null);
    setGuest({ name: "", phone: "", email: "", company: "" });
    setPackageId(""); setStationCodes([]); setPaid(null); setAdminMemo("");
    requestId.current = null;
  };

  const updateAlbum = (patch: Partial<IntakeDraft["album"]>) => setDraft((current) => current && { ...current, album: { ...current.album, ...patch } });
  const updateMv = (patch: Partial<IntakeDraft["mv"]>) => setDraft((current) => current && { ...current, mv: { ...current.mv, ...patch } });
  const updateTrack = (index: number, patch: Partial<IntakeTrackDraft>) => setDraft((current) => current && {
    ...current, tracks: current.tracks.map((track, i) => (i === index ? { ...track, ...patch } : track)),
  });

  const selectedPackage = options?.packages.find((item) => item.id === packageId) ?? null;
  const mvStations = kind === "MV_BROADCAST" ? options?.mv.broadcastStations ?? [] : options?.mv.onlineOptions ?? [];
  const mvAmount = kind === "ALBUM" ? 0
    : (kind === "MV_DISTRIBUTION" ? options?.mv.basePriceKrw ?? 0 : 0)
      + mvStations.filter((station) => stationCodes.includes(station.code)).reduce((sum, station) => sum + station.priceKrw, 0);
  const amount = kind === "ALBUM" ? selectedPackage?.priceKrw ?? 0 : mvAmount;

  function validate(): string | null {
    if (!draft) return "신청서를 분석하거나 직접 입력을 시작해주세요.";
    if (!guest.name.trim()) return "고객 이름을 입력해주세요.";
    if (guest.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guest.email.trim())) return "고객 이메일 형식을 확인해주세요.";
    if (paid === null) return "결제 상태를 선택해주세요.";
    if (kind === "ALBUM") {
      if (!packageId) return "패키지를 선택해주세요.";
      if (!draft.album.title.trim() || !draft.album.artistName.trim()) return "앨범 제목과 아티스트명을 입력해주세요.";
      if (!draft.tracks.some((track) => track.trackTitle.trim())) return "곡 제목이 있는 트랙을 1곡 이상 입력해주세요.";
      if (draft.tracks.some((track) => !track.trackTitle.trim() && (track.lyrics.trim() || track.composer.trim()))) return "곡 제목이 비어 있는 트랙이 있습니다. 제목을 입력하거나 트랙을 삭제해주세요.";
    } else {
      if (!draft.mv.title.trim() || !draft.mv.artistName.trim()) return "뮤직비디오 곡명과 아티스트명을 입력해주세요.";
      if (kind === "MV_BROADCAST" && stationCodes.length === 0) return "신청 방송사를 1곳 이상 선택해주세요.";
    }
    return null;
  }

  async function submit() {
    if (busy || !draft) return;
    const problem = validate();
    if (problem) { setError(problem); return; }
    requestId.current ??= crypto.randomUUID();
    const guestPayload = { name: guest.name.trim(), phone: guest.phone.trim(), email: guest.email.trim(), company: guest.company.trim() };
    const payload = kind === "ALBUM"
      ? {
        kind, requestId: requestId.current, packageId, paid, guest: guestPayload,
        submission: {
          title: draft.album.title, artistName: draft.album.artistName, artistNameEn: draft.album.artistNameEn,
          releaseDate: draft.album.releaseDate || null, genre: draft.album.genre, distributor: draft.album.distributor,
          productionCompany: draft.album.productionCompany, previousRelease: draft.album.previousRelease,
          artistType: draft.album.artistType || null, artistMembers: draft.album.artistType === "GROUP" ? draft.album.artistMembers : "",
          applicantName: draft.applicant.name, applicantEmail: draft.applicant.email, applicantPhone: draft.applicant.phone,
          adminMemo: [adminMemo.trim(), draft.fileName ? `기준파일: ${draft.fileName}` : ""].filter(Boolean).join("\n"),
        },
        tracks: draft.tracks.filter((track) => track.trackTitle.trim()).map((track) => ({ ...track, broadcastSelected: false })),
      }
      : {
        kind, requestId: requestId.current, paid, stationCodes, guest: guestPayload,
        mv: {
          ...draft.mv, desiredRating: kind === "MV_DISTRIBUTION" ? draft.mv.desiredRating : "",
          applicantName: draft.applicant.name, applicantEmail: draft.applicant.email, applicantPhone: draft.applicant.phone,
          adminMemo: [adminMemo.trim(), draft.fileName ? `기준파일: ${draft.fileName}` : ""].filter(Boolean).join("\n"),
        },
      };
    setBusy("submit"); setError(null);
    try {
      const response = await fetchWithTimeout("/api/admin/intake", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      }, 60_000);
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.submissionId) throw new Error(body.error || "접수를 만들지 못했습니다.");
      setCreated(body as Created);
    } catch (reason) {
      setError(reason instanceof Error ? `${reason.message} 같은 내용으로 다시 누르면 중복 없이 이어서 처리합니다.` : "접수를 만들지 못했습니다.");
    } finally { setBusy(null); }
  }

  if (created) {
    return (
      <div className="mt-6 rounded-[14px] border-2 border-[#111111] bg-card p-5 shadow-[5px_5px_0_#1f7a5a] dark:border-[#f2cf27]">
        <p className="flex items-center gap-2 text-lg font-black text-foreground">
          <CheckCircle2 className="h-6 w-6 text-[#1f7a5a]" aria-hidden="true" />
          {created.created ? "비회원 접수를 만들었습니다." : "이미 만들어진 같은 접수를 찾았습니다."}
        </p>
        <dl className="mt-4 grid gap-2 text-sm md:grid-cols-[120px_1fr]">
          <dt className="font-black text-muted-foreground">고객 결과 페이지</dt>
          <dd><a href={created.trackUrl} target="_blank" rel="noreferrer" className="select-all break-all font-mono font-semibold text-[#1556a4] underline underline-offset-4 dark:text-sky-300">{created.trackUrl}</a></dd>
          <dt className="font-black text-muted-foreground">조회 코드</dt>
          <dd className="select-all break-all font-mono font-semibold">{created.guestToken}</dd>
        </dl>
        <p className="mt-3 text-xs font-semibold leading-5 text-muted-foreground">
          {paid && guest.email.trim()
            ? "결제 완료로 등록해 고객 이메일로 접수 안내(결과 페이지 주소·조회 코드)가 자동 발송됩니다. 접수 상세의 이메일 발송 내역에서 확인할 수 있습니다."
            : "자동 안내 메일은 발송되지 않았습니다. 결과 페이지 주소와 조회 코드를 고객에게 직접 전달해주세요."}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href={created.detailPath} className="inline-flex h-10 items-center rounded-[8px] border-2 border-[#111111] bg-[#f2cf27] px-4 text-sm font-black text-[#111111]">
            접수 상세 열기
          </Link>
          <button type="button" onClick={reset} className="inline-flex h-10 items-center rounded-[8px] border-2 border-border bg-background px-4 text-sm font-black text-foreground">
            새 접수 작성
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-5">
      <Section title="1. 심의 유형과 기준파일" note="고객이 보낸 신청서(HWP·HWPX·DOC·DOCX, 4MB 이하)를 분석해 아래 항목을 채웁니다. 분석 결과는 저장 전에 확인·수정할 수 있습니다.">
        <div className="grid gap-2 md:grid-cols-3" role="radiogroup" aria-label="심의 유형">
          {(Object.keys(kindLabels) as IntakeKind[]).map((value) => {
            const active = kind === value;
            const locked = Boolean(draft) && (value === "ALBUM") !== (kind === "ALBUM");
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={locked}
                onClick={() => { setKind(value); setStationCodes([]); setDraft((current) => current && { ...current, kind: value }); }}
                className={[
                  "rounded-[10px] border-2 p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-40",
                  active ? "border-[#111111] bg-[#f2cf27] text-[#111111] shadow-[3px_3px_0_#111111]" : "border-border bg-background text-foreground hover:border-[#111111]",
                ].join(" ")}
              >
                <span className="block text-sm font-black">{kindLabels[value].title}</span>
                <span className="block text-[11px] font-semibold opacity-75">{kindLabels[value].note}</span>
              </button>
            );
          })}
        </div>
        {!draft ? (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-[8px] border-2 border-[#111111] bg-background px-3 text-sm font-black text-foreground dark:border-[#f2cf27]">
              <UploadCloud className="h-4 w-4" aria-hidden="true" />
              {file ? file.name : "기준파일 선택"}
              <input
                type="file"
                accept=".hwp,.hwpx,.doc,.docx"
                className="sr-only"
                onChange={(event) => { setFile(event.target.files?.[0] ?? null); setError(null); }}
              />
            </label>
            <button
              type="button"
              onClick={analyze}
              disabled={!file || busy !== null}
              className="inline-flex h-10 items-center gap-2 rounded-[8px] border-2 border-[#111111] bg-[#1556a4] px-4 text-sm font-black text-white disabled:opacity-50"
            >
              <FileSearch className="h-4 w-4" aria-hidden="true" />
              {busy === "analyze" ? "분석 중…" : "분석해서 채우기"}
            </button>
            <button type="button" onClick={() => startDraft(emptyDraft(kind))} className="text-sm font-black underline underline-offset-4">
              파일 없이 직접 입력
            </button>
          </div>
        ) : (
          <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
            <span className="font-bold text-foreground">
              {draft.fileName ? `기준파일: ${draft.fileName} (${draft.format.toUpperCase()})` : "직접 입력"}
            </span>
            <button type="button" onClick={reset} className="text-xs font-black underline underline-offset-4">처음부터 다시</button>
          </div>
        )}
        {draft?.warnings.length ? (
          <ul className="mt-3 list-inside list-disc space-y-1 rounded-[8px] border-2 border-[#111111] bg-[#f2cf27] p-3 text-xs font-semibold text-[#111111]">
            {draft.warnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        ) : null}
      </Section>

      {draft ? (
        <>
          <Section title="2. 고객 정보" note="비회원 접수로 만들어집니다. 고객은 결과 페이지 주소와 조회 코드로 진행 상황과 결과를 확인합니다.">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="고객 이름(담당자)" required><input className={inputClass} value={guest.name} onChange={(e) => setGuest({ ...guest, name: e.target.value })} maxLength={80} /></Field>
              <Field label="연락처"><input className={inputClass} value={guest.phone} onChange={(e) => setGuest({ ...guest, phone: e.target.value })} maxLength={40} /></Field>
              <Field label="이메일 (결과 안내 수신)"><input type="email" className={inputClass} value={guest.email} onChange={(e) => setGuest({ ...guest, email: e.target.value })} maxLength={200} /></Field>
              <Field label="회사·소속"><input className={inputClass} value={guest.company} onChange={(e) => setGuest({ ...guest, company: e.target.value })} maxLength={120} /></Field>
            </div>
            {!guest.email.trim() ? <p className="mt-2 text-xs font-bold text-[#d9362c]">이메일이 없으면 결과 안내 메일을 보낼 수 없습니다. 나중에 접수 상세에서 등록할 수도 있습니다.</p> : null}
          </Section>

          {kind === "ALBUM" ? (
            <>
              <Section title="3. 음반 정보">
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="앨범 제목" required><input className={inputClass} value={draft.album.title} onChange={(e) => updateAlbum({ title: e.target.value })} maxLength={200} /></Field>
                  <Field label="아티스트명" required><input className={inputClass} value={draft.album.artistName} onChange={(e) => updateAlbum({ artistName: e.target.value })} maxLength={200} /></Field>
                  <Field label="영문 아티스트명"><input className={inputClass} value={draft.album.artistNameEn} onChange={(e) => updateAlbum({ artistNameEn: e.target.value })} maxLength={200} /></Field>
                  <Field label="발매일"><input type="date" className={inputClass} value={draft.album.releaseDate} onChange={(e) => updateAlbum({ releaseDate: e.target.value })} /></Field>
                  <Field label="장르"><input className={inputClass} value={draft.album.genre} onChange={(e) => updateAlbum({ genre: e.target.value })} maxLength={100} /></Field>
                  <Field label="유통사"><input className={inputClass} value={draft.album.distributor} onChange={(e) => updateAlbum({ distributor: e.target.value })} maxLength={200} /></Field>
                  <Field label="기획사·제작사"><input className={inputClass} value={draft.album.productionCompany} onChange={(e) => updateAlbum({ productionCompany: e.target.value })} maxLength={200} /></Field>
                  <Field label="그룹/솔로">
                    <select className={inputClass} value={draft.album.artistType} onChange={(e) => updateAlbum({ artistType: e.target.value as IntakeDraft["album"]["artistType"] })}>
                      <option value="">선택 안 함</option>
                      <option value="SOLO">솔로</option>
                      <option value="GROUP">그룹</option>
                    </select>
                  </Field>
                  {draft.album.artistType === "GROUP" ? (
                    <Field label="구성원" wide><input className={inputClass} value={draft.album.artistMembers} onChange={(e) => updateAlbum({ artistMembers: e.target.value })} maxLength={1000} /></Field>
                  ) : null}
                  <Field label="이전 발매곡" wide><textarea className={`${inputClass} min-h-20`} value={draft.album.previousRelease} onChange={(e) => updateAlbum({ previousRelease: e.target.value })} maxLength={500} /></Field>
                </div>
              </Section>

              <Section title={`4. 트랙 (${draft.tracks.length}곡)`} note="곡 순서는 신청서(CD) 순서와 같아야 합니다. 타이틀곡을 표시해주세요.">
                <ol className="space-y-3">
                  {draft.tracks.map((track, index) => (
                    <li key={index} className="rounded-[10px] border-2 border-border bg-background p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-black text-foreground">{index + 1}번 트랙</span>
                        <div className="flex items-center gap-3">
                          <label className="flex items-center gap-1.5 text-xs font-black">
                            <input type="checkbox" checked={track.isTitle} onChange={(e) => updateTrack(index, { isTitle: e.target.checked })} />
                            타이틀곡
                          </label>
                          <button
                            type="button"
                            disabled={draft.tracks.length <= 1}
                            onClick={() => setDraft({ ...draft, tracks: draft.tracks.filter((_, i) => i !== index) })}
                            className="inline-flex items-center gap-1 text-xs font-black text-[#d9362c] disabled:opacity-40"
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />삭제
                          </button>
                        </div>
                      </div>
                      <div className="mt-2 grid gap-2 md:grid-cols-2">
                        <Field label="곡명" required><input className={inputClass} value={track.trackTitle} onChange={(e) => updateTrack(index, { trackTitle: e.target.value })} maxLength={300} /></Field>
                        <Field label="실연자(가창)"><input className={inputClass} value={track.performer} onChange={(e) => updateTrack(index, { performer: e.target.value })} maxLength={300} placeholder="비우면 아티스트명" /></Field>
                        <Field label="작사"><input className={inputClass} value={track.lyricist} onChange={(e) => updateTrack(index, { lyricist: e.target.value })} maxLength={300} /></Field>
                        <Field label="작곡"><input className={inputClass} value={track.composer} onChange={(e) => updateTrack(index, { composer: e.target.value })} maxLength={300} /></Field>
                        <Field label="편곡"><input className={inputClass} value={track.arranger} onChange={(e) => updateTrack(index, { arranger: e.target.value })} maxLength={300} /></Field>
                        <Field label="피처링"><input className={inputClass} value={track.featuring} onChange={(e) => updateTrack(index, { featuring: e.target.value })} maxLength={300} /></Field>
                        <Field label="가사" wide><textarea className={`${inputClass} min-h-32 font-normal`} value={track.lyrics} onChange={(e) => updateTrack(index, { lyrics: e.target.value })} maxLength={30000} /></Field>
                        {track.translatedLyrics ? (
                          <Field label="번역 가사" wide><textarea className={`${inputClass} min-h-24 font-normal`} value={track.translatedLyrics} onChange={(e) => updateTrack(index, { translatedLyrics: e.target.value })} maxLength={30000} /></Field>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ol>
                <button
                  type="button"
                  disabled={draft.tracks.length >= 100}
                  onClick={() => setDraft({ ...draft, tracks: [...draft.tracks, emptyTrack()] })}
                  className="mt-3 inline-flex items-center gap-1 rounded-[8px] border-2 border-border bg-background px-3 py-2 text-xs font-black"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />트랙 추가
                </button>
              </Section>
            </>
          ) : (
            <Section title="3. 뮤직비디오 정보">
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="곡명(뮤비 제목)" required><input className={inputClass} value={draft.mv.title} onChange={(e) => updateMv({ title: e.target.value })} maxLength={200} /></Field>
                <Field label="아티스트명" required><input className={inputClass} value={draft.mv.artistName} onChange={(e) => updateMv({ artistName: e.target.value })} maxLength={200} /></Field>
                <Field label="국문 곡명"><input className={inputClass} value={draft.mv.songTitleKr} onChange={(e) => updateMv({ songTitleKr: e.target.value })} maxLength={200} /></Field>
                <Field label="영문 곡명"><input className={inputClass} value={draft.mv.songTitleEn} onChange={(e) => updateMv({ songTitleEn: e.target.value })} maxLength={200} /></Field>
                <Field label="음반명"><input className={inputClass} value={draft.mv.albumTitle} onChange={(e) => updateMv({ albumTitle: e.target.value })} maxLength={200} /></Field>
                <Field label="장르"><input className={inputClass} value={draft.mv.genre} onChange={(e) => updateMv({ genre: e.target.value })} maxLength={100} /></Field>
                <Field label="영상 공개일"><input type="date" className={inputClass} value={draft.mv.releaseDate} onChange={(e) => updateMv({ releaseDate: e.target.value })} /></Field>
                <Field label="제작일"><input type="date" className={inputClass} value={draft.mv.productionDate} onChange={(e) => updateMv({ productionDate: e.target.value })} /></Field>
                <Field label="감독"><input className={inputClass} value={draft.mv.director} onChange={(e) => updateMv({ director: e.target.value })} maxLength={200} /></Field>
                <Field label="주연"><input className={inputClass} value={draft.mv.leadActor} onChange={(e) => updateMv({ leadActor: e.target.value })} maxLength={300} /></Field>
                <Field label="러닝타임"><input className={inputClass} value={draft.mv.runtime} onChange={(e) => updateMv({ runtime: e.target.value })} maxLength={40} /></Field>
                <Field label="뮤비 제작사"><input className={inputClass} value={draft.mv.productionCompany} onChange={(e) => updateMv({ productionCompany: e.target.value })} maxLength={200} /></Field>
                <Field label="유통사·배급"><input className={inputClass} value={draft.mv.distributionCompany} onChange={(e) => updateMv({ distributionCompany: e.target.value })} maxLength={200} /></Field>
                <Field label="대행사·소속사"><input className={inputClass} value={draft.mv.agency} onChange={(e) => updateMv({ agency: e.target.value })} maxLength={200} /></Field>
                <Field label="사업자등록번호"><input className={inputClass} value={draft.mv.businessRegNo} onChange={(e) => updateMv({ businessRegNo: e.target.value })} maxLength={40} /></Field>
                <Field label="용도"><input className={inputClass} value={draft.mv.usage} onChange={(e) => updateMv({ usage: e.target.value })} maxLength={300} /></Field>
                {kind === "MV_DISTRIBUTION" ? (
                  <Field label="희망 등급">
                    <select className={inputClass} value={draft.mv.desiredRating} onChange={(e) => updateMv({ desiredRating: e.target.value })}>
                      <option value="">선택 안 함</option>
                      {MV_DESIRED_RATING_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </Field>
                ) : null}
                <Field label="작사"><input className={inputClass} value={draft.mv.lyricist} onChange={(e) => updateMv({ lyricist: e.target.value })} maxLength={300} /></Field>
                <Field label="작곡"><input className={inputClass} value={draft.mv.composer} onChange={(e) => updateMv({ composer: e.target.value })} maxLength={300} /></Field>
                <Field label="편곡"><input className={inputClass} value={draft.mv.arranger} onChange={(e) => updateMv({ arranger: e.target.value })} maxLength={300} /></Field>
                <Field label="줄거리" wide><textarea className={`${inputClass} min-h-24 font-normal`} value={draft.mv.storyline} onChange={(e) => updateMv({ storyline: e.target.value })} maxLength={5000} /></Field>
                <Field label="가사" wide><textarea className={`${inputClass} min-h-32 font-normal`} value={draft.mv.lyrics} onChange={(e) => updateMv({ lyrics: e.target.value })} maxLength={30000} /></Field>
                <Field label="메모" wide><textarea className={`${inputClass} min-h-16 font-normal`} value={draft.mv.memo} onChange={(e) => updateMv({ memo: e.target.value })} maxLength={2000} /></Field>
              </div>
            </Section>
          )}

          <Section
            title={`${kind === "ALBUM" ? "5" : "4"}. ${kind === "ALBUM" ? "패키지" : "신청 방송사"}와 결제`}
            note="입금을 이미 확인했다면 결제 완료로 등록하세요. 미결제로 만들면 고객이 결과 페이지에서 결제할 수 있습니다."
          >
            {optionsError ? <p role="alert" className="mb-3 text-xs font-bold text-[#d9362c]">{optionsError}</p> : null}
            {kind === "ALBUM" ? (
              <div className="grid gap-2 md:grid-cols-2">
                {(options?.packages ?? []).map((item) => (
                  <label key={item.id} className={`flex cursor-pointer items-start gap-2 rounded-[10px] border-2 p-3 ${packageId === item.id ? "border-[#111111] bg-[#f2cf27] text-[#111111]" : "border-border bg-background"}`}>
                    <input type="radio" name="intake-package" checked={packageId === item.id} onChange={() => setPackageId(item.id)} className="mt-1" />
                    <span className="min-w-0">
                      <span className="block text-sm font-black">{item.name} · {won(item.priceKrw)}</span>
                      <span className="block text-[11px] font-semibold opacity-80">{item.stations.join(", ")}</span>
                    </span>
                  </label>
                ))}
                {!options && !optionsError ? <p className="text-xs font-semibold text-muted-foreground">패키지를 불러오는 중…</p> : null}
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {kind === "MV_DISTRIBUTION" ? (
                  <span className="rounded-[8px] border-2 border-[#111111] bg-[#f2cf27] px-3 py-2 text-xs font-black text-[#111111]">
                    영등위 온라인 심의 · {won(options?.mv.basePriceKrw ?? 0)} (기본)
                  </span>
                ) : null}
                {mvStations.map((station) => (
                  <label key={station.code} className={`flex cursor-pointer items-center gap-2 rounded-[8px] border-2 px-3 py-2 text-xs font-black ${stationCodes.includes(station.code) ? "border-[#111111] bg-[#1556a4] text-white" : "border-border bg-background"}`}>
                    <input
                      type="checkbox"
                      checked={stationCodes.includes(station.code)}
                      onChange={(e) => setStationCodes((current) => e.target.checked ? [...current, station.code] : current.filter((code) => code !== station.code))}
                    />
                    {station.code} · {won(station.priceKrw)}{kind === "MV_DISTRIBUTION" ? " (추가)" : ""}
                  </label>
                ))}
              </div>
            )}
            <p className="mt-3 text-sm font-black text-foreground">접수 금액: {amount ? won(amount) : "선택 필요"}</p>
            <div className="mt-3 grid gap-2 md:grid-cols-2" role="radiogroup" aria-label="결제 상태">
              {[
                { value: true, title: "입금 확인 완료 · 결제 완료로 등록", note: "심의 진행 대상이 됩니다. 고객 이메일이 있으면 접수 안내 메일이 자동 발송됩니다." },
                { value: false, title: "미결제로 등록", note: "고객이 결과 페이지에서 결제합니다. 안내 메일은 발송되지 않습니다." },
              ].map((option) => (
                <button
                  key={String(option.value)}
                  type="button"
                  role="radio"
                  aria-checked={paid === option.value}
                  onClick={() => setPaid(option.value)}
                  className={`rounded-[10px] border-2 p-3 text-left ${paid === option.value ? "border-[#111111] bg-[#1f7a5a] text-white" : "border-border bg-background text-foreground"}`}
                >
                  <span className="block text-sm font-black">{option.title}</span>
                  <span className="block text-[11px] font-semibold opacity-85">{option.note}</span>
                </button>
              ))}
            </div>
            <Field label="관리자 메모 (고객에게 보이지 않음)" wide>
              <textarea className={`${inputClass} mt-1 min-h-16 font-normal`} value={adminMemo} onChange={(e) => setAdminMemo(e.target.value)} maxLength={1500} placeholder="예: 카카오톡으로 신청서·음원 수신, 11/5 입금 확인" />
            </Field>
            <p className="mt-3 text-xs font-semibold leading-5 text-muted-foreground">
              음원·영상 파일은 이 화면에서 올리지 않습니다. 고객에게 받은 파일은 관리자 PC(심의 데스크)에 보관해 심의 자료로 사용해주세요.
            </p>
          </Section>

          {error ? <p role="alert" className="rounded-[8px] border-2 border-[#111111] bg-[#d9362c] px-3 py-2 text-sm font-bold text-white">{error}</p> : null}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={submit}
              disabled={busy !== null}
              className="inline-flex h-12 items-center rounded-[8px] border-2 border-[#111111] bg-[#f2cf27] px-6 text-base font-black text-[#111111] shadow-[3px_3px_0_#111111] disabled:opacity-50"
            >
              {busy === "submit" ? "접수 만드는 중…" : "비회원 접수 만들기"}
            </button>
            <span className="text-xs font-semibold text-muted-foreground">만든 접수는 접수 관리·대시보드·심의 데스크에서 다른 접수와 같이 관리합니다.</span>
          </div>
        </>
      ) : error ? (
        <p role="alert" className="rounded-[8px] border-2 border-[#111111] bg-[#d9362c] px-3 py-2 text-sm font-bold text-white">{error}</p>
      ) : null}
    </div>
  );
}
