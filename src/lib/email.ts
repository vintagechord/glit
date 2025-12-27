type WelcomeEmailPayload = {
  email: string;
  name?: string;
};

export async function sendWelcomeEmail(payload: WelcomeEmailPayload) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;

  if (!apiKey || !from) {
    return { ok: false, skipped: true } as const;
  }

  const name = payload.name?.trim() || "Onside";
  const body = {
    from,
    to: payload.email,
    subject: "Welcome to Onside",
    html: `<p>Hi ${name},</p><p>Thanks for signing up to Onside.</p><p>We'll keep you posted on your reviews.</p>`,
  };

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      return { ok: false, skipped: false } as const;
    }

    return { ok: true } as const;
  } catch {
    return { ok: false, skipped: false } as const;
  }
}
