import { useState } from "react";
import { downloadRadioText, RadioDraftEditor } from "../../../src/features/submissions/radio-request-ui";
import type { RadioRequestDraft } from "../../../src/lib/radio-request-workspace";

export function RadioDraftEditorFixture() {
  const english = new URLSearchParams(window.location.search).get("language") === "en";
  const [readOnly, setReadOnly] = useState(false);
  const [draft, setDraft] = useState<RadioRequestDraft>({ title: "[신청곡] 나의 활동명 - 저녁빛", body: "바쁜 하루를 보낸 분들과 함께 듣고 싶은 곡입니다.", story: "", prompt: 0, titleCopied: false, bodyCopied: false });
  return <main className="mx-auto max-w-2xl p-3">
    <button type="button" onClick={() => setReadOnly(value => !value)}>Toggle preview</button>
    <RadioDraftEditor draft={draft} updateDraft={setDraft} isEnglish={english} readOnly={readOnly} onDownload={() => downloadRadioText(`${draft.title}\n\n${draft.body}`)} />
  </main>;
}
