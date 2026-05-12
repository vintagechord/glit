"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

import { TrackLookupForm } from "./track-lookup-form";

export function ResultCheckButton({
  label = "결과 확인",
  className,
  modalTitle = "비회원 코드 입력",
}: {
  label?: string;
  className?: string;
  modalTitle?: string;
}) {
  const router = useRouter();
  const titleId = React.useId();
  const [open, setOpen] = React.useState(false);
  const [checking, setChecking] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const handleClick = async () => {
    if (checking) return;
    setChecking(true);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        router.push("/dashboard");
        return;
      }

      setOpen(true);
    } catch {
      setOpen(true);
    } finally {
      setChecking(false);
    }
  };

  return (
    <>
      <button type="button" onClick={handleClick} className={className}>
        {checking ? "확인 중..." : label}
      </button>
      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="w-full max-w-md rounded-[8px] border border-[#cbdde8] bg-white p-6 text-[#2f3a4d] shadow-[0_16px_44px_rgba(15,23,42,0.18)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-4">
              <p id={titleId} className="text-sm font-semibold">
                {modalTitle}
              </p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-[8px] border border-[#c9d6e8] px-3 py-1 text-xs font-semibold text-[#667085] transition hover:border-[#2f6f9f] hover:text-[#2f6f9f]"
              >
                닫기
              </button>
            </div>
            <TrackLookupForm onSuccess={() => setOpen(false)} />
          </div>
        </div>
      ) : null}
    </>
  );
}
