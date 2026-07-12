"use client";

import { Suspense } from "react";
import { ResetPasswordForm } from "../../UI/ResetPasswordForm";

export default function ResetPasswordPage() {
    return (
        <Suspense>
            <ResetPasswordForm />
        </Suspense>
    );
}