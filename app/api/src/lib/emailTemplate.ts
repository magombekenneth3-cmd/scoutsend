import {
  buildClickTrackingUrl,
  buildOpenTrackingPixelUrl,
  generateUnsubscribeToken,
  isRedirectableUrl,
} from "./emailTracking";

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

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function nl2br(str: string): string {
  return escapeHtml(str).replace(/\r?\n/g, "<br>");
}

function safeUrl(value?: string | null): string | null {
  if (!value || !isRedirectableUrl(value)) return null;
  return value;
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function safeCssValue(value: string, fallback: string): string {
  if (!value || /[<>"'`;{}]/.test(value)) return fallback;
  return value;
}

function buildUnsubscribeUrl(messageId?: string): string | null {
  const appUrl = safeUrl(process.env.APP_URL);

  if (!appUrl || !messageId) return null;

  const token = generateUnsubscribeToken(messageId);
  const base = normalizeBaseUrl(appUrl);

  return `${base}/webhook/unsubscribe/${encodeURIComponent(
    token
  )}?mid=${encodeURIComponent(messageId)}`;
}

export function buildListUnsubscribeHeaders(
  messageId: string
): Record<string, string> | null {
  const unsubscribeUrl = buildUnsubscribeUrl(messageId);

  if (!unsubscribeUrl) return null;

  return {
    "List-Unsubscribe": `<${unsubscribeUrl}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

function buildHeader(brand: BrandConfig): string {
  const primaryColour = safeCssValue(brand.primaryColour, "#1a1a2e");
  const secondaryColour = safeCssValue(brand.secondaryColour, "#e94560");
  const fontFamily = safeCssValue(brand.fontFamily, "Arial, sans-serif");
  const logoUrl = safeUrl(brand.logoUrl);
  const tagline = brand.tagline;

  return `
  <tr>
    <td align="center" style="background-color:${primaryColour};padding:28px 40px 24px">
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td align="${logoUrl ? "left" : "center"}" valign="middle">
            ${logoUrl
      ? `<img src="${escapeHtml(
        logoUrl
      )}" alt="${escapeHtml(
        brand.companyName
      )}" height="40" style="display:block;max-height:40px;max-width:200px"/>`
      : `<span style="font-family:${fontFamily};font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.5px">${escapeHtml(
        brand.companyName
      )}</span>`
    }
          </td>
          ${tagline
      ? `<td align="right" valign="middle" style="font-family:${fontFamily};font-size:12px;color:rgba(255,255,255,0.65);font-style:italic">${escapeHtml(
        tagline
      )}</td>`
      : ""
    }
        </tr>
      </table>
    </td>
  </tr>
  <tr>
    <td style="background-color:${secondaryColour};height:3px;font-size:0;line-height:0">&nbsp;</td>
  </tr>`;
}

function buildBody(brand: BrandConfig, content: EmailContent): string {
  const websiteUrl = safeUrl(brand.website);
  const ctaUrl = safeUrl(content.ctaUrl);
  const accentColour = safeCssValue(
    brand.accentColour ?? brand.secondaryColour,
    "#e94560"
  );
  const backgroundColour = safeCssValue(
    brand.backgroundColour,
    "#ffffff"
  );
  const textColour = safeCssValue(brand.textColour, "#333333");
  const primaryColour = safeCssValue(brand.primaryColour, "#1a1a2e");
  const fontFamily = safeCssValue(brand.fontFamily, "Arial, sans-serif");
  const logoUrl = safeUrl(brand.logoUrl);

  const bodyParagraphs = content.body
    .split(/\r?\n\r?\n+/)
    .map(
      (paragraph) =>
        `<p style="font-family:${fontFamily};font-size:15px;color:${textColour};margin:0 0 16px;line-height:1.75">${nl2br(
          paragraph.trim()
        )}</p>`
    )
    .join("");

  const ctaBlock = ctaUrl
    ? `
      <!--[if mso]>
      <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"
        href="${escapeHtml(
      ctaUrl
    )}" style="height:44px;v-text-anchor:middle;width:180px;" arcsize="10%"
        strokecolor="${accentColour}" fillcolor="${accentColour}">
        <w:anchorlock/>
        <center style="color:#ffffff;font-family:${fontFamily};font-size:15px;font-weight:bold">${escapeHtml(
      content.ctaText
    )}</center>
      </v:roundrect>
      <![endif]-->
      <!--[if !mso]><!-->
      <table cellpadding="0" cellspacing="0" border="0" style="margin:0 0 28px">
        <tr>
          <td align="center" style="border-radius:6px;background-color:${accentColour}">
            <a href="${escapeHtml(
      ctaUrl
    )}" target="_blank" rel="noopener noreferrer"
              style="display:inline-block;font-family:${fontFamily};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;padding:13px 28px;border-radius:6px;letter-spacing:0.3px">
              ${escapeHtml(content.ctaText)} &rarr;
            </a>
          </td>
        </tr>
      </table>
      <!--<![endif]-->
    `
    : "";

  return `
  <tr>
    <td style="background-color:${backgroundColour};padding:40px 40px 32px">
      <p style="font-family:${fontFamily};font-size:16px;color:${textColour};margin:0 0 20px;line-height:1.6">
        ${nl2br(content.greeting)}
      </p>

      <p style="font-family:${fontFamily};font-size:16px;color:${textColour};margin:0 0 16px;line-height:1.6;font-weight:500">
        ${nl2br(content.opening)}
      </p>

      ${bodyParagraphs}

      ${ctaBlock}

      <p style="font-family:${fontFamily};font-size:15px;color:${textColour};margin:0 0 24px;line-height:1.6">
        ${nl2br(content.closing)}
      </p>

      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px">
        <tr>
          <td style="border-top:1px solid #e8e8e8;font-size:0;line-height:0">&nbsp;</td>
        </tr>
      </table>

      <table cellpadding="0" cellspacing="0" border="0">
        <tr>
          ${logoUrl
      ? `<td valign="top" style="padding-right:16px">
                  <img src="${escapeHtml(
        logoUrl
      )}" alt="" height="36" style="display:block;max-height:36px;border-radius:4px"/>
                </td>`
      : ""
    }
          <td valign="top">
            <p style="font-family:${fontFamily};font-size:15px;font-weight:600;color:${primaryColour};margin:0 0 3px">${escapeHtml(
      brand.senderName
    )}</p>
            ${brand.senderTitle
      ? `<p style="font-family:${fontFamily};font-size:13px;color:#777777;margin:0 0 3px">${escapeHtml(
        brand.senderTitle
      )}</p>`
      : ""
    }
            <p style="font-family:${fontFamily};font-size:13px;color:${accentColour};margin:0 0 3px;font-weight:500">${escapeHtml(
      brand.companyName
    )}</p>
            ${websiteUrl
      ? `<a href="${escapeHtml(
        websiteUrl
      )}" target="_blank" rel="noopener noreferrer" style="font-family:${fontFamily};font-size:12px;color:#999999;text-decoration:none">${escapeHtml(
        websiteUrl.replace(/^https?:\/\//, "")
      )}</a>`
      : ""
    }
            ${brand.senderPhone
      ? `<p style="font-family:${fontFamily};font-size:12px;color:#999999;margin:3px 0 0">${escapeHtml(
        brand.senderPhone
      )}</p>`
      : ""
    }
          </td>
        </tr>
      </table>
    </td>
  </tr>`;
}

function lightenHex(hex: string, ratio: number): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return "#f5f5f5";

  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);

  const lr = Math.round(r + (255 - r) * ratio);
  const lg = Math.round(g + (255 - g) * ratio);
  const lb = Math.round(b + (255 - b) * ratio);

  return `#${lr.toString(16).padStart(2, "0")}${lg
    .toString(16)
    .padStart(2, "0")}${lb.toString(16).padStart(2, "0")}`;
}

function buildFooter(
  brand: BrandConfig,
  unsubscribeUrl: string | null
): string {
  const linkedinUrl = safeUrl(brand.linkedinUrl);
  const facebookUrl = safeUrl(brand.facebookUrl);
  const twitterUrl = safeUrl(brand.twitterUrl);
  const websiteUrl = safeUrl(brand.website);
  const fontFamily = safeCssValue(brand.fontFamily, "Arial, sans-serif");
  const secondaryColour = safeCssValue(
    brand.secondaryColour,
    "#e94560"
  );
  const primaryColour = safeCssValue(brand.primaryColour, "#1a1a2e");
  const hasSocial = Boolean(linkedinUrl || facebookUrl || twitterUrl);

  const unsubscribeBlock = unsubscribeUrl
    ? `<p style="font-family:${fontFamily};font-size:11px;color:#888888;margin:0;text-align:center;line-height:1.5">
        <a href="${escapeHtml(
      unsubscribeUrl
    )}" style="color:#888888">${escapeHtml(
      brand.unsubscribeText
    )}</a>
      </p>`
    : `<p style="font-family:${fontFamily};font-size:11px;color:#888888;margin:0;text-align:center;line-height:1.5">
        ${escapeHtml(brand.unsubscribeText)}
      </p>`;

  return `
  <tr>
    <td style="background-color:${secondaryColour};height:2px;font-size:0;line-height:0">&nbsp;</td>
  </tr>
  <tr>
    <td style="background-color:${lightenHex(
    primaryColour,
    0.92
  )};padding:20px 40px 24px">
      ${hasSocial
      ? `<p style="font-family:${fontFamily};font-size:12px;color:#888888;margin:0 0 10px;text-align:center">
              ${linkedinUrl
        ? `<a href="${escapeHtml(
          linkedinUrl
        )}" target="_blank" rel="noopener noreferrer" style="color:#888888;text-decoration:none;margin:0 6px">LinkedIn</a>`
        : ""
      }
              ${facebookUrl
        ? `<a href="${escapeHtml(
          facebookUrl
        )}" target="_blank" rel="noopener noreferrer" style="color:#888888;text-decoration:none;margin:0 6px">Facebook</a>`
        : ""
      }
              ${twitterUrl
        ? `<a href="${escapeHtml(
          twitterUrl
        )}" target="_blank" rel="noopener noreferrer" style="color:#888888;text-decoration:none;margin:0 6px">Twitter</a>`
        : ""
      }
            </p>`
      : ""
    }

      ${brand.companyAddress
      ? `<p style="font-family:${fontFamily};font-size:11px;color:#aaaaaa;margin:0 0 8px;text-align:center;line-height:1.5">${escapeHtml(
        brand.companyAddress
      )}</p>`
      : ""
    }

      ${unsubscribeBlock}

      <p style="font-family:${fontFamily};font-size:10px;color:#cccccc;margin:8px 0 0;text-align:center">
        &copy; ${new Date().getFullYear()} ${escapeHtml(
      brand.companyName
    )}
        ${websiteUrl
      ? `&nbsp;&middot;&nbsp;<a href="${escapeHtml(
        websiteUrl
      )}" target="_blank" rel="noopener noreferrer" style="color:#cccccc;text-decoration:none">${escapeHtml(
        websiteUrl.replace(/^https?:\/\//, "")
      )}</a>`
      : ""
    }
      </p>
    </td>
  </tr>`;
}

