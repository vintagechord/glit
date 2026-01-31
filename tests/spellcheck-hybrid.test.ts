import test from "node:test";
import assert from "node:assert";
import { runHybridSpellcheck } from "../src/lib/spellcheck-hybrid";

const sampleInput = `어제는 비가오는데도 난 우산을 안가지고 나왔다. 왜그랬는지 나도 모르게 그냥 발이 밖으로 나가버렸다. 길바닥은 미끌미끌하고, 사람들은 다들 급하게 걸어가는데 나만 천천히 걷고잇엇다.

편의점 앞에서 어떤 고양이가 나를 보더니 야옹 하고 울엇다. 나는 고양이 한테 말을 걸엇다. 너도 집에 가기 싫은거야? 고양이는 대답을 안했지만, 눈이 좀 슬퍼보엿다.

갑자기 옛날 생각이 났다. 어릴때 비오는날 엄마랑 손잡고 떡볶이 사러 가던 기억. 그땐 세상이 이렇게 복잡한줄 몰랏다. 그냥 학교가고, 밥먹고, 잠자면 하루가 끝낫다.

나는 지금 뭘하고 잇는걸까. 잘살고 잇는건지, 그냥 살아만 잇는건지 헷갈렷다. 주머니엔 동전 몇개뿐이고, 마음은 더 가벼운거 같았다. 아니, 어쩌면 더 무거운지도.

고양이는 어느새 사라지고 비는 더 쎄게 왔다. 난 그냥 웃엇다. 이유없는 웃음이엿다. 그리고 생각했다. 오늘이 망해도, 내일은 또 올거라고.

그래서 집에 갔다. 젖은 신발을 벗고, 아무것도 안한채 누웟다. 그래도 이상하게, 조금은 괜찬아진 기분이엿다.`;

const expectedOutput = `어제는 비가 오는데도 난 우산을 안 가지고 나왔다. 왜 그랬는지 나도 모르게 그냥 발이 밖으로 나가버렸다. 길바닥은 미끌미끌하고, 사람들은 다들 급하게 걸어가는데 나만 천천히 걷고 있었다.

편의점 앞에서 어떤 고양이가 나를 보더니 야옹하고 울었다. 나는 고양이한테 말을 걸었다. 너도 집에 가기 싫은 거야? 고양이는 대답을 안 했지만, 눈이 좀 슬퍼 보였다.

갑자기 옛날 생각이 났다. 어릴 때 비 오는 날 엄마랑 손잡고 떡볶이 사러 가던 기억. 그땐 세상이 이렇게 복잡한 줄 몰랐다. 그냥 학교 가고, 밥 먹고, 잠자면 하루가 끝났다.

나는 지금 뭘 하고 있는 걸까. 잘 살고 있는 건지, 그냥 살아만 있는 건지 헷갈렸다. 주머니엔 동전 몇 개뿐이고, 마음은 더 가벼운 것 같았다. 아니, 어쩌면 더 무거운지도.

고양이는 어느새 사라지고 비는 더 세게 왔다. 난 그냥 웃었다. 이유 없는 웃음이었다. 그리고 생각했다. 오늘이 망해도, 내일은 또 올 거라고.

그래서 집에 갔다. 젖은 신발을 벗고, 아무것도 안 한 채 누웠다. 그래도 이상하게, 조금은 괜찮아진 기분이었다.`;

test("hybrid spellcheck pipeline produces fixpoint-corrected text and diffs", () => {
  const { corrected, changes } = runHybridSpellcheck(sampleInput, {
    maxIterations: 5,
    confidenceThreshold: 0.6,
  });

  assert.strictEqual(corrected, expectedOutput);
  assert.ok(changes.length >= 20);

  const mustContain = ["있었다", "울었다", "비가 오", "고양이한테", "슬퍼 보였다", "웃었다", "안 한 채", "누웠다"];
  mustContain.forEach((token) => {
    assert.ok(corrected.includes(token));
  });
});
