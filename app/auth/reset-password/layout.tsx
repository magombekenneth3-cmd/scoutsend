import type { Metadata } from "next";
import { AuthLayoutShell } from "@/app/components/AuthLayoutShell";

export const metadata: Metadata = {
    title: "Reset password — ScoutSend",
};

export default function ResetPasswordLayout({ children }: { children: React.ReactNode }) {
    return <AuthLayoutShell>{children}</AuthLayoutShell>;
}