import type { Metadata } from "next";
import { AuthLayoutShell } from "@/app/components/AuthLayoutShell";

export const metadata: Metadata = {
    title: "Forgot password — ScoutSend",
};

export default function ForgotPasswordLayout({ children }: { children: React.ReactNode }) {
    return <AuthLayoutShell>{children}</AuthLayoutShell>;
}