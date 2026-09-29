import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
    serverExternalPackages: [
        "ioredis",
        "bullmq",
        "@bull-board/api",
        "bcrypt",
        "nodemailer",
    ],
    turbopack: {
        root: path.resolve(__dirname),
    },
    async headers() {
        return [
            {
                // Apply to all routes
                source: "/(.*)",
                headers: [
                    { key: "X-Frame-Options",        value: "DENY" },
                    { key: "X-Content-Type-Options", value: "nosniff" },
                    { key: "Referrer-Policy",         value: "strict-origin-when-cross-origin" },
                    {
                        key: "Permissions-Policy",
                        value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
                    },
                    // HSTS — only effective over HTTPS; safe to include, ignored over HTTP
                    {
                        key: "Strict-Transport-Security",
                        value: "max-age=63072000; includeSubDomains; preload",
                    },
                ],
            },
            {
                // Dashboard routes — additionally block embedding by other origins
                source: "/dashboard(.*)",
                headers: [
                    { key: "X-Frame-Options", value: "DENY" },
                ],
            },
        ];
    },
};

export default nextConfig;
