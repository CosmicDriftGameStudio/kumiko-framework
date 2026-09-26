/** wa.me link that opens WhatsApp with `text` prefilled — addressed to
 *  `phone` when given (any formatting; international form required, a
 *  leading "+" or "00" is accepted), otherwise WhatsApp's contact picker. */
export function buildWhatsAppShareUrl(text: string, phone?: string): string {
  const recipient = phone === undefined ? "" : whatsAppRecipientDigits(phone);
  return `https://wa.me/${recipient}?text=${encodeURIComponent(text)}`;
}

function whatsAppRecipientDigits(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.startsWith("00") ? digits.slice(2) : digits;
}
