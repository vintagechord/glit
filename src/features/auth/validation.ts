import { z } from "zod";
import { PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH } from "./policy";

const t = (english: boolean, korean: string, englishText: string) => (english ? englishText : korean);

/** Builds both language variants once; the Korean schema stays the default export shape. */
function localized<T>(build: (english: boolean) => T): (english?: boolean) => T {
  const korean = build(false);
  const englishSchema = build(true);
  return (english = false) => (english ? englishSchema : korean);
}

const emailSchema = (english: boolean) => z.string({ error: t(english, "이메일을 입력해주세요.", "Enter your email address.") })
  .trim().email(t(english, "올바른 이메일 주소를 입력해주세요.", "Enter a valid email address."))
  .max(254, t(english, "이메일은 254자 이하로 입력해주세요.", "Use an email address of 254 characters or fewer."));

const newPasswordSchema = (english: boolean) => z.string({ error: t(english, "비밀번호를 입력해주세요.", "Enter your password.") })
  .min(PASSWORD_MIN_LENGTH, t(english, "비밀번호는 8자 이상 입력해주세요.", "Use a password of at least 8 characters."))
  .max(PASSWORD_MAX_LENGTH, t(english, "비밀번호는 128자 이하로 입력해주세요.", "Use a password of 128 characters or fewer."));

export const getLoginSchema = localized((english) => z.object({
  email: emailSchema(english),
  // Existing accounts may predate today's signup password policy.
  password: z.string({ error: t(english, "비밀번호를 입력해주세요.", "Enter your password.") })
    .min(1, t(english, "비밀번호를 입력해주세요.", "Enter your password."))
    .max(128, t(english, "비밀번호는 128자 이하로 입력해주세요.", "Use a password of 128 characters or fewer.")),
  next: z.string().max(2048, t(english, "이동 경로가 너무 깁니다.", "The destination path is too long.")).optional(),
}));
export const loginSchema = getLoginSchema();

const requiredAgreement = (english: boolean) => z.literal("on", { error: t(english, "필수 항목에 동의해주세요.", "Please accept the required agreements.") });

export const getSignupSchema = localized((english) => z.object({
  name: z.string().trim().max(100, t(english, "이름은 100자 이하로 입력해주세요.", "Use 100 characters or fewer for your name.")).optional(),
  company: z.string().trim().max(200, t(english, "회사명은 200자 이하로 입력해주세요.", "Use 200 characters or fewer for the company name.")).optional(),
  phone: z.string().trim().max(40, t(english, "연락처는 40자 이하로 입력해주세요.", "Use 40 characters or fewer for your phone number.")).optional(),
  email: emailSchema(english),
  password: newPasswordSchema(english),
  confirmPassword: newPasswordSchema(english),
  agreeAge: requiredAgreement(english),
  agreeTerms: requiredAgreement(english),
  agreePrivacy: requiredAgreement(english),
  agreeRefund: requiredAgreement(english),
  agreeMarketing: z.literal("on", { error: t(english, "수신 동의 항목을 확인해주세요.", "Check your communication preferences.") }).optional(),
}).refine((data) => data.password === data.confirmPassword, {
  path: ["confirmPassword"],
  message: t(english, "비밀번호가 일치하지 않습니다.", "The passwords do not match."),
}));
export const signupSchema = getSignupSchema();

export const profileSchema = z.object({
  name: z.string({ error: "이름을 입력해주세요." }).trim()
    .min(2, "이름은 2자 이상 입력해주세요.").max(100, "이름은 100자 이하로 입력해주세요."),
  company: z.string().trim().max(200, "회사명은 200자 이하로 입력해주세요.").optional(),
  phone: z.string({ error: "연락처를 입력해주세요." }).trim()
    .min(7, "연락처는 7자 이상 입력해주세요.").max(40, "연락처는 40자 이하로 입력해주세요."),
  notificationEmail: z.string().trim().toLowerCase().max(254, "이메일은 254자 이하로 입력해주세요.")
    .refine(value => !value || z.string().email().safeParse(value).success, "올바른 안내 수신 이메일을 입력해주세요.").optional(),
});

export const getPasswordUpdateSchema = localized((english) => z.object({
  newPassword: newPasswordSchema(english),
  confirmPassword: newPasswordSchema(english),
}).refine((data) => data.newPassword === data.confirmPassword, {
  path: ["confirmPassword"],
  message: t(english, "비밀번호가 일치하지 않습니다.", "The passwords do not match."),
}));
export const passwordUpdateSchema = getPasswordUpdateSchema();

export const getResetEmailSchema = localized(emailSchema);
export const resetEmailSchema = getResetEmailSchema();

export function toFieldErrors(errors: Record<string, string[] | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(errors)
    .filter((entry): entry is [string, string[]] => Boolean(entry[1]?.length))
    .map(([key, messages]) => [key, messages[0]]));
}
