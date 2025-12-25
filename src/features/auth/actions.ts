"use server";

import { z } from "zod";
import { redirect } from "next/navigation";

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
  name: z.string().min(2),
  company: z.string().optional(),
  phone: z.string().min(7),
  email: z.string().email(),
  password: z.string().min(8),
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

  const supabase = createServerSupabase();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    return { error: "로그인 정보를 확인해주세요." };
  }

  redirect("/dashboard");
}

export async function signupAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = signupSchema.safeParse({
    name: formData.get("name"),
    company: formData.get("company") || undefined,
    phone: formData.get("phone"),
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return {
      fieldErrors: toFieldErrors(parsed.error.flatten().fieldErrors),
    };
  }

  const supabase = createServerSupabase();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: {
        name: parsed.data.name,
        company: parsed.data.company ?? "",
        phone: parsed.data.phone,
      },
    },
  });

  if (error) {
    return { error: "회원가입을 완료할 수 없습니다." };
  }

  if (!data.session) {
    return { message: "가입 완료! 이메일 확인 후 로그인해주세요." };
  }

  redirect("/dashboard");
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

  const supabase = createServerSupabase();
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
  const supabase = createServerSupabase();
  await supabase.auth.signOut();
  redirect("/");
}
