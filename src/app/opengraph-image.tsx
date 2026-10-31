import { ImageResponse } from "next/og";

import { loadOgFont } from "@/lib/og-fonts";

export const alt = "온사이드 — 음반심의·뮤직비디오 심의 온라인 접수";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpenGraphImage() {
  const font = await loadOgFont();
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#f7f5ef", border: "18px solid #111111", padding: "56px 64px", fontFamily: "Nanum Gothic" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ width: 44, height: 44, background: "#f2cf27", border: "6px solid #111111" }} />
          <div style={{ fontSize: 44, color: "#111111", letterSpacing: 2 }}>ONSIDE 온사이드</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div style={{ fontSize: 76, color: "#111111", lineHeight: 1.15 }}>음반심의 · 뮤직비디오 심의</div>
          <div style={{ fontSize: 76, color: "#111111", lineHeight: 1.15 }}>온라인 접수부터 결과까지</div>
          <div style={{ display: "flex", gap: 14, marginTop: 8 }}>
            {["KBS·MBC·SBS 방송국 심의", "라디오 심의", "뮤직비디오 등급분류"].map((label, index) => (
              <div key={label} style={{ display: "flex", fontSize: 30, padding: "10px 18px", border: "4px solid #111111", background: ["#f2cf27", "#1556a4", "#d9362c"][index], color: index === 0 ? "#111111" : "#ffffff" }}>{label}</div>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 30, color: "#111111" }}>
          <div>Since 2017 · 심의 대행</div>
          <div>iamonside.com</div>
        </div>
      </div>
    ),
    { ...size, fonts: [{ name: "Nanum Gothic", data: font, weight: 700, style: "normal" }] },
  );
}
