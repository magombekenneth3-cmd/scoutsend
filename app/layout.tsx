import type { Metadata, Viewport } from "next";
import { Syne, DM_Sans } from "next/font/google";
import "./globals.css";

const syne = Syne({
  variable: "--font-syne",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  style: ["normal", "italic"],
  display: "swap",
});

/* ─── Site config ────────────────────────────────────────────────────────────── */
const SITE_URL = "https://scoutsend.io";
const SITE_NAME = "ScoutSend";
const SITE_TITLE = "ScoutSend — AI Outbound Sales Engine";
const SITE_DESCRIPTION =
  "ScoutSend's AI pipeline researches every lead, writes hyper-personalised cold emails, reviews them for spam risk, and sends with domain-health protection — all on autopilot.";
const SITE_IMAGE = `${SITE_URL}/og.png`;

/* ─── Metadata ───────────────────────────────────────────────────────────────── */
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),

  /* ── Core ── */
  title: {
    default: SITE_TITLE,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: [
    "AI outbound sales",
    "cold email automation",
    "sales outreach AI",
    "email personalisation",
    "lead research AI",
    "email deliverability",
    "domain warmup",
    "SDR automation",
    "B2B prospecting",
    "Gemini AI sales",
  ],
  authors: [{ name: SITE_NAME, url: SITE_URL }],
  creator: SITE_NAME,
  publisher: SITE_NAME,

  /* ── Canonical ── */
  alternates: {
    canonical: "/",
  },

  /* ── Open Graph ── */
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: SITE_NAME,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: [
      {
        url: SITE_IMAGE,
        width: 1200,
        height: 630,
        alt: "ScoutSend — AI Outbound Sales Engine",
      },
    ],
    locale: "en_US",
  },

  /* ── Twitter / X ── */
  twitter: {
    card: "summary_large_image",
    site: "@scoutsend",
    creator: "@scoutsend",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: [SITE_IMAGE],
  },

  /* ── Robots ── */
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },

  /* ── Icons ── */
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
    shortcut: "/favicon.ico",
  },

  /* ── Manifest ── */
  manifest: "/site.webmanifest",

  /* ── Verification (add keys when ready) ── */
  verification: {
    google: "", // paste Google Search Console token here
    // yandex: "",
    // bing: "",
  },

  /* ── Category ── */
  category: "technology",
};

/* ─── Viewport ───────────────────────────────────────────────────────────────── */
export const viewport: Viewport = {
  themeColor: "#1a1a2e",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

/* ─── JSON-LD structured data ────────────────────────────────────────────────── */
const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      url: SITE_URL,
      name: SITE_NAME,
      description: SITE_DESCRIPTION,
      publisher: { "@id": `${SITE_URL}/#organization` },
      potentialAction: {
        "@type": "SearchAction",
        target: { "@type": "EntryPoint", urlTemplate: `${SITE_URL}/search?q={search_term_string}` },
        "query-input": "required name=search_term_string",
      },
    },
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: SITE_NAME,
      url: SITE_URL,
      logo: {
        "@type": "ImageObject",
        url: `${SITE_URL}/logo.png`,
        width: 512,
        height: 512,
      },
      sameAs: [
        "https://twitter.com/scoutsend",
        "https://linkedin.com/company/scoutsend",
      ],
    },
    {
      "@type": "SoftwareApplication",
      "@id": `${SITE_URL}/#app`,
      name: SITE_NAME,
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      description: SITE_DESCRIPTION,
      url: SITE_URL,
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
        description: "Free plan with 100 leads and 3 campaigns",
      },
    },
  ],
};

/* ─── Layout ─────────────────────────────────────────────────────────────────── */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${syne.variable} ${dmSans.variable} h-full antialiased`}
    >
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}