import assert from "node:assert/strict";
import test from "node:test";
import {
  createEmptyRadioRequestWorkspace,
  createRadioRequestWorkspaceRegistry,
  createRadioRequestWorkspaceStore,
  parseRadioRequestWorkspace,
  radioRequestWorkspaceKey,
  RADIO_REQUEST_WORKSPACE_LIMITS,
  type RadioRequestDraft,
  type RadioRequestWorkspaceStorage,
} from "../src/lib/radio-request-workspace";

function memoryStorage() {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => { items.set(key, value); },
    removeItem: (key: string) => { items.delete(key); },
  };
}

const draft: RadioRequestDraft = {
  title: "내 곡 신청", body: "함께 듣고 싶습니다.", story: "곡을 만든 이야기",
  prompt: 1, titleCopied: true, bodyCopied: true, listeningUrl: "https://example.com/song",
};

function envelope(state: unknown, submissionId = "album-one", version = 1) {
  return JSON.stringify({ version, submissionId, state });
}

test("workspace reload restores typed drafts, selected context and posting progress but not clipboard claims", () => {
  const storage = memoryStorage();
  const store = createRadioRequestWorkspaceStore("album-one", { getStorage: () => storage });
  assert.equal(store.getSnapshot().storageStatus, "ready");
  store.setField("stationId", "kbs-review");
  store.setField("step", 4);
  store.setField("selections", { "kbs-review": { track: "song-one", program: "저녁 라디오", language: "ko" } });
  store.setField("manualNames", { legacy: { title: "곡 이름", artist: "아티스트" } });
  store.setField("drafts", { "song-program-ko": draft });
  store.setField("progress", { "song-program": { posted: true, rules: true, privacy: false, playlist: true, postUrl: "https://example.com/post", memo: "내 신청 기록", postedAt: "2026-10-20T10:00:00.000Z" } });
  assert.equal(store.getSnapshot().storageStatus, "saved");
  const raw = storage.getItem(radioRequestWorkspaceKey("album-one"))!;
  assert.equal(JSON.parse(raw).version, 1);
  const restored = createRadioRequestWorkspaceStore("album-one", { getStorage: () => storage }).getSnapshot();
  assert.equal(restored.storageStatus, "restored");
  assert.deepEqual(restored.state, {
    ...store.getSnapshot().state,
    drafts: { "song-program-ko": { ...draft, titleCopied: false, bodyCopied: false } },
  });
});

test("same-tab observers share atomic functional updates while other submissions remain isolated", () => {
  const storage = memoryStorage();
  const registry = createRadioRequestWorkspaceRegistry({ getStorage: () => storage });
  const body = registry.getStore("one");
  const dialog = registry.getStore("one");
  const other = registry.getStore("two");
  assert.equal(body, dialog);
  let bodyUpdates = 0;
  let dialogUpdates = 0;
  let otherUpdates = 0;
  const unsubscribe = body.subscribe(() => bodyUpdates++);
  dialog.subscribe(() => dialogUpdates++);
  other.subscribe(() => otherUpdates++);
  body.setField("drafts", previous => ({ ...previous, first: draft }));
  dialog.setField("drafts", previous => ({ ...previous, second: { ...draft, body: "두 번째" } }));
  assert.deepEqual(Object.keys(body.getSnapshot().state.drafts), ["first", "second"]);
  assert.equal(bodyUpdates, 2);
  assert.equal(dialogUpdates, 2);
  assert.equal(otherUpdates, 0);
  assert.deepEqual(other.getSnapshot().state, createEmptyRadioRequestWorkspace());
  unsubscribe();
  dialog.setField("step", previous => previous + 1);
  assert.equal(bodyUpdates, 2);
  assert.equal(dialogUpdates, 3);
  assert.equal(registry.getStore("one").getSnapshot().state.step, 2);
});

test("draft contexts remain distinct and a separate tab registry starts from its own storage", () => {
  const storage = memoryStorage();
  const firstTab = createRadioRequestWorkspaceRegistry({ getStorage: () => storage });
  const contexts = ["station-a/song-a/program-a/ko", "station-b/song-a/program-a/ko", "station-a/song-b/program-a/ko", "station-a/song-a/program-b/ko", "station-a/song-a/program-a/en"];
  for (const [index, key] of contexts.entries()) firstTab.getStore("one").setField("drafts", previous => ({ ...previous, [key]: { ...draft, body: `draft-${index}` } }));
  assert.deepEqual(Object.values(firstTab.getStore("one").getSnapshot().state.drafts).map(item => item.body), contexts.map((_, index) => `draft-${index}`));
  const secondTab = createRadioRequestWorkspaceRegistry({ getStorage: () => memoryStorage() });
  assert.deepEqual(secondTab.getStore("one").getSnapshot().state.drafts, {});
  assert.equal(radioRequestWorkspaceKey("a:b"), "onside:radio-request:v1:a%3Ab");
});

