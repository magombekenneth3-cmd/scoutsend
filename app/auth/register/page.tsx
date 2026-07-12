import type { Metadata } from "next";
import { RegisterForm } from "@/app/UI/RegisterForm";

export const metadata: Metadata = {
    title: "Create account — ScoutSend",
};

export default function RegisterPage() {
    return <RegisterForm />;
}