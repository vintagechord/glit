import { NextResponse } from "next/server";

const postMessageResponse = () => {
  const payload = JSON.stringify({
    type: "INICIS:CANCEL",
    payload: { message: "사용자가 결제를 취소했습니다." },
  });
  const html = `
<!DOCTYPE html>
<html lang="ko">
<body>
<p>결제 창을 닫아주세요.</p>
<script>
  (function() {
    try {
      if (window.opener) {
        window.opener.postMessage(${payload}, "*");
      }
    } catch (e) {
      console.error("INICIS postMessage error", e);
    }
    window.close();
  })();
</script>
</body>
</html>
`;
  return new NextResponse(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return postMessageResponse();
}

export const POST = GET;
