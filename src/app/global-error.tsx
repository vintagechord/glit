"use client";

// Replaces the root layout when the layout itself fails, so it cannot rely on
// globals.css: keep the styles inline.
export default function GlobalError({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="ko">
      <body style={{ margin: 0, background: "#f7f3ea", color: "#111111", fontFamily: "system-ui, sans-serif" }}>
        <title>온사이드 · 오류</title>
        <main style={{ maxWidth: 560, margin: "64px auto", padding: "0 24px" }}>
          <div style={{ border: "2px solid #111111", borderRadius: 10, background: "#ffffff", padding: 24, boxShadow: "8px 8px 0 #111111" }}>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 900 }}>페이지를 불러오지 못했습니다</h1>
            <p style={{ margin: "12px 0 0", fontSize: 14, fontWeight: 600, lineHeight: 1.6 }}>
              잠시 후 다시 시도해주세요. The page could not be loaded; please try again.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 20 }}>
              <button
                type="button"
                onClick={retry}
                style={{ border: "2px solid #111111", borderRadius: 8, background: "#f2cf27", color: "#111111", padding: "10px 18px", fontSize: 14, fontWeight: 900, cursor: "pointer" }}
              >
                다시 불러오기 · Try again
              </button>
              {/* A plain link: the router may be the part that failed. */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a href="/" style={{ border: "2px solid #111111", borderRadius: 8, background: "#ffffff", color: "#111111", padding: "10px 18px", fontSize: 14, fontWeight: 900, textDecoration: "none" }}>
                홈으로 · Home
              </a>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
