import type { Metadata } from "next";
import { AuthLayoutShell } from "@/app/components/AuthLayoutShell";

export const metadata: Metadata = {
    title: "Verify Email — ScoutSend",
};

export default function VerifyEmailLayout({ children }: { children: React.ReactNode }) {
    return <AuthLayoutShell>{children}</AuthLayoutShell>;
}
