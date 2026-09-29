import { Suspense } from "react";
import { VerifyEmailForm } from "@/app/UI/VerifyEmailForm";

export default function VerifyEmailPage() {
    return (
        <Suspense fallback={
            <div style={{ textAlign: "center", padding: "32px 0", color: "var(--text-muted)" }}>
                Loading verification page…
            </div>
        }>
            <VerifyEmailForm />
        </Suspense>
    );
}
