import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/app/UI/ForgotPassword";

export const metadata: Metadata = {
    title: "Forgot password — ScoutSend",
};

export default function ForgotPasswordPage() {
    return <ForgotPasswordForm />;
}