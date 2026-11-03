import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

/** ?page=N from an admin list URL; anything else is page 1. */
export const parseAdminListPage = (value?: string | string[]) => {
  const raw = Array.isArray(value) ? value[0] : value;
  const page = Number(raw);
  return Number.isInteger(page) && page > 1 && page <= 100_000 ? page : 1;
};

export const adminListRange = (page: number, pageSize: number) => {
  const from = (page - 1) * pageSize;
  return { from, to: from + pageSize - 1 };
};

/** Previous/next links shared by the admin list pages (same look as
 * /admin/submissions). */
export function AdminListPager({
  page,
  totalCount,
  pageSize,
  hrefForPage,
}: {
  page: number;
  totalCount: number;
  pageSize: number;
  hrefForPage: (page: number) => string;
}) {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const linkClass = (disabled: boolean) =>
    `inline-flex h-9 min-w-9 items-center justify-center rounded-[8px] border-2 px-3 transition ${
      disabled
        ? "pointer-events-none border-border/60 text-muted-foreground opacity-50"
        : "border-border bg-card text-foreground hover:border-[#111111] dark:hover:border-[#f2cf27]"
    }`;
  return (
    <nav aria-label="목록 페이지" className="flex items-center gap-2 text-xs font-bold text-muted-foreground">
      <Link href={hrefForPage(Math.max(1, page - 1))} aria-disabled={page <= 1} className={linkClass(page <= 1)}>
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        <span className="sr-only">이전</span>
      </Link>
      <span className="rounded-[8px] border-2 border-border bg-background px-3 py-2 text-[11px] text-foreground">
        {Math.min(page, totalPages)} / {totalPages}
      </span>
      <Link href={hrefForPage(Math.min(totalPages, page + 1))} aria-disabled={page >= totalPages} className={linkClass(page >= totalPages)}>
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
        <span className="sr-only">다음</span>
      </Link>
    </nav>
  );
}
