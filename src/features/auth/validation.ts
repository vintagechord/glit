import { z } from "zod";

const emailSchema = z.string({ error: "이메일을 입력해주세요." })
  .trim().email("올바른 이메일 주소를 입력해주세요.")
  .max(254, "이메일은 254자 이하로 입력해주세요.");

const newPasswordSchema = z.string({ error: "비밀번호를 입력해주세요." })
  .min(8, "비밀번호는 8자 이상 입력해주세요.")
  .max(128, "비밀번호는 128자 이하로 입력해주세요.");

export const loginSchema = z.object({
  email: emailSchema,
  // Existing accounts may predate today's signup password policy.
  password: z.string({ error: "비밀번호를 입력해주세요." })
    .min(1, "비밀번호를 입력해주세요.")
    .max(128, "비밀번호는 128자 이하로 입력해주세요."),
  next: z.string().max(2048, "이동 경로가 너무 깁니다.").optional(),
});

const requiredAgreement = z.literal("on", { error: "필수 항목에 동의해주세요." });

export const signupSchema = z.object({
  name: z.string().trim().max(100, "이름은 100자 이하로 입력해주세요.").optional(),
  company: z.string().trim().max(200, "회사명은 200자 이하로 입력해주세요.").optional(),
  phone: z.string().trim().max(40, "연락처는 40자 이하로 입력해주세요.").optional(),
  email: emailSchema,
  password: newPasswordSchema,
  confirmPassword: newPasswordSchema,
  agreeAge: requiredAgreement,
  agreeTerms: requiredAgreement,
  agreePrivacy: requiredAgreement,
  agreeRefund: requiredAgreement,
  agreeMarketing: z.literal("on", { error: "수신 동의 항목을 확인해주세요." }).optional(),
}).refine((data) => data.password === data.confirmPassword, {
  path: ["confirmPassword"],
  message: "비밀번호가 일치하지 않습니다.",
});

export const profileSchema = z.object({
  name: z.string({ error: "이름을 입력해주세요." }).trim()
    .min(2, "이름은 2자 이상 입력해주세요.").max(100, "이름은 100자 이하로 입력해주세요."),
  company: z.string().trim().max(200, "회사명은 200자 이하로 입력해주세요.").optional(),
  phone: z.string({ error: "연락처를 입력해주세요." }).trim()
    .min(7, "연락처는 7자 이상 입력해주세요.").max(40, "연락처는 40자 이하로 입력해주세요."),
});

export const passwordUpdateSchema = z.object({
  newPassword: newPasswordSchema,
  confirmPassword: newPasswordSchema,
}).refine((data) => data.newPassword === data.confirmPassword, {
  path: ["confirmPassword"],
  message: "비밀번호가 일치하지 않습니다.",
});

export const resetEmailSchema = emailSchema;

export function toFieldErrors(errors: Record<string, string[] | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(errors)
    .filter((entry): entry is [string, string[]] => Boolean(entry[1]?.length))
    .map(([key, messages]) => [key, messages[0]]));
}
