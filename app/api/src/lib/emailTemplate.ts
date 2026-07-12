import { createHmac } from "crypto";

export function generateUnsubscribeToken(messageId: string): string {
  return createHmac("sha256", process.env.WEBHOOK_SECRET!)
    .update(messageId)
    .digest("hex");
}

export function generateOpenTrackingPixelUrl(messageId: string): string | null {
  const appUrl = process.env.APP_URL;
  if (!appUrl || !messageId || !process.env.WEBHOOK_SECRET) return null;
  const token = createHmac("sha256", process.env.WEBHOOK_SECRET)
    .update(`open:${messageId}`)
    .digest("hex");
  return `${appUrl}/webhook/track/open/${token}?mid=${encodeURIComponent(messageId)}`;
}


export function buildListUnsubscribeHeaders(
  messageId: string
): Record<string, string> | null {
  const appUrl = process.env.APP_URL;
  if (!appUrl || !messageId) return null;

  const token = generateUnsubscribeToken(messageId);
  const url = `${appUrl}/webhook/unsubscribe/${token}?mid=${encodeURIComponent(messageId)}`;

  return {
    "List-Unsubscribe": `<${url}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

export interface BrandConfig {
  companyName: string;
  website?: string | null;
  tagline?: string | null;
  logoUrl?: string | null;
  primaryColour: string;
  secondaryColour: string;
  accentColour?: string | null;
  textColour: string;
  backgroundColour: string;
  fontFamily: string;
  senderName: string;
  senderTitle?: string | null;
  senderPhone?: string | null;
  companyAddress?: string | null;
  unsubscribeText: string;
  facebookUrl?: string | null;
  linkedinUrl?: string | null;
  twitterUrl?: string | null;
}

export interface EmailContent {
  subject: string;
  greeting: string;
  opening: string;
  body: string;
  ctaText: string;
  ctaUrl?: string;
  closing: string;
  messageId?: string;
}

export type TemplateStyle = "BRANDED" | "PLAIN";

export const DEFAULT_BRAND: BrandConfig = {
  companyName: "Your Company",
  primaryColour: "#1a1a2e",
  secondaryColour: "#e94560",
  textColour: "#333333",
  backgroundColour: "#ffffff",
  fontFamily: "Arial, sans-serif",
  senderName: "The Team",
  unsubscribeText:
    "To unsubscribe from future emails, click the unsubscribe link below.",
};


function lightenHex(hex: string, ratio: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const lr = Math.round(r + (255 - r) * ratio);
  const lg = Math.round(g + (255 - g) * ratio);
  const lb = Math.round(b + (255 - b) * ratio);
  return `#${lr.toString(16).padStart(2, "0")}${lg.toString(16).padStart(2, "0")}${lb.toString(16).padStart(2, "0")}`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function nl2br(str: string): string {
  return escapeHtml(str).replace(/\n/g, "<br>");
}

function buildHeader(brand: BrandConfig): string {
  const bgColour = brand.primaryColour;

  return `
  <!-- Header -->
  <tr>
    <td align="center" style="background-color:${bgColour};padding:28px 40px 24px">
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td align="${brand.logoUrl ? "left" : "center"}" valign="middle">
            ${brand.logoUrl
      ? `<img src="${brand.logoUrl}" alt="${escapeHtml(brand.companyName)}" height="40" style="display:block;max-height:40px;max-width:200px"/>`
      : `<span style="font-family:${brand.fontFamily};font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.5px">${escapeHtml(brand.companyName)}</span>`
    }
          </td>
          ${brand.tagline
      ? `<td align="right" valign="middle" style="font-family:${brand.fontFamily};font-size:12px;color:rgba(255,255,255,0.65);font-style:italic">${escapeHtml(brand.tagline)}</td>`
      : ""
    }
        </tr>
      </table>
    </td>
  </tr>
  <!-- Header accent bar -->
  <tr>
    <td style="background-color:${brand.secondaryColour};height:3px;font-size:0;line-height:0">&nbsp;</td>
  </tr>`;
}

function buildBody(brand: BrandConfig, content: EmailContent): string {
  const ctaUrl = content.ctaUrl ?? brand.website ?? "#";
  const accentColour = brand.accentColour ?? brand.secondaryColour;

  return `
  <!-- Body -->
  <tr>
    <td style="background-color:${brand.backgroundColour};padding:40px 40px 32px">

      <!-- Greeting -->
      <p style="font-family:${brand.fontFamily};font-size:16px;color:${brand.textColour};margin:0 0 20px;line-height:1.6">
        ${nl2br(content.greeting)}
      </p>

      <!-- Opening hook -->
      <p style="font-family:${brand.fontFamily};font-size:16px;color:${brand.textColour};margin:0 0 16px;line-height:1.6;font-weight:500">
        ${nl2br(content.opening)}
      </p>

      <!-- Main body -->
      <p style="font-family:${brand.fontFamily};font-size:15px;color:${brand.textColour};margin:0 0 28px;line-height:1.75;opacity:0.9">
        ${nl2br(content.body)}
      </p>

      <!-- CTA Button -->
      <!--[if mso]>
      <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"
        href="${ctaUrl}" style="height:44px;v-text-anchor:middle;width:180px;" arcsize="10%"
        strokecolor="${accentColour}" fillcolor="${accentColour}">
        <w:anchorlock/>
        <center style="color:#ffffff;font-family:${brand.fontFamily};font-size:15px;font-weight:bold">${escapeHtml(content.ctaText)}</center>
      </v:roundrect>
      <![endif]-->
      <!--[if !mso]><!-->
      <table cellpadding="0" cellspacing="0" border="0" style="margin:0 0 28px">
        <tr>
          <td align="center" style="border-radius:6px;background-color:${accentColour}">
            <a href="${ctaUrl}" target="_blank"
              style="display:inline-block;font-family:${brand.fontFamily};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;padding:13px 28px;border-radius:6px;letter-spacing:0.3px">
              ${escapeHtml(content.ctaText)} &rarr;
            </a>
          </td>
        </tr>
      </table>
      <!--<![endif]-->

      <!-- Closing -->
      <p style="font-family:${brand.fontFamily};font-size:15px;color:${brand.textColour};margin:0 0 24px;line-height:1.6">
        ${nl2br(content.closing)}
      </p>

      <!-- Divider -->
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px">
        <tr>
          <td style="border-top:1px solid #e8e8e8;font-size:0;line-height:0">&nbsp;</td>
        </tr>
      </table>

      <!-- Signature -->
      <table cellpadding="0" cellspacing="0" border="0">
        <tr>
          ${brand.logoUrl
      ? `<td valign="top" style="padding-right:16px">
                  <img src="${brand.logoUrl}" alt="" height="36" style="display:block;max-height:36px;border-radius:4px"/>
                </td>`
      : ""
    }
          <td valign="top">
            <p style="font-family:${brand.fontFamily};font-size:15px;font-weight:600;color:${brand.primaryColour};margin:0 0 3px">${escapeHtml(brand.senderName)}</p>
            ${brand.senderTitle ? `<p style="font-family:${brand.fontFamily};font-size:13px;color:#777777;margin:0 0 3px">${escapeHtml(brand.senderTitle)}</p>` : ""}
            <p style="font-family:${brand.fontFamily};font-size:13px;color:${accentColour};margin:0 0 3px;font-weight:500">${escapeHtml(brand.companyName)}</p>
            ${brand.website ? `<a href="${brand.website}" style="font-family:${brand.fontFamily};font-size:12px;color:#999999;text-decoration:none">${brand.website.replace(/^https?:\/\//, "")}</a>` : ""}
            ${brand.senderPhone ? `<p style="font-family:${brand.fontFamily};font-size:12px;color:#999999;margin:3px 0 0">${escapeHtml(brand.senderPhone)}</p>` : ""}
          </td>
        </tr>
      </table>

    </td>
  </tr>`;
}

function buildFooter(brand: BrandConfig, content: EmailContent): string {
  const hasSocial = brand.linkedinUrl || brand.facebookUrl || brand.twitterUrl;
  const canGenerateLink = Boolean(content.messageId && process.env.APP_URL);


  const unsubscribeUrl = canGenerateLink
    ? `${process.env.APP_URL}/webhook/unsubscribe/${generateUnsubscribeToken(content.messageId!)}?mid=${encodeURIComponent(content.messageId!)}`
    : null;

  const unsubscribeBlock = unsubscribeUrl
    ? `<p style="font-family:${brand.fontFamily};font-size:11px;color:#bbbbbb;margin:0;text-align:center;line-height:1.5">
        <a href="${unsubscribeUrl}" style="color:#bbbbbb">
          ${escapeHtml(brand.unsubscribeText)}
        </a>
      </p>`
    : `<p style="font-family:${brand.fontFamily};font-size:11px;color:#bbbbbb;margin:0;text-align:center;line-height:1.5">
        ${escapeHtml(brand.unsubscribeText)}
      </p>`;

  return `
  <!-- Footer accent bar -->
  <tr>
    <td style="background-color:${brand.secondaryColour};height:2px;font-size:0;line-height:0">&nbsp;</td>
  </tr>
  <!-- Footer -->
  <tr>
    <td style="background-color:${lightenHex(brand.primaryColour, 0.92)};padding:20px 40px 24px">

      ${hasSocial
      ? `<p style="font-family:${brand.fontFamily};font-size:12px;color:#888888;margin:0 0 10px;text-align:center">
              ${brand.linkedinUrl ? `<a href="${brand.linkedinUrl}" style="color:#888888;text-decoration:none;margin:0 6px">LinkedIn</a>` : ""}
              ${brand.facebookUrl ? `<a href="${brand.facebookUrl}" style="color:#888888;text-decoration:none;margin:0 6px">Facebook</a>` : ""}
              ${brand.twitterUrl ? `<a href="${brand.twitterUrl}" style="color:#888888;text-decoration:none;margin:0 6px">Twitter</a>` : ""}
            </p>`
      : ""
    }

      ${brand.companyAddress ? `<p style="font-family:${brand.fontFamily};font-size:11px;color:#aaaaaa;margin:0 0 8px;text-align:center;line-height:1.5">${escapeHtml(brand.companyAddress)}</p>` : ""}

      ${unsubscribeBlock}

      <p style="font-family:${brand.fontFamily};font-size:10px;color:#cccccc;margin:8px 0 0;text-align:center">
        &copy; ${new Date().getFullYear()} ${escapeHtml(brand.companyName)}
        ${brand.website ? `&nbsp;&middot;&nbsp;<a href="${brand.website}" style="color:#cccccc;text-decoration:none">${brand.website.replace(/^https?:\/\//, "")}</a>` : ""}
      </p>

    </td>
  </tr>`;
}

const UNSUBSCRIBE_PATTERN = /\n?(?:---+\s*)?\n?(?:To unsubscribe[^\n]*\n?(?:https?:\/\/\S+)?|Reply\s+['"]?unsubscribe['"]?[^\n]*)\n?/gi;

function stripEmbeddedUnsubscribe(text: string): string {
  return text.replace(UNSUBSCRIBE_PATTERN, "").trim();
}

function buildPlainHtml(brand: BrandConfig, content: EmailContent): string {
  const canGenerateLink = Boolean(content.messageId && process.env.APP_URL);
  const unsubscribeUrl = canGenerateLink
    ? `${process.env.APP_URL}/webhook/unsubscribe/${generateUnsubscribeToken(content.messageId!)}?mid=${encodeURIComponent(content.messageId!)}`
    : null;

  const cleanBody = stripEmbeddedUnsubscribe(content.body);
  const cleanClosing = stripEmbeddedUnsubscribe(content.closing);

  const paragraphs = [
    content.greeting ? `<p style="font-family:Arial,sans-serif;font-size:15px;color:#333333;margin:0 0 16px;line-height:1.6">${nl2br(content.greeting)}</p>` : "",
    content.opening ? `<p style="font-family:Arial,sans-serif;font-size:15px;color:#333333;margin:0 0 16px;line-height:1.6">${nl2br(content.opening)}</p>` : "",
    cleanBody ? `<p style="font-family:Arial,sans-serif;font-size:15px;color:#333333;margin:0 0 16px;line-height:1.75">${nl2br(cleanBody)}</p>` : "",
    content.ctaText ? `<p style="font-family:Arial,sans-serif;font-size:15px;color:#333333;margin:0 0 16px;line-height:1.6">${escapeHtml(content.ctaText)}</p>` : "",
    cleanClosing ? `<p style="font-family:Arial,sans-serif;font-size:15px;color:#333333;margin:0 0 16px;line-height:1.6">${nl2br(cleanClosing)}</p>` : "",
    `<p style="font-family:Arial,sans-serif;font-size:15px;color:#333333;margin:0 0 24px;line-height:1.6">${escapeHtml(brand.senderName)}</p>`,
  ].filter(Boolean).join("\n");

  const unsubscribeBlock = unsubscribeUrl
    ? `<p style="font-family:Arial,sans-serif;font-size:11px;color:#aaaaaa;margin:24px 0 0;line-height:1.5"><a href="${unsubscribeUrl}" style="color:#aaaaaa">Unsubscribe</a></p>`
    : `<p style="font-family:Arial,sans-serif;font-size:11px;color:#aaaaaa;margin:24px 0 0;line-height:1.5">To unsubscribe, reply to this email.</p>`;

  const pixelUrl = content.messageId ? generateOpenTrackingPixelUrl(content.messageId) : null;
  const pixelTag = pixelUrl
    ? `<img src="${pixelUrl}" width="1" height="1" border="0" alt="" style="display:block;width:1px;height:1px;border:0" />`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(content.subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#ffffff">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="padding:24px 16px">
    <tr>
      <td align="left">
        <table class="email-container" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%">
          <tr>
            <td style="padding:0">
              ${paragraphs}
              ${unsubscribeBlock}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
  ${pixelTag}
</body>
</html>`;
}

function buildPlainText(brand: BrandConfig, content: EmailContent): string {
  const cleanBody = stripEmbeddedUnsubscribe(content.body);
  const cleanClosing = stripEmbeddedUnsubscribe(content.closing);

  const unsubscribeUrl =
    content.messageId && process.env.APP_URL
      ? `${process.env.APP_URL}/webhook/unsubscribe/${generateUnsubscribeToken(content.messageId)}?mid=${encodeURIComponent(content.messageId)}`
      : null;

  return [
    content.greeting,
    "",
    content.opening,
    "",
    cleanBody,
    "",
    content.ctaText,
    "",
    cleanClosing,
    "",
    brand.senderName,
    "",
    ...(unsubscribeUrl ? ["Unsubscribe: " + unsubscribeUrl] : []),
  ]
    .filter((line) => line !== null)
    .join("\n");
}

export function renderEmailTemplate(
  brand: BrandConfig,
  content: EmailContent,
  options?: { style?: TemplateStyle },
): { html: string; text: string } {
  const style = options?.style ?? "BRANDED";

  if (style === "PLAIN") {
    return {
      html: buildPlainHtml(brand, content),
      text: buildPlainText(brand, content),
    };
  }

  const pixelUrl = content.messageId ? generateOpenTrackingPixelUrl(content.messageId) : null;
  const pixelTag = pixelUrl
    ? `<img src="${pixelUrl}" width="1" height="1" border="0" alt="" style="display:block;width:1px;height:1px;border:0" />`
    : "";

  const html = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="x-apple-disable-message-reformatting">
  <title>${escapeHtml(content.subject)}</title>
  <!--[if mso]>
  <noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
  <![endif]-->
  <style>
    body, table, td, p, a { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
    table, td { mso-table-lspace:0pt; mso-table-rspace:0pt; }
    img { -ms-interpolation-mode:bicubic; border:0; height:auto; outline:none; text-decoration:none; }
    @media screen and (max-width:600px) {
      .email-container { width:100% !important; }
      .mobile-padding { padding-left:20px !important; padding-right:20px !important; }
      .mobile-font { font-size:14px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f7;word-spacing:normal">

  <!-- Preview text (hidden — shows in inbox snippet) -->
  <div style="display:none;font-size:1px;color:#f4f4f7;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden">
    ${escapeHtml(content.opening.slice(0, 120))}
  </div>

  <!-- Email wrapper -->
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f4f7;padding:32px 16px">
    <tr>
      <td align="center">

        <!-- Email container — max 600px -->
        <table class="email-container" width="600" cellpadding="0" cellspacing="0" border="0"
          style="max-width:600px;width:100%;border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08)">

          ${buildHeader(brand)}
          ${buildBody(brand, content)}
          ${buildFooter(brand, content)}

        </table>

      </td>
    </tr>
  </table>

  ${pixelTag}

</body>
</html>`;

  const unsubscribeUrl =
    content.messageId && process.env.APP_URL
      ? `${process.env.APP_URL}/webhook/unsubscribe/${generateUnsubscribeToken(content.messageId)}?mid=${encodeURIComponent(content.messageId)}`
      : null;

  const text = [
    content.greeting,
    "",
    content.opening,
    "",
    content.body,
    "",
    content.ctaText + (content.ctaUrl ? `: ${content.ctaUrl}` : ""),
    "",
    content.closing,
    "",
    "—",
    brand.senderName,
    brand.senderTitle ?? "",
    brand.companyName,
    brand.website ?? "",
    brand.senderPhone ?? "",
    "",
    brand.unsubscribeText,
    ...(unsubscribeUrl ? [unsubscribeUrl] : []),
  ]
    .filter((line) => line !== null)
    .join("\n");

  return { html, text };
}