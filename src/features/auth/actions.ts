"use server";

import { z } from "zod";
import { redirect } from "next/navigation";

import {
  sendPasswordResetEmail,
  sendWelcomeEmail,
} from "@/lib/email";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";

export type ActionState = {
  error?: string;
  message?: string;
  fieldErrors?: Record<string, string>;
};

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

const signupSchema = z.object({
  name: z.string().trim().optional(),
  company: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  email: z.string().email(),
  password: z.string().min(8),
  confirmPassword: z.string().min(8),
  agreeTerms: z.literal("on"),
  agreePrivacy: z.literal("on"),
}).refine((data) => data.password === data.confirmPassword, {
  path: ["confirmPassword"],
  message: "비밀번호가 일치하지 않습니다.",
});

const profileSchema = z.object({
  name: z.string().min(2),
  company: z.string().optional(),
  phone: z.string().min(7),
});

function toFieldErrors(
  errors: Record<string, string[] | undefined>,
): Record<string, string> {
  const entries = Object.entries(errors)
    .map(([key, value]) => [key, value?.[0]])
    .filter(([, value]) => Boolean(value));
  return Object.fromEntries(entries) as Record<string, string>;
}

export async function loginAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return {
      fieldErrors: toFieldErrors(parsed.error.flatten().fieldErrors),
    };
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    const message =
      error.message?.toLowerCase().includes("email not confirmed") ||
      error.message?.toLowerCase().includes("email confirmation")
        ? "이메일 인증 후 로그인해 주세요. 인증 메일을 다시 받으려면 비밀번호 재설정으로 진행하면 새 링크를 받을 수 있습니다."
        : "로그인 정보를 확인해주세요.";
    return { error: message };
  }

  redirect("/dashboard");
}

export async function signupAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = signupSchema.safeParse({
    name: (formData.get("name") || "").toString().trim() || undefined,
    company: (formData.get("company") || "").toString().trim() || undefined,
    phone: (formData.get("phone") || "").toString().trim() || undefined,
    email: formData.get("email"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
    agreeTerms: formData.get("agreeTerms"),
    agreePrivacy: formData.get("agreePrivacy"),
  });

  if (!parsed.success) {
    return {
      fieldErrors: toFieldErrors(parsed.error.flatten().fieldErrors),
    };
  }

  try {
    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.createUser({
      email: parsed.data.email,
      password: parsed.data.password,
      email_confirm: true,
      user_metadata: {
        name: parsed.data.name ?? "",
        company: parsed.data.company ?? "",
        phone: parsed.data.phone ?? "",
      },
    });

    if (error || !data.user) {
      return { error: "회원가입을 완료할 수 없습니다." };
    }

    const emailResult = await sendWelcomeEmail({
      email: parsed.data.email,
      name: parsed.data.name,
    });

    if (!emailResult.ok && !emailResult.skipped) {
      console.warn("Welcome email failed", emailResult);
    }

    return {
      message: "회원가입이 완료되었습니다. 로그인해 주세요.",
    };
  } catch (error) {
    console.error("Signup error", error);
    return { error: "회원가입을 완료할 수 없습니다." };
  }
}

export async function resetPasswordAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = String(formData.get("resetEmail") || "").trim();
  if (!email) {
    return { fieldErrors: { resetEmail: "이메일을 입력해주세요." } };
  }
  const parsed = z.string().email().safeParse(email);
  if (!parsed.success) {
    return { fieldErrors: { resetEmail: "유효한 이메일을 입력해주세요." } };
  }

  try {
    const redirectTo = `${
      process.env.NEXT_PUBLIC_APP_URL ??
      "https://glit-b1yn.onrender.com"
    }/reset-password`;
    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.generateLink({
      type: "recovery",
      email: parsed.data,
      options: { redirectTo },
    });
    if (error) {
      console.error("generateLink error", error);
      return {
        error:
          error.message ??
          "비밀번호 재설정 메일을 보낼 수 없습니다. 잠시 후 다시 시도해주세요.",
      };
    }

    const linkData = data as
      | { action_link?: string | null; properties?: { action_link?: string | null } }
      | null;
    const actionLink =
      linkData?.action_link ?? linkData?.properties?.action_link ?? null;
    if (!actionLink) {
      return {
        error: "비밀번호 재설정 링크를 생성하지 못했습니다. 잠시 후 다시 시도해주세요.",
      };
    }

    const emailResult = await sendPasswordResetEmail({
      email: parsed.data,
      link: actionLink,
    });

    if (!emailResult.ok) {
      const supabase = await createServerSupabase();
      const { error: fallbackError } =
        await supabase.auth.resetPasswordForEmail(parsed.data, {
          redirectTo,
        });
      if (fallbackError) {
        console.error("resetPasswordForEmail fallback error", fallbackError);
        return {
          error:
            fallbackError.message ??
            "비밀번호 재설정 메일을 보낼 수 없습니다. 잠시 후 다시 시도해주세요.",
        };
      }
    }

    return {
      message: "비밀번호 재설정 메일을 보냈습니다. 메일함을 확인해주세요.",
    };
  } catch (error) {
    console.error("resetPasswordAction error", error);
    return { error: "비밀번호 재설정 요청 중 오류가 발생했습니다." };
  }
}

export async function updateProfileAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = profileSchema.safeParse({
    name: formData.get("name"),
    company: formData.get("company") || undefined,
    phone: formData.get("phone"),
  });

  if (!parsed.success) {
    return {
      fieldErrors: toFieldErrors(parsed.error.flatten().fieldErrors),
    };
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { error: "로그인이 필요합니다." };
  }

  const { error } = await supabase.from("profiles").upsert(
    {
      user_id: user.id,
      name: parsed.data.name,
      company: parsed.data.company ?? "",
      phone: parsed.data.phone,
    },
    { onConflict: "user_id" },
  );

  if (error) {
    return { error: "프로필 저장에 실패했습니다." };
  }

  return { message: "프로필이 저장되었습니다." };
}

export async function signOutAction() {
  const supabase = await createServerSupabase();
  await supabase.auth.signOut();
  redirect("/");
}
