/**
 * Lightweight outbound mail for admin OTP (and optional notifications).
 * Supports Resend API (RESEND_API_KEY) or SMTP via fetch-compatible providers.
 * If nothing is configured, OTP is logged to the server console (dev fallback).
 */

type SendMailInput = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export function mailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

export async function sendMail(input: SendMailInput): Promise<{ ok: boolean; via: string }> {
  const from =
    process.env.MAIL_FROM?.trim() ||
    process.env.RESEND_FROM?.trim() ||
    "SEOI Support <onboarding@resend.dev>";

  const resendKey = process.env.RESEND_API_KEY?.trim();
  if (resendKey) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject: input.subject,
        text: input.text,
        html: input.html ?? `<pre style="font-family:sans-serif">${escapeHtml(input.text)}</pre>`,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("[mail] Resend failed", res.status, body);
      return { ok: false, via: "resend" };
    }
    return { ok: true, via: "resend" };
  }

  // No provider: log so local/dev still works.
  console.info(
    `[mail:console] to=${input.to} subject=${input.subject}\n${input.text}`,
  );
  return { ok: true, via: "console" };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function sendAdminOtpEmail(email: string, code: string): Promise<{ ok: boolean; via: string }> {
  return sendMail({
    to: email,
    subject: `${code} is your SEOI admin login code`,
    text: `Your admin login code is: ${code}\n\nIt expires in 10 minutes. If you did not try to sign in, ignore this email.`,
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:420px;margin:0 auto;padding:24px">
        <h2 style="margin:0 0 12px;color:#0f172a">Admin login code</h2>
        <p style="color:#475569;margin:0 0 16px">Use this one-time code to finish signing in. It expires in 10 minutes.</p>
        <p style="font-size:28px;letter-spacing:6px;font-weight:700;color:#0f172a;margin:0 0 16px">${code}</p>
        <p style="color:#94a3b8;font-size:13px;margin:0">If you did not request this, you can ignore the email.</p>
      </div>
    `,
  });
}
