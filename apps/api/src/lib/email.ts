import * as brevo from "@getbrevo/brevo";
import { env } from "../config/env.js";

/**
 * Transactional email via Brevo. Both senders throw on API failure so the
 * caller can decide whether to surface it (verification resend / registration)
 * or swallow it to avoid leaking account existence (password reset).
 *
 * Email clients strip <style> tags and don't load external CSS, so every style
 * here is inline. Fraunces won't render in most clients either — we fall back
 * to a serif stack for display text and a sans stack for body text, matching
 * the brand intent without depending on web fonts.
 */

// Brand tokens, mirrored from apps/web/src/app/globals.css.
const INK = "#0e1f33";
const SIGNAL = "#2d5bff";
const PAPER = "#f6f4ef";

const SERIF = "Georgia, 'Times New Roman', serif";
const SANS =
  "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

const api = new brevo.TransactionalEmailsApi();
api.setApiKey(brevo.TransactionalEmailsApiApiKeys.apiKey, env.BREVO_API_KEY);

/** Shared shell: keystone wordmark, a heading, body copy, and a CTA button. */
function renderEmail(opts: {
  heading: string;
  greeting: string;
  body: string;
  buttonLabel: string;
  buttonUrl: string;
  footnote: string;
}): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background-color:${PAPER};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${PAPER};padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="width:480px;max-width:480px;background-color:#ffffff;border:1px solid rgba(14,31,51,0.08);border-radius:12px;">
            <tr>
              <td style="padding:32px 36px;">
                <div style="font-family:${SERIF};font-size:22px;font-weight:600;color:${INK};letter-spacing:-0.01em;">
                  <span style="color:${SIGNAL};">◆</span>&nbsp;Alkeyya
                </div>
                <h1 style="margin:28px 0 0;font-family:${SERIF};font-size:24px;line-height:1.25;font-weight:600;color:${INK};">
                  ${opts.heading}
                </h1>
                <p style="margin:16px 0 0;font-family:${SANS};font-size:15px;line-height:1.6;color:${INK};">
                  ${opts.greeting}
                </p>
                <p style="margin:12px 0 0;font-family:${SANS};font-size:15px;line-height:1.6;color:${INK};">
                  ${opts.body}
                </p>
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 0;">
                  <tr>
                    <td style="border-radius:8px;background-color:${SIGNAL};">
                      <a href="${opts.buttonUrl}" style="display:inline-block;padding:12px 24px;font-family:${SANS};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">
                        ${opts.buttonLabel}
                      </a>
                    </td>
                  </tr>
                </table>
                <p style="margin:28px 0 0;font-family:${SANS};font-size:13px;line-height:1.6;color:#5a6675;">
                  ${opts.footnote}
                </p>
                <p style="margin:12px 0 0;font-family:${SANS};font-size:12px;line-height:1.6;color:#5a6675;word-break:break-all;">
                  Or paste this link into your browser:<br />
                  <a href="${opts.buttonUrl}" style="color:${SIGNAL};">${opts.buttonUrl}</a>
                </p>
              </td>
            </tr>
          </table>
          <p style="margin:20px 0 0;font-family:${SANS};font-size:12px;color:#5a6675;">
            Alkeyya AI · This is an automated message.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

async function send(to: string, subject: string, htmlContent: string): Promise<void> {
  const message = new brevo.SendSmtpEmail();
  message.subject = subject;
  message.htmlContent = htmlContent;
  message.sender = { email: env.BREVO_SENDER_EMAIL, name: env.BREVO_SENDER_NAME };
  message.to = [{ email: to }];
  // Throws on non-2xx; caller decides how to handle.
  await api.sendTransacEmail(message);
}

export async function sendVerificationEmail(
  to: string,
  firstName: string | null,
  token: string
): Promise<void> {
  const url = `${env.APP_URL}/verify-email?token=${encodeURIComponent(token)}`;
  const greeting = firstName ? `Hi ${firstName},` : "Hi there,";
  await send(
    to,
    "Verify your Alkeyya account",
    renderEmail({
      heading: "Confirm your email",
      greeting,
      body: "Thanks for creating an Alkeyya account. Confirm your email address to activate it and sign in.",
      buttonLabel: "Verify email",
      buttonUrl: url,
      footnote: "This link expires in 24 hours. If you didn't create an account, you can safely ignore this email.",
    })
  );
}

export async function sendPasswordResetEmail(
  to: string,
  firstName: string | null,
  token: string
): Promise<void> {
  const url = `${env.APP_URL}/reset-password?token=${encodeURIComponent(token)}`;
  const greeting = firstName ? `Hi ${firstName},` : "Hi there,";
  await send(
    to,
    "Reset your Alkeyya password",
    renderEmail({
      heading: "Reset your password",
      greeting,
      body: "We received a request to reset your Alkeyya password. Choose a new one using the button below.",
      buttonLabel: "Reset password",
      buttonUrl: url,
      footnote: "This link expires in 24 hours. If you didn't request a reset, you can safely ignore this email — your password won't change.",
    })
  );
}
