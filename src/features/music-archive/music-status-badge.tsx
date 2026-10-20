import { CheckCircle2, CircleDashed, Clock3, CircleAlert, XCircle } from "lucide-react";
import { Badge, type BadgeTone } from "./ui";

const statusTones: Record<string, BadgeTone> = {
  "심의 완료": "success", "적격": "success", "등록됨": "success", "수록됨": "success",
  "수록 정보 있음": "success", "등록 정보 있음": "success", "저작자 정보 있음": "success",
  "일부 심의 완료": "warning", "확인 필요": "warning",
  "접수·결제 진행 중": "progress", "심의 진행 중": "progress", "신청 중": "progress",
  "부적격": "danger", "반려": "danger",
};
const statusIcons = { success: CheckCircle2, warning: CircleAlert, progress: Clock3, danger: XCircle, neutral: CircleDashed };

export function MusicStatusBadge({ status }: { status: string }) {
  const tone = statusTones[status] ?? "neutral";
  const Icon = statusIcons[tone];
  return <Badge tone={tone}><Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />{status}</Badge>;
}
