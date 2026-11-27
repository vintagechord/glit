# 음원 가사 대조 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 데스크의 관리자 수동 작업 → 음반에서, 연결된 음원을 이 Mac에서 받아써 트랙 가사와 대조한다. 그 결과를 체크해서 반영할 수 있는 제안으로 보여준다.

**Architecture:**
- Python worker(`audio-check/worker.py`)는 모델 작업만 한다. 디코딩, 보컬 분리, 받아쓰기, 에너지, 강제 점수.
- Node(`audio-check.mjs`)는 판단을 전부 한다. 연결, 정렬, 제안, 반영. 순수 함수 위주다.
- `audio-engine.mjs`는 설치와 worker 프로세스를 맡는다.
- `server.mjs`는 전용 직렬 대기열과 API를 더한다. `public/app.js`는 검토사항 탭에 화면을 더한다.

**Tech Stack:** Node 24(내장 `node:test`), 순수 JS 화면, Python 3.12 venv(uv), mlx-whisper 0.4.3, demucs 4.1.0(htdemucs, CPU), torch/torchaudio 2.5.1, imageio-ffmpeg.

**Spec:** `docs/superpowers/specs/2026-11-26-desk-audio-lyrics-check-design.md` — 실행자는 계획과 함께 반드시 읽는다.

## Global Constraints

- 대상은 수동 작업(`item.source === 'manual'`) + `submission.type === 'ALBUM'`뿐이다. 그 밖의 요청은 400 `음원 가사 대조는 관리자 수동 작업의 음반에서만 사용할 수 있습니다.`
- 음원을 이 Mac 밖으로 보내지 않는다. 네트워크는 설치(PyPI·모델 다운로드)에서만 쓴다.
- 설치 고정 버전: `mlx-whisper==0.4.3`, `demucs==4.1.0`, `torch==2.5.1`, `torchaudio==2.5.1`, `numpy==2.5.5`, `soundfile==0.14.0`. `imageio-ffmpeg`는 Task 5에서 uv가 고른 버전으로 고정한다.
- 설치 위치: `<dataRoot>/음원분석/venv`, 설치 정보 `<dataRoot>/음원분석/engine.json`. 모델은 라이브러리 기본 캐시를 쓴다.
- Whisper 설정: `mlx-community/whisper-large-v3-turbo`, `language='ko'`(영문 40% 초과 트랙은 `None`), `condition_on_previous_text=False`, `word_timestamps=True`, `hallucination_silence_threshold=2`, `temperature=(0.0,0.2,0.4)`, `no_speech_threshold=0.5`, `compression_ratio_threshold=2.2`.
- demucs는 `htdemucs`, two-stems vocals, **device cpu**. MPS는 쓰지 않는다.
- 강제 점수는 `tmp/audio-check-validation/prototype/score.py`와 같은 정의를 쓴다. 후보 토큰과 EOT의 log P 합이고, 창은 30초 패딩이다. 빈 후보는 점수에 쓰지 않는다.
- 판정 임계값(초기값, `THRESHOLDS` 한 곳):

  | 항목 | 값 |
  |---|---|
  | 강함 | Δ ≥ 8 |
  | 보통 | Δ ≥ 2 |
  | 반복 판정 유사도 | ≥ 0.75 |
  | 차이 최소 길이(삽입·삭제) | 6자 |
  | 차이 구간 병합 | 일치 2자 이하 |
  | 보컬 프레임 | −15dB |
  | 알아듣지 못한 구간 | ≥ 2.5초 |
  | 끄는 음 제외 | 직전 구간 끝 + 1.5초 |
  | 환각 에너지 | 중앙값 < −35dB |
  | 반복 낱말 | > 6회 |
  | MR 보컬 경고 | 프레임 > 15% |
  | MR 뺄셈 실패 | 잔여 10퍼센타일 > −12dB |
  | MR 짝 길이 차 | ≤ 0.5초 |
  | 영문 비중 | > 40% |

