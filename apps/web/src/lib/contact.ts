export const WHATSAPP_URL = "https://wa.me/962786012133";
export const WHATSAPP_NUMBER = "+962 7 8601 2133";
export function whatsappInquiryUrl(message: string) {
  return `${WHATSAPP_URL}?text=${encodeURIComponent(message)}`;
}
