import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
    serverExternalPackages: [
        "ioredis",
        "bullmq",
        "@bull-board/api",
        "bcryptjs",
        "nodemailer",
    ],
    turbopack: {
        root: path.resolve(__dirname),
    },
};

export default nextConfig;