- 화면 문구는 한국어다. 색은 기존 팔레트와 클래스(`badge`, `notice`, `finding-card`)만 쓴다. 파스텔은 쓰지 않는다.
- 상용 곡 가사를 저장소에 넣지 않는다. 테스트 가사는 지어낸 문장으로 쓴다.
- 커밋 메시지 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`를 붙인다. 저장소 루트의 `심의자료_…/`, `tmp/`는 커밋하지 않는다(`git add`는 경로를 지정해서 한다).

## Review Focus

1. **못 읽는 음원**(0바이트, 손상, 확장자만 오디오): 그 트랙만 `status:'failed'`와 사유를 남기고, 나머지 트랙은 계속 분석한다. → Task 6 테스트
2. **분석 중이나 분석 뒤에 가사를 고친 경우**: 반영은 409로 막는다. 화면은 해당 트랙을 "다시 대조 필요"로 표시한다. → Task 3, Task 7 테스트
3. **가사가 빈 일반 트랙에 보컬이 있는 경우**: 받아쓴 전체를 `new`/`check` 제안 하나로 낸다. 오류로 처리하지 않는다. → Task 2 테스트
4. **음원이 하나도 연결되지 않은 작업**: 대조 시작은 400 `연결된 음원이 없습니다.`를 돌려주고, 화면은 버튼을 막고 안내한다. → Task 7, Task 8
5. **worker가 죽거나 앱이 재시작된 경우**: 작업은 실패로 끝나고 메시지를 남긴다. 재시작 시 남은 `audio-*` 작업은 실패 처리한다(`앱이 다시 시작되어 중단되었습니다.`). 일부 결과는 반영하지 않는다. → Task 7 테스트

---

### Task 1: 텍스트 정규화·정렬·음원 연결 (`audio-check.mjs`)

**Files:**
- Create: `tools/onside-desk/audio-check.mjs`
- Test: `tools/onside-desk/tests/audio-check.test.mjs`

**Interfaces:**
- Produces:
  - `THRESHOLDS`(위 표의 키: `strongDelta, mediumDelta, repeatSimilarity, minGapChars, mergeGap, vocalDb, unclearSec, holdSec, hallucinationDb, repeatWords, mrVocalRatio, mrResidualDb, mrDurationSec, foreignRatio`)
  - `AUDIO_EXTENSIONS`(Set: wav mp3 m4a aac flac aif aiff ogg)
  - `lyricsHash(lyrics: string): string` — sha256 hex
  - `normalizeText(text): { norm: string, map: number[] }` — 한글·영문·숫자만 남기고 소문자로 바꾼다. `map[i]`는 원문 위치다.
  - `lyricLines(lyrics): Array<{ index, text, norm, translation: boolean }>` — `index`는 `lyrics.split('\n')` 번호다. `translation`은 `/^\s*\(\s*번역\s*[:：]/`이다.
  - `foreignRatio(lyrics): number`
  - `similarity(a: string, b: string): number` — 2·LCS/(|a|+|b|)
  - `alignChars(a: string, b: string): Array<[i|null, j|null]>` — Gotoh 전역 정렬. 점수: 일치 +2, 자모(초성+중성) 일치 +1, 불일치 −1, 갭 시작 −3, 연장 −0.5.
  - `autoMapping(tracks, attachments): { mapping: {[trackId]: attachmentId|null}, duplicates: Array<{trackId, attachmentId}>, mrPairs: {[mrTrackId]: vocalTrackId}, unmapped: attachmentId[] }`
  - `validateMapping(mapping, tracks, attachments)` — 다음 경우 Error를 던진다.
    - 모르는 trackId, attachmentId
    - 오디오가 아닌 첨부
    - 한 첨부를 두 트랙에 연결

- [ ] **Step 1: 실패하는 테스트 작성**
  - `normalizeText keeps hangul/latin/digits and maps back to source offsets` — `normalizeText('바람 따라, Go 2!')`의 결과:
    - `norm === '바람따라go2'`
    - `map[4] === 6`
  - `lyricLines flags desk translation lines` — `'Hello\n(번역: 안녕)\n'`의 결과:
    - `[1].translation === true`
    - `[0].translation === false`
    - `[2].text === ''`
  - `alignChars aligns a repeated block as one gap`
    - a = `'가나다라마바사'.repeat(2)`
    - b = `'가나다라마바사'.repeat(3)`
    - 정렬 결과에서 `i===null`인 칸이 연속 7개 한 덩어리여야 한다.
  - `similarity` — `similarity('사랑찾는밤나비','외로운사랑찾는밤나비') ≈ 0.82`(±0.01), `similarity('abc','xyz') === 0`
  - `autoMapping prefers leading numbers, then titles, then lossless duplicates, and pairs MR`
    - 트랙: `[{id:'t1',track_no:1,track_title:'첫 노래'},{id:'t7',track_no:7,track_title:'일곱'},{id:'t10',track_no:10,track_title:'첫 노래 (MR)',is_instrumental:true}]`
    - 첨부: `01_첫 노래.wav`, `07 일곱.mp3`, `07 일곱.wav`, `첫 노래 (MR).wav`, `notes.pdf`
    - 기대값:
      - `mapping.t7`는 wav
      - `duplicates`에 mp3가 들어간다
      - `mapping.t10`은 MR 파일(제목 일치)
      - `mrPairs.t10 === 't1'`
      - pdf는 `unmapped`에 없다(오디오가 아니므로 제외)
  - `validateMapping rejects one attachment on two tracks` — `assert.throws(..., /같은 음원/)`

- [ ] **Step 2: 실행해서 실패 확인**
  - `node --test tools/onside-desk/tests/audio-check.test.mjs` → FAIL(module not found)

- [ ] **Step 3: 위 Interfaces 그대로 구현**
  - 파일명 번호는 `^0?(\d{1,2})[ ._\-)]`로 읽는다.
  - 제목 비교는 `normalizeText` 포함 관계로 한다.
  - MR 표시는 `/\((?:MR|Inst\.?|Instrumental)\)\s*$/i`다.
  - MR 짝의 길이 차 검사는 길이를 아는 Task 6에서 한다. 여기서는 제목으로만 짝짓는다.

- [ ] **Step 4: 통과 확인**
  - 같은 명령 → PASS

- [ ] **Step 5: 커밋**
  - `git add tools/onside-desk/audio-check.mjs tools/onside-desk/tests/audio-check.test.mjs && git commit -m "Add audio lyrics check text alignment and file mapping"`

### Task 2: 받아쓰기 정리와 제안 초안·확정 (`audio-check.mjs`)

**Files:**
- Modify: `tools/onside-desk/audio-check.mjs`
- Test: `tools/onside-desk/tests/audio-check.test.mjs`

**Interfaces:**
- Consumes: Task 1의 모든 함수.
- Produces:
  - `cleanTranscript(segments, energy, hop = 0.25): segments` — 다음을 버린다.
    - 환각 정규식 `/(감사합니다|시청해 ?주셔서|다음 영상|한글자막|자막 ?by|구독|아멘)/`
    - 0.3초 미만 구간
    - 에너지 중앙값이 `hallucinationDb` 미만인 구간
    - 같은 낱말이 `repeatWords`번 넘게 연속되는 구간
    - `segments`는 `{s,e,t,words:[{s,e,w}]}`이고 `energy`는 0.25초 단위 dB(곡 90퍼센타일 기준)다.
  - `draftSuggestions({ trackId, lyrics, segments, energy, duration, instrumental }): { suggestions: Suggestion[], scoreRequests: ScoreRequest[] }`
  - `finalizeSuggestions(draft, scores: {[requestId]: number[]}): Suggestion[]`
  - `Suggestion` 형태:
    ```js
    { id, trackId, kind, confidence, start, end, op, hint, score, lines }
    ```
    - `kind`: `'repeat'|'new'|'replace'|'unheard'|'unclear'|'instrumental'|'no-vocal'`
    - `confidence`: `'high'|'medium'|'check'`
    - `lines`: 묶인 줄 번호 목록
    - `op` 형태는 스펙과 같다. `replaceLine`은 `{type:'replaceLine', lines:number[], from, to}`처럼 여러 줄을 받는다.
  - `ScoreRequest`: `{ id, suggestionId, start, end, candidates: [lyricText, proposedText] }`

- [ ] **Step 1: 실패하는 테스트 작성** (가사는 지어낸 문장, 받아쓰기는 낱말 시각을 직접 만든다)
  - `cleanTranscript drops hallucinations, quiet and looping segments` — 세 종류를 섞어 넣으면 정상 구간만 남는다.
  - `missing repeated chorus becomes a high-confidence repeat insert`
    - 가사: `'하늘 높이 날아라\n\n바다 멀리 가거라\n함께 노래하자'`
    - 받아쓰기: 끝에 `'바다 멀리 가거라 함께 노래하자'`가 한 번 더 있다.
    - 기대값:
      - `kind==='repeat'`, `confidence==='high'`
      - `op.type==='insertLines'`, `op.afterLine===3`
      - `op.lines`는 `['', '바다 멀리 가거라', '함께 노래하자']`(빈 줄 포함, 가사 표기 그대로)
  - `partial-line echo becomes a medium repeat using lyric spelling`
    - 받아쓰기 끝에 `'멀리 가거라'`만 있다.
    - 기대값: `op.lines` 마지막이 `'멀리 가거라'`, `confidence==='medium'`
  - `unknown sung text becomes a new check suggestion with transcript text`
    - 기대값: `kind==='new'`, `confidence==='check'`, `op.type==='insertLines'`
  - `line sung as another lyric line asks for a score and maps to that line's spelling`
    - 2절 첫 줄이 1절 첫 줄로 불린 경우다.
    - 기대값:
      - `scoreRequests[0].candidates`가 `[원래 줄, 1절 줄]`
      - `finalizeSuggestions`에 `{[id]:[-100,-4]}`를 넣으면 `confidence==='high'`
  - `word difference across a repeated line is grouped and averaged`
    - 같은 줄이 두 번 나오고, 둘 다 `'내 사랑'→'나의 사랑'`이다.
    - 점수 Δ 1.5와 3.7을 넣으면 제안 1개, `lines.length===2`, `confidence==='medium'`이어야 한다.
    - Δ 1.0과 1.2이면 제안이 0개여야 한다.
  - `lyric-only line with vocal energy is treated as a transcription miss`
    - 에너지가 −5dB이면 제안 0개다.
    - 같은 경우 에너지가 −40dB이면 `kind==='unheard'`, `confidence==='check'`, `op.type==='deleteLines'`이다.
  - `uncovered loud vocals become unclear, but held notes right after a segment do not`
    - 구간 끝 + 0.5초에 시작하는 3초 고에너지 구간은 무시한다.
    - 다른 곳의 3초 고에너지 구간은 `kind==='unclear'`다.
  - `translation lines are ignored for matching and copied with a repeated block`
    - 가사에 `(번역: …)` 줄이 딸린 후렴이 빠진 경우, `op.lines`에 번역 줄도 포함된다.
  - `empty lyrics with vocals yield one whole-transcript new suggestion`
  - `instrumental track flags vocals above 15% of frames` → `kind==='instrumental'`
  - `lyrics track with no vocal frames is flagged` → `kind==='no-vocal'`
  - `spacing-only difference yields nothing` — `'바람따라'`와 `'바람 따라'`

