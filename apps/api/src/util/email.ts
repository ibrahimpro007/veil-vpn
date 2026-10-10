/**
 * Transactional email via the Resend REST API (plain fetch — no SDK needed).
 * All sends are best-effort: a mail-provider outage must never break
 * registration or password-reset request handling.
 */
import type { Env } from "../env.js";

export interface EmailResult {
  sent: boolean;
  /** Resend's message id, when the send was accepted. */
  id?: string;
}

export async function sendEmail(
  env: Env,
  to: string,
  subject: string,
  html: string,
): Promise<EmailResult> {
  if (!env.RESEND_API_KEY) return { sent: false };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject, html }),
    });
    if (!res.ok) return { sent: false };
    const data = (await res.json().catch(() => ({}))) as { id?: string };
    return { sent: true, id: data.id };
  } catch {
    return { sent: false };
  }
}

const baseStyle = `font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111`;
const btnStyle = `display:inline-block;background:#111;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;margin:16px 0`;

export function verifyEmailHtml(
  appUrl: string,
  token: string,
): { subject: string; html: string } {
  const url = `${appUrl}/verify-email?token=${encodeURIComponent(token)}`;
  return {
    subject: "Verify your VeilVPN email",
    html: `<div style="${baseStyle}">
      <h2>Verify your email</h2>
      <p>Thanks for creating a VeilVPN account. Confirm your email address to activate it:</p>
      <a style="${btnStyle}" href="${url}">Verify email</a>
      <p style="color:#666;font-size:13px">This link expires in 30 minutes and can only be used once.
      If you didn't create this account, you can ignore this email.</p>
    </div>`,
  };
}

export function resetPasswordHtml(
  appUrl: string,
  token: string,
): { subject: string; html: string } {
  const url = `${appUrl}/reset-password?token=${encodeURIComponent(token)}`;
  return {
    subject: "Reset your VeilVPN password",
    html: `<div style="${baseStyle}">
      <h2>Reset your password</h2>
      <p>We received a request to reset the password for your VeilVPN account:</p>
      <a style="${btnStyle}" href="${url}">Set a new password</a>
      <p style="color:#666;font-size:13px">This link expires in 30 minutes and can only be used once.
      If you didn't request this, your password is unchanged — you can ignore this email.</p>
    </div>`,
  };
}