test("malformed, oversized, wrong-version and cross-submission storage never hydrate", () => {
  const state = createEmptyRadioRequestWorkspace();
  const invalid = [
    "{broken", "null", "[]", envelope(state, "another-submission"), envelope(state, "album-one", 2),
    envelope({ ...state, step: 0 }), envelope({ ...state, step: 5 }),
    envelope({ ...state, drafts: [] }), envelope({ ...state, selections: { station: { language: "unknown" } } }),
    envelope({ ...state, progress: { context: { posted: "true" } } }),
    envelope({ ...state, progress: { context: { postedAt: "yesterday" } } }),
    envelope({ ...state, drafts: { context: { ...draft, body: "a".repeat(5001) } } }),
    " ".repeat(RADIO_REQUEST_WORKSPACE_LIMITS.serialized + 1),
  ];
  for (const raw of invalid) {
    assert.equal(parseRadioRequestWorkspace(raw, "album-one"), null);
    const storage = memoryStorage();
    storage.setItem(radioRequestWorkspaceKey("album-one"), raw);
    const store = createRadioRequestWorkspaceStore("album-one", { getStorage: () => storage });
    assert.equal(store.getSnapshot().storageStatus, "unavailable");
    assert.deepEqual(store.getSnapshot().state, state);
  }
});

test("storage only retains allowed UI fields and rejects dangerous record keys", () => {
  const state = { ...createEmptyRadioRequestWorkspace(), drafts: { context: { ...draft, guestToken: "private" } }, applicantEmail: "private@example.com" };
  const parsed = parseRadioRequestWorkspace(envelope(state), "album-one")!;
  assert.doesNotMatch(JSON.stringify(parsed), /guestToken|private|applicantEmail/);
  for (const key of ["__proto__", "constructor", "prototype"]) {
    const unsafe = { ...createEmptyRadioRequestWorkspace(), selections: JSON.parse(`{"${key}":{}}`) };
    assert.equal(parseRadioRequestWorkspace(envelope(unsafe), "album-one"), null);
  }
});

test("blocked storage reads or writes keep all current input available in memory", () => {
  const inaccessible = createRadioRequestWorkspaceStore("one", { getStorage: () => { throw new Error("SecurityError"); } });
  assert.equal(inaccessible.getSnapshot().storageStatus, "unavailable");
  inaccessible.setField("drafts", { context: draft });
  assert.deepEqual(inaccessible.getSnapshot().state.drafts.context, draft);
  const storage: RadioRequestWorkspaceStorage = {
    getItem: () => null, setItem: () => { throw new Error("QuotaExceededError"); }, removeItem: () => {},
  };
  const full = createRadioRequestWorkspaceStore("two", { getStorage: () => storage });
  full.setField("drafts", { context: draft });
  full.setField("progress", { context: { posted: true, memo: "계속 작성 중" } });
  assert.equal(full.getSnapshot().storageStatus, "unavailable");
  assert.deepEqual(full.getSnapshot().state.drafts.context, draft);
  assert.equal(full.getSnapshot().state.progress.context.memo, "계속 작성 중");
});

test("persistence limits never silently truncate live input and saving recovers when within bounds", () => {
  const storage = memoryStorage();
  const store = createRadioRequestWorkspaceStore("one", { getStorage: () => storage });
  const manyDrafts = Object.fromEntries(Array.from({ length: RADIO_REQUEST_WORKSPACE_LIMITS.entries + 1 }, (_, index) => [`draft-${index}`, draft]));
  store.setField("drafts", manyDrafts);
  assert.equal(Object.keys(store.getSnapshot().state.drafts).length, 65);
  assert.equal(store.getSnapshot().storageStatus, "unavailable");
  assert.equal(storage.items.size, 0);
  store.setField("drafts", { context: { ...draft, body: "x".repeat(5001) } });
  assert.equal(store.getSnapshot().state.drafts.context.body.length, 5001);
  assert.equal(store.getSnapshot().storageStatus, "unavailable");
  store.setField("drafts", { context: draft });
  assert.equal(store.getSnapshot().storageStatus, "saved");
  assert.equal(storage.items.size, 1);
});

test("workspace reset clears only the selected submission and notifies every same-tab observer", () => {
  const storage = memoryStorage();
  const registry = createRadioRequestWorkspaceRegistry({ getStorage: () => storage });
  const one = registry.getStore("one");
  const two = registry.getStore("two");
  one.setField("drafts", { context: draft });
  two.setField("drafts", { context: draft });
  let resets = 0;
  one.subscribe(() => resets++);
  registry.getStore("one").resetWorkspace();
  assert.equal(resets, 1);
  assert.deepEqual(one.getSnapshot().state, createEmptyRadioRequestWorkspace());
  assert.equal(one.getSnapshot().storageStatus, "ready");
  assert.equal(storage.getItem(radioRequestWorkspaceKey("one")), null);
  assert.notEqual(storage.getItem(radioRequestWorkspaceKey("two")), null);
  assert.deepEqual(two.getSnapshot().state.drafts.context, draft);
});

test("snapshots stay referentially stable and server snapshots never include browser state", () => {
  const storage = memoryStorage();
  const store = createRadioRequestWorkspaceStore("one", { getStorage: () => storage });
  const initial = store.getSnapshot();
  assert.equal(initial, store.getSnapshot());
  const server = store.getServerSnapshot();
  store.setField("drafts", { context: draft });
  assert.notEqual(initial, store.getSnapshot());
  assert.equal(server, store.getServerSnapshot());
  assert.deepEqual(server.state, createEmptyRadioRequestWorkspace());
  assert.equal(server.storageStatus, "ready");
});