const UNSUBSCRIBE_PATTERN =
  /\n?(?:---+\s*)?\n?(?:To unsubscribe[^\n]*\n?(?:https?:\/\/\S+)?|Reply\s+['"]?unsubscribe['"]?[^\n]*)\n?/gi;

function stripEmbeddedUnsubscribe(text: string): string {
  return text.replace(UNSUBSCRIBE_PATTERN, "").trim();
}

function buildPlainHtml(
  brand: BrandConfig,
  content: EmailContent,
  unsubscribeUrl: string | null,
  pixelTag: string
): string {
  const cleanBody = stripEmbeddedUnsubscribe(content.body);
  const cleanClosing = stripEmbeddedUnsubscribe(content.closing);

  const shouldIncludeCtaText =
    Boolean(content.ctaText) &&
    content.ctaText !== "Let's connect" &&
    !cleanBody.toLowerCase().includes(content.ctaText.toLowerCase());

  const paragraphs = [
    content.greeting
      ? `<p>${nl2br(content.greeting)}</p>`
      : "",
    content.opening
      ? `<p>${nl2br(content.opening)}</p>`
      : "",
    cleanBody
      ? cleanBody
        .split(/\r?\n\r?\n+/)
        .map((p) => `<p>${nl2br(p.trim())}</p>`)
        .join("")
      : "",
    shouldIncludeCtaText
      ? `<p>${escapeHtml(content.ctaText)}</p>`
      : "",
    cleanClosing
      ? `<p>${nl2br(cleanClosing)}</p>`
      : "",
    `<p>${escapeHtml(brand.senderName)}</p>`,
  ]
    .filter(Boolean)
    .join("\n");

  const unsubscribeBlock = unsubscribeUrl
    ? `<p style="font-size:11px;color:#888888;margin-top:24px"><a href="${escapeHtml(
      unsubscribeUrl
    )}" style="color:#888888">Unsubscribe</a></p>`
    : `<p style="font-size:11px;color:#888888;margin-top:24px">${escapeHtml(
      brand.unsubscribeText
    )}</p>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(content.subject)}</title>
</head>
<body style="margin:0;padding:0;background:#ffffff;color:#333333">
  <div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#333333;max-width:600px">
    ${paragraphs}
    ${unsubscribeBlock}
  </div>
  ${pixelTag}
</body>
</html>`;
}

function buildPlainText(
  brand: BrandConfig,
  content: EmailContent,
  unsubscribeUrl: string | null
): string {
  const cleanBody = stripEmbeddedUnsubscribe(content.body);
  const cleanClosing = stripEmbeddedUnsubscribe(content.closing);

  const shouldIncludeCtaText =
    Boolean(content.ctaText) &&
    content.ctaText !== "Let's connect" &&
    !cleanBody.toLowerCase().includes(content.ctaText.toLowerCase());

  return [
    content.greeting,
    content.opening,
    cleanBody,
    shouldIncludeCtaText ? content.ctaText : null,
    cleanClosing,
    brand.senderName,
    unsubscribeUrl ? `Unsubscribe: ${unsubscribeUrl}` : brand.unsubscribeText,
  ]
    .filter(
      (line): line is string =>
        line !== null && line !== undefined && line.trim() !== ""
    )
    .join("\n\n");
}

function wrapLinks(
  html: string,
  messageId: string,
  customDomain?: string
): string {
  const trackingDomain = customDomain
    ? customDomain.startsWith("http://") ||
      customDomain.startsWith("https://")
      ? customDomain
      : `https://${customDomain}`
    : process.env.TRACKING_DOMAIN ?? process.env.APP_URL;

  const safeTrackingDomain = safeUrl(trackingDomain);

  if (!safeTrackingDomain || !messageId) return html;

  return html.replace(
    /href="(https?:\/\/[^"]+)"/gi,
    (match, url: string) => {
      if (
        !isRedirectableUrl(url) ||
        /\/webhook\/(?:unsubscribe|track\/open|track\/click)(?:\/|$)/i.test(
          url
        )
      ) {
        return match;
      }

      const trackingUrl = buildClickTrackingUrl(
        messageId,
        url,
        safeTrackingDomain
      );

      return trackingUrl
        ? `href="${escapeHtml(trackingUrl)}"`
        : match;
    }
  );
}

