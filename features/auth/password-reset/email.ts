// The password-reset email (D65). Pure (no server-only marker), so it is unit-tested and shown on
// the gate-protected preview page (/dev/email-preview/password-reset).
//
// Hebrew, right to left, a table layout that email clients render, inline styles only, and the MODY
// brand from the design tokens (app/globals.css: --ink header, --accent button, --on-dark2 subtitle,
// --muted text, --bg page, --line border). No remote image, font or stylesheet: every app address
// sits behind Vercel Authentication during testing (D29, D31), and a remote image would also tell
// a sender when the email was opened. The wordmark is text. Every interpolated value is
// HTML-escaped, and only an http(s) link is accepted.

export type PasswordResetEmail = { subject: string; html: string; text: string };

export const PASSWORD_RESET_EMAIL_SUBJECT = "איפוס סיסמה — MODY ניהול טכנאים";

/** Design tokens (app/globals.css), as literal colours: email clients do not support custom properties. */
const COLOR = {
  ink: "#18212B",
  accent: "#155E75",
  onDark: "#FFFFFF",
  onDark2: "#AEB8C4",
  muted: "#5E6A78",
  soft: "#8A9AAB",
  bg: "#F2F4F6",
  line: "#DDE3E9",
  line2: "#EEF1F4",
  card: "#FFFFFF",
} as const;

/** The app's Hebrew body font first (Assistant, when the reader has it), then common system fonts. */
const FONT = "Assistant, 'Segoe UI', Arial, Helvetica, sans-serif";

const HTML_ESCAPES: Readonly<Record<string, string>> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Escapes a value for HTML text and double- or single-quoted attributes. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

/** The link, normalised, or an error: an absolute http(s) URL without credentials or control characters. */
function checkedLink(link: string): string {
  if (typeof link !== "string" || link.length > 2048 || /[\s\u0000-\u001f\u007f]/.test(link)) throw new Error("password reset email: invalid link");
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    throw new Error("password reset email: invalid link");
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username !== "" || url.password !== "") {
    throw new Error("password reset email: invalid link");
  }
  return url.href;
}

/** "לשעה" for 60 minutes, else "ל-N דקות" (a whole number of minutes, at least one). */
function validityOf(minutes: number): string {
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 24 * 60) throw new Error("password reset email: invalid expiry");
  return minutes === 60 ? "לשעה" : `ל-${minutes} דקות`;
}

export function passwordResetEmail({ link, expiresMinutes }: { link: string; expiresMinutes: number }): PasswordResetEmail {
  const href = checkedLink(link);
  const validity = `הקישור תקף ${validityOf(expiresMinutes)} ולשימוש אחד.`;
  const intro = "קיבלנו בקשה לאיפוס הסיסמה של החשבון שלכם במערכת MODY ניהול טכנאים. לבחירת סיסמה חדשה לחצו על הכפתור:";
  const ignore = "אם לא ביקשתם לאפס סיסמה, אפשר להתעלם מהמייל הזה. הסיסמה הנוכחית לא תשתנה.";
  const fallback = "אם הכפתור לא עובד, העתיקו את הקישור הזה לדפדפן:";
  const footer = "MODY · ניהול טכנאים · הודעה אוטומטית, אין להשיב למייל הזה";
  const subject = PASSWORD_RESET_EMAIL_SUBJECT;
  const e = escapeHtml;
  const h = e(href);

  const text = [
    "MODY · ניהול טכנאים",
    "",
    "איפוס סיסמה",
    "",
    "קיבלנו בקשה לאיפוס הסיסמה של החשבון שלכם במערכת MODY ניהול טכנאים. לבחירת סיסמה חדשה פתחו את הקישור:",
    href,
    "",
    validity,
    "",
    ignore,
    "",
    "—",
    footer,
    "",
  ].join("\n");

  const html = `<!doctype html>
<html dir="rtl" lang="he">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${e(subject)}</title>
</head>
<body dir="rtl" style="margin:0;padding:0;background:${COLOR.bg};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${e(`בחירת סיסמה חדשה לחשבון שלכם. ${validity}`)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COLOR.bg};">
<tr>
<td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:${COLOR.card};border:1px solid ${COLOR.line};border-radius:12px;border-collapse:separate;overflow:hidden;">
<tr>
<td align="center" style="background:${COLOR.ink};padding:24px 20px;border-radius:12px 12px 0 0;">
<div dir="ltr" style="font-family:${FONT};font-size:28px;line-height:1.2;font-weight:700;letter-spacing:4px;color:${COLOR.onDark};">MODY</div>
<div style="font-family:${FONT};font-size:14px;line-height:1.5;color:${COLOR.onDark2};margin-top:6px;">ניהול טכנאים</div>
</td>
</tr>
<tr>
<td dir="rtl" align="right" style="padding:28px 24px 8px;font-family:${FONT};color:${COLOR.ink};text-align:right;">
<h1 style="margin:0 0 12px;font-family:${FONT};font-size:22px;line-height:1.3;font-weight:700;color:${COLOR.ink};">איפוס סיסמה</h1>
<p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:${COLOR.ink};">${e(intro)}</p>
</td>
</tr>
<tr>
<td align="center" style="padding:0 24px 24px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0">
<tr>
<td align="center" bgcolor="${COLOR.accent}" style="background:${COLOR.accent};border-radius:8px;">
<a href="${h}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:12px 28px;font-family:${FONT};font-size:16px;line-height:1.4;font-weight:700;color:${COLOR.onDark};text-decoration:none;border-radius:8px;">בחירת סיסמה חדשה</a>
</td>
</tr>
</table>
</td>
</tr>
<tr>
<td dir="rtl" align="right" style="padding:0 24px 20px;font-family:${FONT};text-align:right;">
<p style="margin:0 0 16px;font-size:14px;line-height:1.6;font-weight:700;color:${COLOR.ink};">${e(validity)}</p>
<p style="margin:0 0 6px;font-size:14px;line-height:1.6;color:${COLOR.muted};">${e(fallback)}</p>
<p dir="ltr" style="margin:0 0 16px;font-size:13px;line-height:1.5;text-align:left;word-break:break-all;overflow-wrap:anywhere;"><a href="${h}" target="_blank" rel="noopener noreferrer" style="color:${COLOR.accent};text-decoration:underline;">${h}</a></p>
<p style="margin:0;font-size:14px;line-height:1.6;color:${COLOR.muted};">${e(ignore)}</p>
</td>
</tr>
<tr>
<td align="center" style="border-top:1px solid ${COLOR.line2};padding:16px 24px;font-family:${FONT};font-size:12px;line-height:1.5;color:${COLOR.soft};text-align:center;">${e(footer)}</td>
</tr>
</table>
</td>
</tr>
</table>
</body>
</html>
`;
  return { subject, html, text };
}