- [ ] **Step 2: 실패 확인**
  - `node --test tools/onside-desk/tests/audio-check.test.mjs` → 새 테스트 FAIL

- [ ] **Step 3: 구현**
  - 순서:
    1. 번역 줄을 뺀 가사 정규 문자열(글자→줄)을 만든다.
    2. 받아쓰기 정규 문자열(글자→시각, 낱말 시각을 글자 수로 나눔)을 만든다.
    3. `alignChars`로 정렬한다.
    4. 차이 구간을 모은다(일치 `mergeGap`자 이하는 합침).
    5. 스펙의 분류 1–4를 적용한다.
  - 삽입 위치가 줄 시작·끝 3자 이내면 줄 경계로 붙인다.
  - 반복 판정은 연속 줄 블록에 대한 `similarity ≥ repeatSimilarity`로 한다.
    - 줄 전체(≥90%)와 맞으면 `high`로 하고 줄 원문을 쓴다.
    - 일부만 맞으면 `medium`으로 하고, 맞은 원문 부분 문자열을 쓴다.
  - 바꿈 후보 창은 `[줄 시작−0.5, 끝+0.5]`이고 30초 이하로 자른다.
  - 묶기 키는 `(정규화한 원래 줄, 정규화한 제안 줄)`이다. 묶인 제안의 Δ는 평균이다.
  - 제안 `id`는 `${trackId}:${kind}:${lines.join(',')}:${해시 8자}`로 만들어 결정적이게 한다.

