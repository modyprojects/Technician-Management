// Links that leave the app from the technician screens (TE-02, TE-03, TE-07): a Waze deep link to an
// address, a phone call and a WhatsApp chat. Plain links only: no API, no key, no integration (the
// device opens Waze, the dialler or WhatsApp itself). Pure; every value is built from stored data
// and encoded, never pasted into a URL as is. Anything that does not look like a phone number gets
// no link (null), so a malformed value never becomes a `tel:` or `wa.me` target.

const WAZE = "https://waze.com/ul";

/** "https://waze.com/ul?q=<address>&navigate=yes" (Waze's documented universal link). */
export function wazeHref(address: string): string | null {
  const q = address.trim();
  if (!q) return null;
  return `${WAZE}?q=${encodeURIComponent(q)}&navigate=yes`;
}

/** The digits of a phone number with an optional leading "+", or null (7 to 15 digits). */
function phoneDigits(phone: string): { plus: boolean; digits: string } | null {
  const raw = phone.trim();
  if (!/^\+?[0-9][0-9 ()-]{5,24}$/.test(raw)) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  return { plus: raw.startsWith("+"), digits };
}

/** "tel:+972501234567" / "tel:0501234567". */
export function telHref(phone: string): string | null {
  const p = phoneDigits(phone);
  return p ? `tel:${p.plus ? "+" : ""}${p.digits}` : null;
}

/**
 * "https://wa.me/972501234567": WhatsApp needs the international number without "+" or a leading
 * zero. An Israeli local number ("050-123-4567") becomes 972…; an international one ("+44…") keeps
 * its country code. Anything else: null.
 */
export function whatsappHref(phone: string): string | null {
  const p = phoneDigits(phone);
  if (!p) return null;
  let international: string;
  if (p.plus) international = p.digits;
  else if (p.digits.startsWith("0")) international = `972${p.digits.slice(1)}`;
  else return null;
  return international.length >= 8 ? `https://wa.me/${international}` : null;
}
