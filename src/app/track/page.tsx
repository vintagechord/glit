import { TrackLookupSelector } from "@/features/track/track-lookup-selector";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata = {
  title: "진행상황",
};

export default async function TrackPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isLoggedIn = Boolean(user);

  return (
    <div className="page-centered mx-auto w-full max-w-4xl px-6 py-12">
      <div>
        <p className="bauhaus-kicker">
          진행/결과 조회
        </p>
        <h1 className="font-display mt-4 text-3xl font-black text-foreground">
          조회 방식을 선택하세요
        </h1>
        <p className="mt-3 max-w-2xl text-sm font-semibold leading-6 text-muted-foreground">
          회원은 로그인한 계정의 접수 현황으로, 비회원은 조회 코드 입력으로 진행 상태와 결과를 확인할 수 있습니다.
        </p>
        <TrackLookupSelector isLoggedIn={isLoggedIn} />
      </div>
    </div>
  );
}
