import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { KeyRound, UserRound } from "lucide-react";

import { EnglishTrackLookupForm } from "@/features/global/english-track-lookup-form";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Check Review Progress",
  robots: {
    index: false,
    follow: false,
  },
};

type TrackPageProps = {
  searchParams?: Promise<{ mode?: string | string[] }>;
};

const toSingle = (value?: string | string[]) =>
  Array.isArray(value) ? value[0] ?? "" : value ?? "";

export default async function EnglishTrackPage({
  searchParams,
}: TrackPageProps) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/mypage");
  }

  const resolvedSearchParams = (await searchParams) ?? {};
  const isGuestMode = toSingle(resolvedSearchParams.mode) === "guest";

  return (
    <div className="page-centered mx-auto w-full max-w-4xl px-6 py-12">
      <div>
        <p className="bauhaus-kicker">Progress / Results</p>
        <h1 className="font-display mt-4 text-3xl font-black text-foreground">
          {isGuestMode ? "Guest Progress Lookup" : "Choose a lookup method"}
        </h1>
        <p className="mt-3 max-w-2xl text-sm font-semibold leading-6 text-muted-foreground">
          {isGuestMode
            ? "Enter the lookup code issued after submission to check progress and results."
            : "Members can check saved submissions from My Page. Guests can use the lookup code issued after submission."}
        </p>

        {isGuestMode ? (
          <div className="mt-8 rounded-[10px] border-2 border-[#111111] bg-card p-5 shadow-[5px_5px_0_#111111] dark:border-[#f2cf27] dark:shadow-[5px_5px_0_#f2cf27]">
            <EnglishTrackLookupForm />
          </div>
        ) : (
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            <Link
              href={`/login?next=${encodeURIComponent("/mypage")}`}
              className="group min-h-[170px] rounded-[10px] border-2 border-border bg-card p-5 transition hover:border-[#111111] hover:shadow-[5px_5px_0_#111111]"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[11px] font-black uppercase tracking-normal text-muted-foreground">
                    Member
                  </p>
                  <h2 className="mt-3 text-xl font-black">Member Lookup</h2>
                </div>
                <UserRound className="h-8 w-8" strokeWidth={2.4} />
              </div>
              <p className="mt-8 text-sm font-semibold leading-6 text-muted-foreground">
                Login and go directly to your saved submission history.
              </p>
            </Link>

            <Link
              href="/en/track?mode=guest"
              className="group min-h-[170px] rounded-[10px] border-2 border-border bg-card p-5 transition hover:border-[#111111] hover:shadow-[5px_5px_0_#111111]"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[11px] font-black uppercase tracking-normal text-muted-foreground">
                    Guest
                  </p>
                  <h2 className="mt-3 text-xl font-black">Guest Lookup</h2>
                </div>
                <KeyRound className="h-8 w-8" strokeWidth={2.4} />
              </div>
              <p className="mt-8 text-sm font-semibold leading-6 text-muted-foreground">
                Use your lookup code to check progress and result files.
              </p>
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
