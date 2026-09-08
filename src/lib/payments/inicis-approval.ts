import { createAdminClient } from "@/lib/supabase/admin";

export async function claimInicisSubmissionApproval(orderId: string, callbackState: string) {
  const { data, error } = await createAdminClient().rpc("claim_inicis_submission_approval", {
    p_order_id: orderId, p_callback_state: callbackState,
  });
  const claim = (data as Array<{ already_approved: boolean; already_processing: boolean }> | null)?.[0];
  return error || !claim ? null : { alreadyApproved: claim.already_approved, alreadyProcessing: claim.already_processing };
}

export async function settleInicisSubmissionApproval(input: {
  orderId: string; callbackState: string; confirmedFailure: boolean;
  resultCode: string; resultMessage: string; rawResponse?: Record<string, unknown>;
}) {
  const { data, error } = await createAdminClient().rpc("settle_inicis_submission_approval", {
    p_order_id: input.orderId,
    p_callback_state: input.callbackState,
    p_outcome: input.confirmedFailure ? "FAILED" : "UNCERTAIN",
    p_result_code: input.resultCode,
    p_result_message: input.resultMessage,
    p_raw_response: input.rawResponse ?? {},
  });
  return !error && Boolean(data?.length);
}
