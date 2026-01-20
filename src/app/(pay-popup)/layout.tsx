export const metadata = {
  title: "KG 이니시스 결제",
  description: "GLIT 결제 팝업",
};

export default function PayPopupLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body style={{ margin: 0, padding: 0, width: "100%", height: "100%", overflow: "auto", background: "#fff" }}>
        {children}
      </body>
    </html>
  );
}
