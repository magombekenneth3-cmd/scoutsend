import { createHmac, timingSafeEqual } from "crypto";

export function verifyHmacSignature(
  payload: string | Buffer,
  signatureHeader: string,
  secret: string,
  algorithm: string = "sha256"
): boolean {
  if (!signatureHeader || !secret) return false;
  try {
    const computed = createHmac(algorithm, secret)
      .update(payload)
      .digest("hex");
    const cleanHeader = signatureHeader.replace(/^(?:v1=|sha256=)/i, "").trim();
    if (computed.length !== cleanHeader.length) return false;
    return timingSafeEqual(
      Buffer.from(computed, "utf8"),
      Buffer.from(cleanHeader.toLowerCase(), "utf8")
    );
  } catch {
    return false;
  }
}
