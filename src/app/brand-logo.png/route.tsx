import { ImageResponse } from "next/og";

import { loadOgFont } from "@/lib/og-fonts";

// Raster logo for search engines' structured data; generated at build time.
export const dynamic = "force-static";

export async function GET() {
  const font = await loadOgFont();
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#f2cf27", border: "28px solid #111111" }}>
        <div style={{ display: "flex", fontSize: 118, color: "#111111", fontFamily: "Nanum Gothic", letterSpacing: 4 }}>ONSIDE</div>
      </div>
    ),
    { width: 512, height: 512, fonts: [{ name: "Nanum Gothic", data: font, weight: 700, style: "normal" }] },
  );
}
