import type { Metadata } from "next";
import { LoginForm } from "@/app/UI/LoginForm";

export const metadata: Metadata = {
    title: "Sign in — ScoutSend",
};

export default function LoginPage() {
    return <LoginForm />;
}