- [ ] **Step 4: 통과 확인** → PASS

- [ ] **Step 5: 커밋**
  - `git add tools/onside-desk/audio-check.mjs tools/onside-desk/tests/audio-check.test.mjs && git commit -m "Draft and score audio lyrics check suggestions"`

### Task 3: 제안 반영 (`audio-check.mjs`)

**Files:**
- Modify: `tools/onside-desk/audio-check.mjs`
- Test: `tools/onside-desk/tests/audio-check.test.mjs`

**Interfaces:**
- Produces: `applySuggestions(lyrics: string, suggestions: Suggestion[], items: Array<{suggestionId, text?}>): string`
  - 줄 번호가 큰 것부터 적용한다.
  - `new` 제안의 `text`가 있으면 `op.lines`를 그 글자(줄바꿈으로 나눔)로 바꾼다.
  - `op`가 null인 제안이나 모르는 id면 Error를 던진다.

- [ ] **Step 1: 실패하는 테스트 작성**
  - `applySuggestions inserts, replaces grouped lines and deletes from the bottom up` — 한 가사에 세 종류를 섞어도 줄 번호가 어긋나지 않아야 한다(기대 문자열 전체를 비교).
  - `applySuggestions uses edited text for new lines`
  - `applySuggestions rejects suggestions without an operation` → throws `/반영할 수 없는 제안/`

- [ ] **Step 2: 실패 확인** → FAIL

- [ ] **Step 3: 구현** — `lyrics.split('\n')`에 적용한 뒤 `join('\n')`한다.

- [ ] **Step 4: 통과 확인** → PASS

- [ ] **Step 5: 커밋**
  - `git commit -m "Apply selected audio lyrics check suggestions"`(위와 같은 파일)

### Task 4: Python worker (`audio-check/worker.py`)

**Files:**
- Create: `tools/onside-desk/audio-check/worker.py`
- Test: `tools/onside-desk/audio-check/test_worker.py`(unittest, 엔진 venv Python으로 실행. venv가 없으면 skip)

**Interfaces (JSON-lines, stdin 명령 → stdout):**
- 명령: `{"id":n,"cmd":...}`
- 진행: `{"event":"progress","id":n,"stage":"decode|separate|transcribe|score|warmup"}`
- 결과: `{"id":n,"ok":true,"result":{...}}` 또는 `{"id":n,"ok":false,"error":"…"}`
- stderr는 로그용이고, Node는 마지막 2KB만 오류 메시지에 쓴다.
- 명령 목록:

  | 명령 | 동작 | 결과 |
  |---|---|---|
  | `warmup` | Whisper와 htdemucs를 내려받고 올린다 | `{"whisper":true,"demucs":true}` |
  | `analyze {file, mr?, outDir, transcribe:true, language:"ko"\|null}` | 분리·에너지·받아쓰기 | `{"duration","separation":"mr"\|"demucs","residualDb","vocals":"<outDir>/vocals.wav","energy":[...],"segments":[{s,e,t,words:[{s,e,w}]}]}` |
  | `score {vocals, start, end, candidates:[...]}` | 강제 점수 | `{"scores":[...]}` |

  `transcribe:false`면 `segments`는 `[]`다.

- [ ] **Step 1: 실패하는 테스트 작성** — numpy 합성 신호로 만든다.
  - `test_mr_subtraction_recovers_vocal_and_reports_residual`: 반주+보컬과 반주만 있는 신호를 300샘플 어긋나게 만든다. 기대값:
    - 복원 보컬 상관 > 0.95
    - `residualDb < -30`
  - `test_mr_subtraction_reports_failure_for_different_master`: MR에 다른 EQ를 적용하면 `residualDb > -12`
  - `test_energy_is_relative_to_90th_percentile`: 0.25초 프레임 수와 최댓값(≥ 0)
  - `test_protocol_rejects_unknown_command`: `handle({"id":1,"cmd":"x"})` → `ok:false`

