import { FREE_EMAIL_HOSTS } from "./constants";
import type { RegisterFieldError, LoginFieldError } from "./types";

export interface StrengthResult {
    score: number;
    label: string;
    color: string;
    pct: string;
}

export function getPasswordStrength(pwd: string): StrengthResult {
    let score = 0;
    if (pwd.length >= 8) score++;
    if (pwd.length >= 12) score++;
    if (/[A-Z]/.test(pwd)) score++;
    if (/[0-9]/.test(pwd)) score++;
    if (/[^A-Za-z0-9]/.test(pwd)) score++;

    const levels: StrengthResult[] = [
        { score: 1, label: "Weak", color: "#f87171", pct: "20%" },
        { score: 2, label: "Fair", color: "#fb923c", pct: "40%" },
        { score: 3, label: "Good", color: "#facc15", pct: "60%" },
        { score: 4, label: "Strong", color: "#4ade80", pct: "80%" },
        { score: 5, label: "Very strong", color: "#22c55e", pct: "100%" },
    ];

    const idx = Math.min(Math.max(score - 1, 0), 4);
    return levels[idx];
}

export function isValidEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function isWorkEmail(email: string): boolean {
    const domain = email.split("@")[1]?.toLowerCase() ?? "";
    return !FREE_EMAIL_HOSTS.has(domain);
}

export function validateRegister(fields: {
    firstName: string;
    lastName: string;
    email: string;
    password: string;
    agree: boolean;
}): RegisterFieldError {
    const errors: RegisterFieldError = {};

    if (fields.firstName.trim().length < 2)
        errors.firstName = "At least 2 characters required.";

    if (fields.lastName.trim().length < 2)
        errors.lastName = "At least 2 characters required.";

    if (!isValidEmail(fields.email)) {
        errors.email = "Please enter a valid email.";
    } else if (!isWorkEmail(fields.email)) {
        errors.email = "Please use a work email address.";
    }

    if (fields.password.length < 8)
        errors.password = "Password must be at least 8 characters.";

    if (!fields.agree)
        errors.agree = "You must accept the terms to continue.";

    return errors;
}

export function validateLogin(fields: {
    email: string;
    password: string;
}): LoginFieldError {
    const errors: LoginFieldError = {};

    if (!isValidEmail(fields.email))
        errors.email = "Please enter a valid email.";

    if (fields.password.length < 1)
        errors.password = "Password is required.";

    return errors;
}