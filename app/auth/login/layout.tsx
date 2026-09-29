import type { Metadata } from "next";
import { AuthLayoutShell } from "@/app/components/AuthLayoutShell";

export const metadata: Metadata = {
    title: "Sign in — ScoutSend",
    description: "Scout every lead. Send with precision.",
};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
    return <AuthLayoutShell>{children}</AuthLayoutShell>;
}