- [ ] **Step 2: 실패 확인**
  - `"$HOME/Library/Application Support/Onside Review Desk/음원분석/venv/bin/python" -m unittest tools/onside-desk/audio-check/test_worker.py` → FAIL
  - venv가 아직 없으면 Task 5 Step 4 이후에 실행한다.

- [ ] **Step 3: 구현**
  - `decode(path, sr, channels) -> np.ndarray`: `imageio_ffmpeg.get_ffmpeg_exe()`로 f32le를 읽는다.
  - `mr_subtract(full, mr) -> (vocals, residual_db)`: 상호상관 시차와 이득은 prototype `null-mr.py`와 같다. `residual_db`는 초 단위 잔여/원곡 레벨의 10퍼센타일이다.
  - `separate_demucs(wav44k_stereo) -> vocals`: `demucs.pretrained.get_model('htdemucs')`와 `demucs.apply.apply_model(..., device='cpu', split=True, overlap=0.25)`를 쓰고, 정규화는 `demucs/separate.py`와 같게 한다.
  - `energy(vocals16k, hop=0.25)`
  - `transcribe(vocals16k, language)`: Global Constraints 설정을 쓴다.
  - `score(...)`: `score.py`를 그대로 옮긴다.
  - `analyze`는 `mr`이 주어지고 `residual_db <= -12`면 `separation:'mr'`, 아니면 demucs다.
  - `vocals.wav`는 16kHz mono PCM16으로 `outDir`에 쓴다.
  - 모델은 프로세스당 한 번만 올린다.

- [ ] **Step 4: 통과 확인** → OK

- [ ] **Step 5: 커밋**
  - `git add tools/onside-desk/audio-check/ && git commit -m "Add local audio analysis worker"`

### Task 5: 분석 도구 설치와 worker 클라이언트 (`audio-engine.mjs`)

**Files:**
- Create: `tools/onside-desk/audio-engine.mjs`
- Test: `tools/onside-desk/tests/audio-engine.test.mjs`, `tools/onside-desk/tests/fixtures/fake-audio-worker.mjs`

**Interfaces:**
- Produces:
  - `ENGINE_VERSION = 'audio-check-1'`, `ENGINE_PACKAGES`(Global Constraints 고정 목록)
  - `findUv({ env, exists }): string|null` — 찾는 순서: PATH의 `uv`, `/opt/homebrew/bin/uv`, `/usr/local/bin/uv`, `~/.local/bin/uv`, `~/.cargo/bin/uv`
  - `engineStatus({ dataRoot, env, exists }): Promise<{ installed, version, uv: string|null, installedAt?, needsUpdate }>` — `needsUpdate`는 engine.json 버전 ≠ `ENGINE_VERSION`이다.
  - `installEngine({ dataRoot, uv, run, onProgress, signal }): Promise<engineJson>` — `run(cmd, args, {signal, env})`은 테스트에서 주입한다. 순서:
    1. `uv venv --python 3.12 <venv>`
    2. `uv pip install --python <venv>/bin/python ...ENGINE_PACKAGES`
    3. worker `warmup`
    4. `engine.json` 원자적 저장
  - `startWorker({ command: string[], onProgress, signal }): { request(cmd, payload): Promise<result>, close(): Promise<void> }` — 기본 command는 `[<venv>/bin/python, <appDir>/audio-check/worker.py]`다.
    - 프로세스가 끝나거나 `signal`이 abort되면 대기 중인 요청을 모두 reject한다.
    - 오류 메시지는 `분석 도구가 중단되었습니다.`에 stderr 꼬리를 붙인다.

- [ ] **Step 1: 실패하는 테스트 작성**
  - `findUv checks PATH then known locations` — `exists`를 주입한다.
  - `engineStatus reports missing uv and stale engine versions`
  - `installEngine runs venv, pinned install, warmup in order and writes engine.json`
    - 주입한 `run`이 받은 인자로 검사한다. 두 번째 호출 args에 `mlx-whisper==0.4.3`, `demucs==4.1.0`이 들어 있어야 한다.
  - `installEngine does not write engine.json when a step fails`
  - `startWorker correlates responses, streams progress and rejects pending requests when the process dies`
    - fake worker(Node 스크립트)는 `analyze`에 진행 2회 후 결과를 주고, `crash` 명령에는 exit 1로 끝난다.
  - `startWorker kills the process on abort`

- [ ] **Step 2: 실패 확인**
  - `node --test tools/onside-desk/tests/audio-engine.test.mjs` → FAIL

- [ ] **Step 3: 구현** — `spawn`을 쓰고 stdout은 `readline`으로 읽는다. 요청 id는 증가하는 정수다.

