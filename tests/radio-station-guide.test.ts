import assert from "node:assert/strict";
import test from "node:test";

import { getRadioStationGuide } from "../src/lib/radio-station-guide";

test("program choices keep every participation link on the selected broadcaster", () => {
  const hosts = {
    KBS: "program.kbs.co.kr",
    MBC: "m.imbc.com",
    SBS: "programs.sbs.co.kr",
    CBS: "www.cbs.co.kr",
    ARIRANG: "www.arirang.com",
  };
  for (const [stationCode, hostname] of Object.entries(hosts)) {
    const guide = getRadioStationGuide({ stationCode })!;
    assert.ok(guide.programs.length > 0);
    assert.equal(new Set(guide.programs.map(program => program.name)).size, guide.programs.length);
    for (const program of guide.programs) {
      assert.ok(program.description.ko.trim());
      assert.ok(program.description.en.trim());
      assert.notEqual(program.messageUrl, program.url);
      assert.notEqual(program.playlistUrl, program.url);
      for (const link of [program.url, program.messageUrl, program.playlistUrl]) {
        const url = new URL(link);
        assert.equal(url.protocol, "https:");
        assert.equal(url.hostname, hostname);
        assert.equal(url.username, "");
        assert.equal(url.password, "");
      }
    }
  }
});

test("SBS uses the on-air music program's official request and playlist menus", () => {
  const guide = getRadioStationGuide({ stationCode: "SBS파워FM" })!;
  const program = guide.programs.find(item => item.name === "딘딘의 뮤직하이")!;
  assert.equal(program.messageUrl, "https://programs.sbs.co.kr/radio/dindinmusichigh/boards/66355");
  assert.equal(program.playlistUrl, "https://programs.sbs.co.kr/radio/dindinmusichigh/songlist/66346");
  assert.ok(guide.programs.every(item => !item.name.includes("파워타임")));
  assert.equal(guide.directoryUrl, "https://radio.sbs.co.kr/");
});

test("CBS program choices retain current names and correct request-board privacy guidance", () => {
  const guide = getRadioStationGuide({ stationCode: "CBS" })!;
  const morning = guide.programs.find(item => item.name === "김윤주의 그대와 여는 아침")!;
  assert.equal(morning.messageUrl, "https://www.cbs.co.kr/board/list/cbs_P000218_request");
  assert.equal(morning.playlistUrl, "https://www.cbs.co.kr/program/playlist/cbs_P000218");
  assert.match(morning.description.ko, /작성자 본인과 관리자만/);
  assert.match(morning.description.en, /only to their author and administrators/);
  const noon = guide.programs.find(item => item.name === "이수영의 12시에 만납시다")!;
  assert.equal(noon.messageUrl, "https://www.cbs.co.kr/board/list/cbs_P000004_request");
  assert.equal(noon.playlistUrl, "https://www.cbs.co.kr/program/playlist/cbs_P000004");
});

test("KBS uses its verified current program while unknown stations cannot borrow another broadcaster", () => {
  const kbs = getRadioStationGuide({ stationCode: "KBS" })!;
  assert.equal(kbs.directoryUrl, "https://radio.kbs.co.kr/");
  assert.equal(kbs.programs[0].name, "이현우의 음악앨범");
  assert.match(kbs.programs[0].messageUrl, /R2007-0069-03-848149/);
  assert.match(kbs.programs[0].playlistUrl, /R2007-0069-03-136492/);
  assert.equal(kbs.participationLink?.name, "KBS 콩");
  assert.equal(getRadioStationGuide({ stationCode: "KISS", stationName: "SBS" }), null);
  assert.equal(getRadioStationGuide({ stationCode: "ARIRANG" })?.verifiedAt, "2026-10-17");
});
