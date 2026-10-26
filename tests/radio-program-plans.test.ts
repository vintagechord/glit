import assert from "node:assert/strict";
import test from "node:test";
import { filterRadioPrograms, formatRadioSchedule, getRadioProgramPlan, isRadioCalendarDate } from "../src/lib/radio-program-plans";
import { getRadioStationGuide } from "../src/lib/radio-station-guide";

const mbc = getRadioStationGuide({ stationCode: "MBC" })!.programs;
const cbs = getRadioStationGuide({ stationCode: "CBS" })!.programs;
const sbs = getRadioStationGuide({ stationCode: "SBS" })!.programs;
const arirang = getRadioStationGuide({ stationCode: "ARIRANG" })!.programs;
const kbs = getRadioStationGuide({ stationCode: "KBS" })!.programs;

test("program filters combine verified broadcast time, route and segment text", () => {
  const programs = [...mbc, ...cbs, ...sbs, ...arirang];
  assert.deepEqual(filterRadioPrograms(programs, { query: "설렘", time: "morning", route: "request" }), [cbs[0]]);
  assert.deepEqual(filterRadioPrograms(programs, { query: "", time: "evening", route: "story" }), mbc);
  assert.deepEqual(filterRadioPrograms(programs, { query: "", time: "daytime", route: "request" }), [cbs[1]]);
  assert.deepEqual(filterRadioPrograms(arirang, { query: "", time: "all", route: "all" }), arirang);
  assert.deepEqual(filterRadioPrograms(arirang, { query: "", time: "morning", route: "all" }), []);
});

test("schedules distinguish overnight shows and never fabricate unverified times", () => {
  assert.equal(formatRadioSchedule(getRadioProgramPlan(kbs[0])), "매일 09:00–11:00 · KST");
  assert.equal(formatRadioSchedule(getRadioProgramPlan(mbc[0])), "매일 20:00–22:00 · KST");
  assert.equal(formatRadioSchedule(getRadioProgramPlan(sbs[0])), "매일 23:00–다음 날 01:00 · KST");
  assert.match(formatRadioSchedule(getRadioProgramPlan(arirang[0])), /공식 프로그램에서 확인/);
  assert.match(formatRadioSchedule(getRadioProgramPlan(sbs[0]), true), /next day 01:00/);
});

test("story selection explicitly stays separate from song selection, with official evidence", () => {
  const plan = getRadioProgramPlan(mbc[0])!;
  const story = plan.routes.find(route => route.kind === "story")!;
  assert.match(story.songPolicy.ko, /제작진이.*추천/);
  assert.match(story.songPolicy.ko, /내 곡이 함께 나오는 것은 아닙니다/);
  for (const program of [...mbc, ...cbs, ...sbs, ...kbs]) {
    const item = getRadioProgramPlan(program)!;
    assert.equal(item.verifiedAt, "2026-10-27");
    const host = new URL(program.url).hostname;
    assert.equal(new URL(item.schedule!.sourceUrl).hostname, host);
    for (const route of item.routes) {
      assert.equal(new URL(route.url).hostname, host);
      assert.equal(new URL(route.sourceUrl).hostname, host);
      assert.equal(new URL(route.sourceUrl).protocol, "https:");
    }
  }
});

test("calendar dates reject impossible dates and rollover", () => {
  for (const value of ["2026-10-27", "2028-02-29"]) assert.equal(isRadioCalendarDate(value), true);
  for (const value of ["2026-02-29", "2026-02-30", "2026-13-01", "2026-1-01", "today", ""]) assert.equal(isRadioCalendarDate(value), false);
});