- [ ] **Step 4: 통과 확인** → PASS. 이어서 **실제 설치를 한 번** 한다.
  - `node -e "import('./tools/onside-desk/audio-engine.mjs').then(m=>m.installEngine({dataRoot:process.env.HOME+'/Library/Application Support/Onside Review Desk',uv:m.findUv({}),onProgress:console.log}))"`
  - uv가 고른 `imageio-ffmpeg` 버전을 `ENGINE_PACKAGES`에 고정한다. 그다음 Task 4 Step 2와 4의 Python 테스트를 실행해 OK를 확인한다.

- [ ] **Step 5: 커밋**
  - `git add tools/onside-desk/audio-engine.mjs tools/onside-desk/tests/audio-engine.test.mjs tools/onside-desk/tests/fixtures/fake-audio-worker.mjs && git commit -m "Install the audio analysis engine on demand and drive its worker"`

### Task 6: 대조 실행 (`audio-check.mjs` `runAudioCheck`)

**Files:**
- Modify: `tools/onside-desk/audio-check.mjs`
- Test: `tools/onside-desk/tests/audio-check.test.mjs`

**Interfaces:**
- Consumes: Task 1–2 함수, Task 5 `startWorker`의 `request`.
- Produces: `runAudioCheck({ caseDir, tracks, attachments, mapping, worker, onProgress, signal, runId, now }): Promise<Run>`
  - `Run` 형태:
    ```js
    { id, status: 'completed'|'failed', createdAt, finishedAt, engineVersion,
      tracks: [{ trackId, attachmentId, lyricsHash, separation, duration, foreign: boolean, status: 'ok'|'failed'|'skipped', error?, suggestions, applied: [] }] }
    ```
  - 캐시:
    - 위치는 `<caseDir>/음원 대조 캐시/<sha256(첨부sha256+ENGINE_VERSION+MR첨부sha256+language) 앞 16자>/analysis.json`이다.
    - 캐시가 있으면 worker `analyze`를 부르지 않는다.
  - 전문은 `<caseDir>/음원 대조/<runId>/result.json`에 둔다(받아쓰기·에너지 포함).
  - 진행 메시지 형식은 `${n}/${total} ${단계} · ${트랙번호 2자리} ${곡명}`이다. 단계는 `보컬 분리 중`, `받아쓰는 중`, `점수 비교 중`.
  - 순서: 보컬 트랙을 먼저 하고 MR 트랙은 나중에 한다.
    - MR 짝은 `analyze({file: 원곡, mr: MR})`로 한 번만 분석하고, MR 트랙은 그 결과의 보컬 잔여로 판단한다.
    - 길이 차 > `mrDurationSec`면 짝을 풀고 각각 demucs로 분석한다.

- [ ] **Step 1: 실패하는 테스트 작성** — 가짜 `worker.request`를 쓴다.
  - `runAudioCheck analyzes each mapped track once, reuses cache on rerun, and scores drafts`
    - 두 번째 실행에서 `analyze` 호출 0회, `score`는 다시 호출된다.
  - `runAudioCheck marks a failing track and continues with the rest` (Review Focus 1)
  - `runAudioCheck rejects when nothing is mapped` → `/연결된 음원이 없습니다/` (Review Focus 4)
  - `runAudioCheck pairs MR with its vocal track and checks the MR from the same analysis`
  - `runAudioCheck stops on abort without writing result.json` (Review Focus 5)
  - `runAudioCheck uses language null for tracks over 40% latin and marks them foreign`

- [ ] **Step 2: 실패 확인** → FAIL

- [ ] **Step 3: 구현**

- [ ] **Step 4: 통과 확인** → PASS

- [ ] **Step 5: 커밋**
  - `git commit -m "Run the audio lyrics check with caching and progress"`

### Task 7: 서버 연결 (`server.mjs`)

**Files:**
- Modify: `tools/onside-desk/server.mjs`
  - `createDesk` 인자, `detail()`, `backup()`, 라우트, `close()`, 시작 시 정리
- Test: `tools/onside-desk/tests/audio-server.test.mjs`(설정은 `manual-server.test.mjs`의 `setup` 방식을 그대로 복사)

