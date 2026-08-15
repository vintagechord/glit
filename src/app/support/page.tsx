import { Clock3, Mail, Phone } from "lucide-react";

import { APP_CONFIG } from "@/lib/config";
import { SupportInquiryModal } from "@/features/support/support-inquiry-modal";

export const metadata = {
  title: "고객센터",
};

export default function SupportPage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-12">
      <p className="bauhaus-kicker">고객센터</p>
      <h1 className="font-display mt-4 text-3xl font-black text-foreground">
        어떻게 도와드릴까요?
      </h1>

      <section className="mt-8 grid gap-4 sm:grid-cols-3">
        <a
          href={`tel:${APP_CONFIG.supportPhone}`}
          className="group flex min-h-36 flex-col items-center justify-center gap-3 rounded-[10px] border-2 border-[#111111] bg-[#f2cf27] p-5 text-center text-[#111111] shadow-[5px_5px_0_#111111] transition hover:-translate-y-1 dark:border-[#f2cf27] dark:shadow-[5px_5px_0_#f2cf27]"
        >
          <Phone className="h-8 w-8" aria-hidden="true" />
          <span className="text-base font-black">전화</span>
          <span className="text-xs font-semibold">{APP_CONFIG.supportPhone}</span>
        </a>
        <a
          href={`mailto:${APP_CONFIG.supportEmail}`}
          className="group flex min-h-36 flex-col items-center justify-center gap-3 rounded-[10px] border-2 border-[#111111] bg-[#1556a4] p-5 text-center text-white shadow-[5px_5px_0_#111111] transition hover:-translate-y-1 dark:border-[#f2cf27] dark:shadow-[5px_5px_0_#f2cf27]"
        >
          <Mail className="h-8 w-8" aria-hidden="true" />
          <span className="text-base font-black">이메일</span>
          <span className="max-w-full truncate text-xs font-semibold">
            {APP_CONFIG.supportEmail}
          </span>
        </a>
        <SupportInquiryModal
          className="flex min-h-36 w-full flex-col items-center justify-center gap-3 rounded-[10px] border-2 border-[#111111] bg-[var(--bauhaus-red)] p-5 text-center text-base font-black text-white shadow-[5px_5px_0_#111111] transition hover:-translate-y-1 dark:border-[#f2cf27] dark:text-[#06111f] dark:shadow-[5px_5px_0_#f2cf27]"
        />
      </section>

      <div className="mt-7 flex justify-center">
        <div className="inline-flex items-center gap-2 rounded-full border-2 border-border bg-card px-4 py-2 text-xs font-black text-muted-foreground">
          <Clock3 className="h-4 w-4" aria-hidden="true" />
          <span>{APP_CONFIG.supportHours}</span>
        </div>
      </div>
    </div>
  );
}
