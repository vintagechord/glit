import type { SupabaseClient } from "@supabase/supabase-js";

type ResultStatusValue = "APPROVED" | "REJECTED" | "NEEDS_FIX";

type SupabaseLikeError = {
  code?: string;
  message?: string | null;
};

const mvFallbackStationByType: Record<string, { code: string; name: string }> = {
  MV_DISTRIBUTION: { code: "MV_ONLINE", name: "영상물등급위원회" },
  MV_BROADCAST: { code: "MV_BROADCAST", name: "신청 방송국" },
};

const formatSupabaseError = (error?: SupabaseLikeError | null) => {
  if (!error) return "unknown error";
  const code = error.code ? `(${error.code})` : "";
  return `${code} ${error.message ?? "unknown error"}`.trim();
};

export async function resolveMvFallbackStationId(
  client: SupabaseClient,
  submissionId: string,
) {
  const { data: submission, error: submissionError } = await client
    .from("submissions")
    .select("type")
    .eq("id", submissionId)
    .maybeSingle();

  if (submissionError) {
    return {
      stationId: "",
      error: `접수 정보를 확인할 수 없습니다. ${formatSupabaseError(submissionError)}`,
    };
  }

  const type = typeof submission?.type === "string" ? submission.type : "";
  const fallbackStation = mvFallbackStationByType[type];
  if (!fallbackStation) {
    return { stationId: "", error: "방송국 ID를 확인할 수 없습니다." };
  }

  const { data: station, error: stationError } = await client
    .from("stations")
    .upsert(
      { code: fallbackStation.code, name: fallbackStation.name, is_active: true },
      { onConflict: "code" },
    )
    .select("id")
    .maybeSingle();

  if (stationError || !station?.id) {
    return {
      stationId: "",
      error: `MV 진행 기준 방송국을 저장할 수 없습니다. ${formatSupabaseError(stationError)}`,
    };
  }

  return { stationId: station.id as string, error: null };
}

export async function completeMvReviewFlow(
  client: SupabaseClient,
  submissionId: string,
  options: {
    actorUserId: string;
    rating?: string | null;
    resultStatus?: string | null;
    resultMemo?: string | null;
    includeNonMv?: boolean;
  },
) {
  // No client-side early return: the RPC also checks/repairs legacy partial MV
  // saves and serializes concurrent saves before deciding that nothing changed.
  const { data, error } = await client.rpc("save_submission_review_result", {
    p_submission_id: submissionId,
    p_actor_user_id: options.actorUserId,
    p_rating: options.rating ?? null,
    p_result_status: options.resultStatus ?? null,
    p_result_memo: options.resultMemo ?? null,
    p_set_result_memo: options.resultMemo !== undefined,
    p_allow_album: options.includeNonMv === true,
  });
  if (error || !data?.completed) {
    return { completed: false, error: "심의 결과 저장을 확인하지 못했습니다. 현재 결과를 확인한 뒤 다시 시도해주세요." };
  }
  return {
    completed: true,
    changed: data.changed === true,
    stationCount: Number(data.stationCount ?? 0),
    resultStatus: data.resultStatus as ResultStatusValue,
    changeKey: data.changeKey as string | undefined,
  };
}