**Interfaces:**
- Consumes: Task 3 `applySuggestions`, Task 5 `engineStatus/installEngine/startWorker`, Task 6 `runAudioCheck`, Task 1 `autoMapping/validateMapping/lyricsHash`.
- Produces:
  - `createDesk({ ..., audio })` — `audio = { engineStatus, installEngine, startWorker, runAudioCheck }`. 기본값은 실제 모듈이고 테스트에서 주입한다.
  - 라우트(스펙의 API 표와 같다):

    | 라우트 | 응답 |
    |---|---|
    | `GET /api/audio-engine` | `engineStatus` 결과 |
    | `POST /api/audio-engine/install` | 202 `{job}` |
    | `PATCH /api/cases/:id/audio-check/mapping` | `{audioCheck}` |
    | `POST /api/cases/:id/audio-check` | 202 `{job}` |
    | `POST /api/cases/:id/audio-check/cancel` | `{cancelled:boolean}` |
    | `POST /api/cases/:id/audio-check/apply` | `{detail, applied:number}` |
    | `GET /api/cases/:id/attachments/:attachmentId/stream` | Range를 지원한다. 206과 `Content-Range`, 오디오 MIME |

  - `detail()`(수동 음반만)에 다음을 더한다.
    - `audioCheck: { mapping, auto, latest: Run|null, staleTracks: trackId[] }`
    - `auto`는 `autoMapping` 결과(저장된 mapping이 없는 트랙에 쓴다)다.
    - `staleTracks`는 현재 가사 `lyricsHash`가 run의 값과 다른 트랙이다.
  - 상태: `item.audioCheck = { mapping, runs: Run[] }`, 최근 3개를 유지한다.
  - 작업:
    - 종류는 `kind: 'audio-install'`(caseId null)과 `'audio-check'`다.
    - 별도 `audioQueue`를 쓰고, 기존 `enqueue`/`queue`는 건드리지 않는다.
    - 같은 대상에 대기·진행 중인 작업이 있으면 그 작업을 돌려준다.
    - 취소용 `AbortController`는 메모리 `Map(jobId → controller)`에 둔다.
    - 메시지:
      - 완료: `음원 대조 완료 · 제안 ${n}개`
      - 취소: `음원 대조를 중지했습니다.`
      - 설치 완료: `분석 도구를 설치했습니다.`
  - 반영:
    1. `runId`가 최신 run이 아니면 409 `더 최신 대조 결과가 있습니다. 화면을 새로고침하세요.`
    2. 트랙 가사 해시 ≠ run의 `lyricsHash`면 409 `가사가 바뀌었습니다. 다시 대조하세요.`
    3. 그다음 처리는 `PATCH local`의 수동 작업 분기와 같다.
       - `validateLocalPatch({overrides:{tracks:[{id,lyrics}]}, reviewAcknowledgedRevision:''})`
       - `sourceChanged`, `updated_at`
       - 감사 `음원 대조 제안 ${n}개를 가사에 반영했습니다.`
       - 온라인 등록이면 `syncOnline`
    4. 반영한 제안 id를 run의 `tracks[].applied`에 기록한다.
  - `backup()` walk의 제외 목록에 `'음원 대조 캐시'`를 더한다.
  - 시작 시: `audio-` 종류이면서 `queued`·`running`인 작업은 `failed`와 `앱이 다시 시작되어 중단되었습니다.`로 바꾼다.
  - `close()`: 진행 중인 audio 작업을 abort하고 `audioQueue`를 기다린다.

- [ ] **Step 1: 실패하는 테스트 작성**
  - `audio endpoints are limited to manual albums` → 온라인 사례와 수동 MV 모두 400
  - `mapping patch validates and persists, detail exposes auto mapping and latest run`
  - `audio-check runs on its own queue so generation is not blocked`
    - 가짜 `runAudioCheck`가 promise를 붙잡고 있는 동안 `POST generate` 작업이 `completed`가 되어야 한다.
  - `cancel aborts the running audio job and records the cancel message`
  - `apply writes lyrics through overrides, records applied ids, and returns 409 after a lyric edit` (Review Focus 2)
  - `stream serves byte ranges for audio attachments only` → `Range: bytes=0-3`에 206과 4바이트를 돌려준다. pdf 첨부는 400.
  - `leftover audio jobs fail on restart` (Review Focus 5) — `Store`에 running 작업을 넣고 `createDesk`
  - `backup excludes the audio cache folder`

- [ ] **Step 2: 실패 확인**
  - `node --test tools/onside-desk/tests/audio-server.test.mjs` → FAIL

- [ ] **Step 3: 구현**

- [ ] **Step 4: 통과 확인**
  - `node --import tsx --test tools/onside-desk/source.test.mjs tools/onside-desk/tests/*.test.mjs` → 전체 PASS(기존 테스트 포함)

- [ ] **Step 5: 커밋**
  - `git add tools/onside-desk/server.mjs tools/onside-desk/tests/audio-server.test.mjs && git commit -m "Serve the audio lyrics check from the desk on its own queue"`

### Task 8: 검토사항 탭 화면 (`public/app.js`, `public/index.html`, `public/styles.css`)

**Files:**
- Modify: `tools/onside-desk/public/app.js`
  - `manualReviewMarkup` 뒤에 `audioCheckMarkup(d)`를 더한다.
  - `action()` 분기를 더한다.
  - change 핸들러를 더한다.
- Modify: `tools/onside-desk/public/index.html` — 재렌더링에 지워지지 않도록 detail 패널 밖에 `<audio id="audio-player" preload="none" hidden></audio>`를 둔다.
- Modify: `tools/onside-desk/public/styles.css` — 제안 줄(`.audio-suggestion`), diff 표시(`del`/`ins`)
- Test: `tools/onside-desk/tests/ui-manual-smoke.mjs`에 시나리오를 더한다(기존 smoke 실행 방식을 따름).

**Interfaces:**
- Consumes:
  - Task 7 라우트
  - `detail.audioCheck`
  - 기존 `api`, `apiPath`, `toast`, `loadDetail`, `detailRender`, `jobs()`, `activeJob`, `ui.dirty`
- Produces:
  - UI 상태: `ui.audioEngine`, `ui.audioPicks` `{[suggestionId]: boolean}`, `ui.audioTexts` `{[suggestionId]: string}`
  - 액션: `audio-install`, `audio-start`, `audio-cancel`, `audio-apply`, `audio-play`(`data-attachment`, `data-start`, `data-end`)
  - 연결 변경: `select[data-audio-map]`이 바뀌면 PATCH

