export const metadata = {
  title: "온사이드 카드 결제",
  description: "온사이드 결제 창",
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