function resolveTrackingOption(
  enabled: boolean | undefined,
  disabled: boolean | undefined
): boolean {
  if (enabled !== undefined) return enabled;
  if (disabled !== undefined) return !disabled;
  return false;
}

export function renderEmailTemplate(
  brand: BrandConfig,
  content: EmailContent,
  options?: {
    style?: TemplateStyle;
    customTrackingDomain?: string;
    enableOpenTracking?: boolean;
    enableClickTracking?: boolean;
    disableOpenTracking?: boolean;
    disableClickTracking?: boolean;
  }
): { html: string; text: string } {
  const style = options?.style ?? "PLAIN";
  const unsubscribeUrl = buildUnsubscribeUrl(content.messageId);

  const enableOpenTracking = resolveTrackingOption(
    options?.enableOpenTracking,
    options?.disableOpenTracking
  );

  const enableClickTracking = resolveTrackingOption(
    options?.enableClickTracking,
    options?.disableClickTracking
  );

  const pixelUrl =
    enableOpenTracking && content.messageId
      ? buildOpenTrackingPixelUrl(content.messageId)
      : null;

  const pixelTag = pixelUrl
    ? `<img src="${escapeHtml(
      pixelUrl
    )}" width="1" height="1" border="0" alt="" style="display:block;width:1px;height:1px;border:0" />`
    : "";

  if (style === "PLAIN") {
    let html = buildPlainHtml(
      brand,
      content,
      unsubscribeUrl,
      pixelTag
    );

    if (enableClickTracking) {
      html = wrapLinks(
        html,
        content.messageId ?? "",
        options?.customTrackingDomain
      );
    }

    return {
      html,
      text: buildPlainText(brand, content, unsubscribeUrl),
    };
  }

  const primaryColour = safeCssValue(
    brand.primaryColour,
    "#1a1a2e"
  );
  const backgroundColour = safeCssValue(
    brand.backgroundColour,
    "#f4f4f7"
  );

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
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:${backgroundColour};word-spacing:normal">
  <div style="display:none;font-size:1px;color:${backgroundColour};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden">
    ${escapeHtml(content.opening.slice(0, 120))}
  </div>

  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${backgroundColour};padding:32px 16px">
    <tr>
      <td align="center">
        <table class="email-container" width="600" cellpadding="0" cellspacing="0" border="0"
          style="max-width:600px;width:100%;border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08)">
          ${buildHeader(brand)}
          ${buildBody(brand, content)}
          ${buildFooter(brand, unsubscribeUrl)}
        </table>
      </td>
    </tr>
  </table>

  ${pixelTag}
</body>
</html>`;

  const text = [
    content.greeting,
    "",
    content.opening,
    "",
    content.body,
    "",
    content.ctaText && content.ctaUrl
      ? `${content.ctaText}: ${content.ctaUrl}`
      : content.ctaText,
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
    .filter(
      (line): line is string =>
        line !== null && line !== undefined
    )
    .join("\n");

  return {
    html: enableClickTracking
      ? wrapLinks(
        html,
        content.messageId ?? "",
        options?.customTrackingDomain
      )
      : html,
    text,
  };
}