- [ ] **Step 1: smoke 시나리오 작성** — 가짜 audio를 주입한 데스크로 다음을 확인한다.
  1. 미설치 상태에서는 설치 버튼만 보인다.
  2. 결과가 있으면 강함 제안은 체크, 보통은 해제 상태다.
  3. 반영 버튼 숫자가 체크 수와 같다.
  4. 반영 후 "반영됨"이 표시되고, 문서 정보 수정의 가사가 바뀐다.
  5. 수정 중(`ui.dirty`)에는 반영 버튼이 disabled다.

- [ ] **Step 2: 실패 확인** — 기존 smoke 실행 명령(파일 상단 주석)으로 FAIL을 확인한다.

- [ ] **Step 3: 구현** — 스펙의 화면 스케치를 따른다.
  - 진행 중이면 기존 `job-inline` 메시지와 [중지]를 보여준다.
  - 트랙별로 묶고 "차이 없음" 트랙은 한 줄로 보인다.
  - `staleTracks`에 든 트랙은 노랑 `notice`와 [다시 대조]를 보여준다.
  - ▶는 `audio.src = apiPath('/attachments/'+id+'/stream')`다. 쿠키 인증이라 GET이 통과한다.
  - 재생 위치는 `currentTime = max(0, start-1)`이고, `end+1`에서 멈춘다.
  - 반영 시 `ui.audioTexts`를 `items[].text`로 보낸다.

- [ ] **Step 4: 통과 확인** — smoke PASS. 이어서 실제 데스크(개발 서버)를 띄워 Task 9 데이터로 눈으로 확인한다.

- [ ] **Step 5: 커밋**
  - `git add tools/onside-desk/public tools/onside-desk/tests/ui-manual-smoke.mjs && git commit -m "Show audio lyrics check suggestions on the manual review tab"`

### Task 9: 포장·문서·실제 11곡 검증

**Files:**
- Modify:
  - `tools/onside-desk/build-mac.mjs:15`(복사 목록에 `'audio-check.mjs', 'audio-engine.mjs', 'audio-check'`)
  - `tools/onside-desk/install-mac.mjs:19`(`Contents/Resources/app/audio-check.mjs`, `audio-engine.mjs`, `audio-check/worker.py` 확인)
  - `tools/onside-desk/server.mjs:21`(`DESK_VERSION = '2.17.0'`)
  - `tools/onside-desk/README.md`
    - 관리자 수동 작업 절에 사용 순서 5단계
    - 2.17.0 항목(약 3GB 설치·곡당 1–2분·이 Mac에서만 처리·확인 필요 한계·도구 폴더 삭제 방법)
- Create (커밋 안 함): `tmp/audio-check-validation/run-acceptance.mjs`
- Test: `tools/onside-desk/tests/bundle-contents.test.mjs` — `audio-check/worker.py`가 복사 목록과 설치 확인에 있는지 검사를 더한다.

**Steps:**

- [ ] **Step 1: 실패하는 테스트 작성** — `bundle-contents.test.mjs`에 worker.py 검사를 더하고 FAIL을 확인한다.

- [ ] **Step 2: 포장 목록 수정** → `node --test tools/onside-desk/tests/bundle-contents.test.mjs` PASS

- [ ] **Step 3: 합격 기준 스크립트 작성** — `run-acceptance.mjs`가 하는 일:
  1. 임시 dataRoot로 실제 `createDesk`를 띄우고 `reference-before` DOCX로 수동 음반을 가져온다.
  2. 트랙 가사를 `before-lyrics.json`으로 덮어쓴다(`PATCH local`).
  3. 바탕화면 음원 11개 파일을 연결한다(03·04·07·09는 wav와 mp3 모두).
  4. 대조 작업을 기다린 뒤, 스펙 "실제 11곡 검증 (합격 기준)" 표의 항목별 통과/실패와 전체 제안을 출력한다.
  5. 가사를 `after-lyrics.json`으로 바꾸고 다시 대조해 두 번째 기준을 출력한다.

- [ ] **Step 4: 실행과 조정**
  - `node tmp/audio-check-validation/run-acceptance.mjs`
  - 기준을 모두 통과할 때까지 `THRESHOLDS`만 조정한다.
  - 조정했으면 Task 2 테스트를 다시 PASS 시키고, 바꾼 값과 이유를 커밋 메시지에 적는다.

- [ ] **Step 5: 전체 테스트**
  - `node --import tsx --test tools/onside-desk/source.test.mjs tools/onside-desk/tests/*.test.mjs` → PASS

- [ ] **Step 6: 커밋**
  - `git add tools/onside-desk/build-mac.mjs tools/onside-desk/install-mac.mjs tools/onside-desk/server.mjs tools/onside-desk/README.md tools/onside-desk/tests/bundle-contents.test.mjs tools/onside-desk/audio-check.mjs tools/onside-desk/tests/audio-check.test.mjs && git commit -m "Ship the audio lyrics check in desk 2.17.0"`
