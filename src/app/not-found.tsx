import Link from "next/link";

// Shown inside the root layout for unknown URLs and notFound() calls in both
// locales. The page is prerendered once, so it carries both languages.
export const metadata = {
  title: "페이지를 찾을 수 없습니다",
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-12">
      <div className="rounded-[10px] border-2 border-[#111111] bg-card p-6 shadow-[8px_8px_0_#111111] dark:border-[#f2cf27] dark:shadow-[8px_8px_0_#f2cf27]">
        <p className="bauhaus-kicker">404</p>
        <h1 className="mt-4 text-2xl font-black text-foreground">
          페이지를 찾을 수 없습니다
        </h1>
        <p className="mt-3 text-sm font-semibold leading-6 text-muted-foreground">
          주소가 바뀌었거나 삭제된 페이지입니다.
        </p>
        <p lang="en" className="mt-1 text-sm font-semibold leading-6 text-muted-foreground">
          This page does not exist or has moved.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/" className="bauhaus-button px-5 py-3 text-sm">
            홈으로
          </Link>
          <Link href="/en" className="bauhaus-button px-5 py-3 text-sm">
            English home
          </Link>
          <Link href="/support" className="bauhaus-button px-5 py-3 text-sm">
            고객센터
          </Link>
        </div>
      </div>
    </div>
  );
}
