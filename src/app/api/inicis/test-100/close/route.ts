import { NextResponse } from "next/server";

import { areServerDevToolsEnabled } from "@/lib/dev-tools";

const postMessageResponse = () => {
  const payload = JSON.stringify({
    type: "INICIS:CANCEL",
    payload: { message: "사용자가 결제를 취소했습니다." },
  });
  const html = `
<!DOCTYPE html>
<html lang="ko">
<body style="margin:0;background:transparent;">
<script>
  (function() {
    try {
      document.body.innerHTML = "";
      if (window.opener) {
        window.opener.postMessage(${payload}, window.location.origin);
      }
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(${payload}, window.location.origin);
      }
    } catch (e) {
      console.error("INICIS postMessage error", e);
    }
    setTimeout(function() {
      try {
        window.close();
      } catch (e) {}
    }, 0);
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
  if (!areServerDevToolsEnabled()) {
    return NextResponse.json({ error: "Not Found" }, { status: 404 });
  }
  return postMessageResponse();
}

export const POST = GET;
