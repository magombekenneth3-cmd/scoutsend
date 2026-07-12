"use client";

import { useState, useEffect, useRef } from "react";
import { CreateMailboxPayload, MailProviderType } from "@/app/api/mailbox/Mailbox.Types";
import { createMailbox } from "@/app/api/mailbox/mailboxapi";
import { SenderMailbox } from "@/app/api/mailbox/Mailbox.Types";

interface AddMailboxSheetProps {
    open: boolean;
    onClose: () => void;
    onCreated: (mailbox: SenderMailbox) => void;
}

type Step = "provider" | "credentials" | "settings";

interface BaseForm {
    label: string;
    emailAddress: string;
    dailyLimit: string;
    warmupEnabled: boolean;
}

interface SmtpForm extends BaseForm {
    providerType: "SMTP";
    smtpHost: string;
    smtpPort: string;
    secure: boolean;
    username: string;
    password: string;
    imapHost: string;
    imapPort: string;
}

interface GmailForm extends BaseForm {
    providerType: "GMAIL";
    clientId: string;
    clientSecret: string;
    refreshToken: string;
}

interface OutlookForm extends BaseForm {
    providerType: "OUTLOOK";
    clientId: string;
    clientSecret: string;
    tenantId: string;
    refreshToken: string;
}

type ProviderForm = SmtpForm | GmailForm | OutlookForm;

const EMPTY_BASE: BaseForm = {
    label: "",
    emailAddress: "",
    dailyLimit: "50",
    warmupEnabled: true,
};

const SMTP_DEFAULTS: SmtpForm = {
    ...EMPTY_BASE,
    providerType: "SMTP",
    smtpHost: "",
    smtpPort: "587",
    secure: false,
    username: "",
    password: "",
    imapHost: "",
    imapPort: "993",
};

const GMAIL_DEFAULTS: GmailForm = {
    ...EMPTY_BASE,
    providerType: "GMAIL",
    clientId: "",
    clientSecret: "",
    refreshToken: "",
};

const OUTLOOK_DEFAULTS: OutlookForm = {
    ...EMPTY_BASE,
    providerType: "OUTLOOK",
    clientId: "",
    clientSecret: "",
    tenantId: "",
    refreshToken: "",
};

const inputCls =
    "w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-red)] focus:ring-1 focus:ring-[var(--red)]/20 transition-colors duration-150";
const errorBorder = "border-[var(--red)]/60 focus:border-[var(--red)]";
const labelCls = "block text-xs font-medium text-[var(--text-secondary)] mb-1.5";

function FieldError({ msg }: { msg?: string }) {
    if (!msg) return null;
    return <p className="mt-1 text-xs text-[var(--red)]">{msg}</p>;
}

function Toggle({
    checked,
    onChange,
    label,
    description,
}: {
    checked: boolean;
    onChange: (v: boolean) => void;
    label: string;
    description: string;
}) {
    return (
        <div className="flex items-center justify-between p-3 rounded-lg bg-[var(--surface-2)] border border-[var(--border)]">
            <div>
                <p className="text-sm font-medium text-[var(--text-primary)]">{label}</p>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">{description}</p>
            </div>
            <button
                type="button"
                onClick={() => onChange(!checked)}
                role="switch"
                aria-checked={checked}
                className={[
                    "relative w-10 h-5 rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)] flex-shrink-0",
                    checked ? "bg-emerald-500" : "bg-[var(--surface)] border border-[var(--border)]",
                ].join(" ")}
            >
                <span
                    className={[
                        "absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200",
                        checked ? "translate-x-5" : "translate-x-0.5",
                    ].join(" ")}
                />
            </button>
        </div>
    );
}

const PROVIDERS: { type: MailProviderType; label: string; description: string }[] = [
    { type: "GMAIL", label: "Gmail", description: "Connect via OAuth credentials & refresh token" },
    { type: "OUTLOOK", label: "Outlook / Microsoft 365", description: "Connect via Azure app credentials" },
    { type: "SMTP", label: "SMTP / Custom", description: "Any provider with SMTP access" },
];

function ProviderIcon({ type, size = 20 }: { type: MailProviderType; size?: number }) {
    if (type === "GMAIL") {
        return (
            <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.47 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
        );
    }
    if (type === "OUTLOOK") {
        return (
            <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <rect width="13" height="13" x="1" y="6" rx="1.5" fill="#0078D4" />
                <path fill="#50D9FF" d="M7.5 9.5a3 3 0 1 0 0 5 3 3 0 0 0 0-5Z" />
                <rect width="11" height="11" x="12" y="3" rx="1.5" fill="#0078D4" opacity=".9" />
                <path stroke="#fff" strokeWidth="1.2" strokeLinecap="round" d="M14 8h7M14 11h7M14 14h4" />
            </svg>
        );
    }
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
        </svg>
    );
}

export function AddMailboxSheet({ open, onClose, onCreated }: AddMailboxSheetProps) {
    const [step, setStep] = useState<Step>("provider");
    const [form, setForm] = useState<ProviderForm>(SMTP_DEFAULTS);
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [submitting, setSubmitting] = useState(false);
    const [serverError, setServerError] = useState<string | null>(null);
    const [visible, setVisible] = useState(false);
    const dialogRef = useRef<HTMLDialogElement>(null);
    const firstInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const el = dialogRef.current;
        if (!el) return;
        if (open) {
            setStep("provider");
            setForm(SMTP_DEFAULTS);
            setErrors({});
            setSubmitting(false);
            setServerError(null);
            if (!el.open) el.showModal();
            requestAnimationFrame(() => setVisible(true));
        } else {
            setVisible(false);
            const timer = setTimeout(() => { if (el.open) el.close(); }, 300);
            return () => clearTimeout(timer);
        }
    }, [open]);

    useEffect(() => {
        if (open && step !== "provider") {
            setTimeout(() => firstInputRef.current?.focus(), 60);
        }
    }, [open, step]);

    function setField<K extends keyof ProviderForm>(field: string, value: ProviderForm[K]) {
        setForm((f) => ({ ...f, [field]: value } as ProviderForm));
        setErrors((e) => { const n = { ...e }; delete n[field as string]; return n; });
    }

    const isDirty = step !== "provider" && (
        form.emailAddress.trim() !== "" ||
        (form.providerType === "SMTP" && form.password.trim() !== "")
    );

    useEffect(() => {
        if (!isDirty) return;
        const fn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
        window.addEventListener("beforeunload", fn);
        return () => window.removeEventListener("beforeunload", fn);
    }, [isDirty]);

    function requestClose() {
        if (isDirty && !window.confirm("You have unsaved credentials. Leave anyway?")) return;
        onClose();
    }

    function selectProvider(type: MailProviderType) {
        if (type === "GMAIL") setForm({ ...GMAIL_DEFAULTS });
        else if (type === "OUTLOOK") setForm({ ...OUTLOOK_DEFAULTS });
        else setForm({ ...SMTP_DEFAULTS });
        setErrors({});
        setStep("credentials");
    }

    function validateCredentials(): boolean {
        const e: Record<string, string> = {};
        if (!form.emailAddress.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.emailAddress)) {
            e.emailAddress = "Valid email address required";
        }
        if (form.providerType === "GMAIL") {
            if (!form.clientId.trim()) e.clientId = "Client ID is required";
            if (!form.clientSecret.trim()) e.clientSecret = "Client secret is required";
            if (!form.refreshToken.trim()) e.refreshToken = "Refresh token is required";
        } else if (form.providerType === "OUTLOOK") {
            if (!form.clientId.trim()) e.clientId = "Client ID is required";
            if (!form.clientSecret.trim()) e.clientSecret = "Client secret is required";
            if (!form.tenantId.trim()) e.tenantId = "Tenant ID is required";
            if (!form.refreshToken.trim()) e.refreshToken = "Refresh token is required";
        } else {
            if (!form.smtpHost.trim()) e.smtpHost = "SMTP host is required";
            const port = Number(form.smtpPort);
            if (!form.smtpPort || isNaN(port) || port < 1 || port > 65535) e.smtpPort = "Valid port required (1–65535)";
            if (!form.username.trim()) e.username = "Username is required";
            if (!form.password.trim()) e.password = "Password is required";
            if (form.imapPort) {
                const ip = Number(form.imapPort);
                if (isNaN(ip) || ip < 1 || ip > 65535) e.imapPort = "Valid IMAP port required";
            }
        }
        setErrors(e);
        return Object.keys(e).length === 0;
    }

    function validateSettings(): boolean {
        const e: Record<string, string> = {};
        if (!form.label.trim()) e.label = "Label is required";
        const limit = Number(form.dailyLimit);
        if (!form.dailyLimit || isNaN(limit) || limit < 1 || limit > 10000) {
            e.dailyLimit = "Must be between 1 and 10,000";
        }
        setErrors(e);
        return Object.keys(e).length === 0;
    }

    function handleCredentialsNext() {
        if (validateCredentials()) {
            setForm((f) => ({ ...f, label: f.label || f.emailAddress }));
            setStep("settings");
        }
    }

    async function handleSubmit() {
        if (!validateSettings()) return;
        setSubmitting(true);
        setServerError(null);

        let credentials: CreateMailboxPayload["credentials"];

        if (form.providerType === "GMAIL") {
            credentials = {
                type: "GMAIL",
                clientId: form.clientId.trim(),
                clientSecret: form.clientSecret.trim(),
                refreshToken: form.refreshToken.trim(),
                emailAddress: form.emailAddress.trim(),
            };
        } else if (form.providerType === "OUTLOOK") {
            credentials = {
                type: "OUTLOOK",
                clientId: form.clientId.trim(),
                clientSecret: form.clientSecret.trim(),
                tenantId: form.tenantId.trim(),
                refreshToken: form.refreshToken.trim(),
                emailAddress: form.emailAddress.trim(),
            };
        } else {
            credentials = {
                type: "SMTP",
                smtpHost: form.smtpHost.trim(),
                smtpPort: Number(form.smtpPort),
                secure: form.secure,
                username: form.username.trim(),
                password: form.password,
                imapHost: form.imapHost.trim() || undefined,
                imapPort: form.imapPort ? Number(form.imapPort) : undefined,
            };
        }

        const payload: CreateMailboxPayload = {
            label: form.label.trim(),
            emailAddress: form.emailAddress.trim(),
            credentials,
            dailyLimit: Number(form.dailyLimit),
            warmupEnabled: form.warmupEnabled,
        };

        try {
            const mailbox = await createMailbox(payload);
            onCreated(mailbox as unknown as SenderMailbox);
        } catch (err) {
            setServerError(err instanceof Error ? err.message : "Something went wrong");
        } finally {
            setSubmitting(false);
        }
    }

    function handleCancel(e: React.SyntheticEvent) {
        e.preventDefault();
        requestClose();
    }

    function handleKey(e: React.KeyboardEvent) {
        if (e.key === "Escape") requestClose();
    }

    const providerLabel =
        form.providerType === "GMAIL" ? "Gmail" :
            form.providerType === "OUTLOOK" ? "Outlook" : "SMTP";

    return (
        <dialog
            ref={dialogRef}
            onCancel={handleCancel}
            aria-label="Add sender mailbox"
            className="sheet-panel"
        >
            <div
                className="absolute inset-0 bg-black/50"
                onClick={requestClose}
                aria-hidden="true"
            />
            <aside
                onKeyDown={handleKey}
                className={[
                    "absolute top-0 right-0 h-full w-[440px] max-w-full flex flex-col",
                    "bg-[var(--navy-mid)] border-l border-[var(--border)] shadow-2xl",
                    "transition-transform duration-300 ease-in-out",
                    visible ? "translate-x-0" : "translate-x-full",
                ].join(" ")}
            >
                {/* Header */}
                <div className="flex items-center justify-between h-16 px-5 border-b border-[var(--border)] flex-shrink-0">
                    <div className="flex items-center gap-3">
                        {step !== "provider" && (
                            <button
                                onClick={() => setStep(step === "settings" ? "credentials" : "provider")}
                                aria-label="Go back"
                                className="w-7 h-7 flex items-center justify-center rounded-md text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                            >
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                                    <path d="M19 12H5M12 5l-7 7 7 7" />
                                </svg>
                            </button>
                        )}
                        <h2 className="text-sm font-semibold font-display text-[var(--text-primary)]">
                            {step === "provider" && "Add Sender Mailbox"}
                            {step === "credentials" && `${providerLabel} Credentials`}
                            {step === "settings" && "Mailbox Settings"}
                        </h2>
                    </div>
                    <button
                        onClick={requestClose}
                        aria-label="Close"
                        className="w-8 h-8 flex items-center justify-center rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                    </button>
                </div>

                {/* Step indicator */}
                {step !== "provider" && (
                    <div className="flex items-center gap-1.5 px-5 py-3 border-b border-[var(--border)] flex-shrink-0">
                        {(["credentials", "settings"] as Step[]).map((s, i) => (
                            <div key={s} className="flex items-center gap-1.5">
                                <span className={[
                                    "w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center transition-colors",
                                    step === s
                                        ? "bg-[var(--red)] text-white"
                                        : (step === "settings" && s === "credentials")
                                            ? "bg-emerald-500/20 text-emerald-400"
                                            : "bg-[var(--surface-2)] text-[var(--text-muted)]",
                                ].join(" ")}>
                                    {step === "settings" && s === "credentials" ? (
                                        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>
                                    ) : i + 1}
                                </span>
                                <span className={`text-xs ${step === s ? "text-[var(--text-primary)]" : "text-[var(--text-muted)]"}`}>
                                    {s === "credentials" ? "Credentials" : "Settings"}
                                </span>
                                {i < 1 && <span className="text-[var(--border)] text-xs mx-0.5">/</span>}
                            </div>
                        ))}
                    </div>
                )}

                {/* Body */}
                <div className="flex-1 overflow-y-auto px-5 py-5">

                    {/* Step 1 — Provider picker */}
                    {step === "provider" && (
                        <div className="space-y-3">
                            <p className="text-xs text-[var(--text-muted)] mb-4">
                                Choose how to connect your sending mailbox. Credentials are encrypted at rest.
                            </p>
                            {PROVIDERS.map(({ type, label, description }) => (
                                <button
                                    key={type}
                                    onClick={() => selectProvider(type)}
                                    className="w-full flex items-center gap-4 p-4 rounded-xl bg-[var(--surface)] border border-[var(--border)] hover:border-[var(--border-red)] hover:bg-[var(--surface-2)] transition-all duration-150 text-left group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                                >
                                    <span className="flex-shrink-0 text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors">
                                        <ProviderIcon type={type} size={22} />
                                    </span>
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm font-semibold text-[var(--text-primary)]">{label}</p>
                                        <p className="text-xs text-[var(--text-muted)] mt-0.5">{description}</p>
                                    </div>
                                    <svg className="flex-shrink-0 text-[var(--text-muted)] group-hover:text-[var(--red)] transition-colors" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                                        <path d="M9 18l6-6-6-6" />
                                    </svg>
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Step 2 — Credentials */}
                    {step === "credentials" && (
                        <div className="space-y-4">
                            <div>
                                <label className={labelCls}>Email address <span className="text-[var(--red)]">*</span></label>
                                <input
                                    ref={firstInputRef}
                                    type="email"
                                    autoComplete="off"
                                    className={`${inputCls} ${errors.emailAddress ? errorBorder : ""}`}
                                    placeholder="you@yourdomain.com"
                                    value={form.emailAddress}
                                    onChange={(e) => setField("emailAddress", e.target.value)}
                                />
                                <FieldError msg={errors.emailAddress} />
                            </div>

                            {form.providerType === "GMAIL" && (
                                <>
                                    <div>
                                        <label className={labelCls}>Client ID <span className="text-[var(--red)]">*</span></label>
                                        <input type="text" autoComplete="off" className={`${inputCls} ${errors.clientId ? errorBorder : ""}`} placeholder="xxxx.apps.googleusercontent.com" value={form.clientId} onChange={(e) => setField("clientId", e.target.value)} />
                                        <FieldError msg={errors.clientId} />
                                    </div>
                                    <div>
                                        <label className={labelCls}>Client secret <span className="text-[var(--red)]">*</span></label>
                                        <input type="password" autoComplete="new-password" className={`${inputCls} ${errors.clientSecret ? errorBorder : ""}`} placeholder="GOCSPX-…" value={form.clientSecret} onChange={(e) => setField("clientSecret", e.target.value)} />
                                        <FieldError msg={errors.clientSecret} />
                                    </div>
                                    <div>
                                        <label className={labelCls}>Refresh token <span className="text-[var(--red)]">*</span></label>
                                        <input type="password" autoComplete="new-password" className={`${inputCls} ${errors.refreshToken ? errorBorder : ""}`} placeholder="1//04…" value={form.refreshToken} onChange={(e) => setField("refreshToken", e.target.value)} />
                                        <FieldError msg={errors.refreshToken} />
                                        <p className="mt-1 text-xs text-[var(--text-muted)]">Generate via Google OAuth Playground with Gmail scopes.</p>
                                    </div>
                                </>
                            )}

                            {form.providerType === "OUTLOOK" && (
                                <>
                                    <div>
                                        <label className={labelCls}>Client ID <span className="text-[var(--red)]">*</span></label>
                                        <input type="text" autoComplete="off" className={`${inputCls} ${errors.clientId ? errorBorder : ""}`} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" value={form.clientId} onChange={(e) => setField("clientId", e.target.value)} />
                                        <FieldError msg={errors.clientId} />
                                    </div>
                                    <div>
                                        <label className={labelCls}>Client secret <span className="text-[var(--red)]">*</span></label>
                                        <input type="password" autoComplete="new-password" className={`${inputCls} ${errors.clientSecret ? errorBorder : ""}`} placeholder="Azure app secret value" value={form.clientSecret} onChange={(e) => setField("clientSecret", e.target.value)} />
                                        <FieldError msg={errors.clientSecret} />
                                    </div>
                                    <div>
                                        <label className={labelCls}>Tenant ID <span className="text-[var(--red)]">*</span></label>
                                        <input type="text" autoComplete="off" className={`${inputCls} ${errors.tenantId ? errorBorder : ""}`} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" value={form.tenantId} onChange={(e) => setField("tenantId", e.target.value)} />
                                        <FieldError msg={errors.tenantId} />
                                    </div>
                                    <div>
                                        <label className={labelCls}>Refresh token <span className="text-[var(--red)]">*</span></label>
                                        <input type="password" autoComplete="new-password" className={`${inputCls} ${errors.refreshToken ? errorBorder : ""}`} placeholder="Microsoft OAuth refresh token" value={form.refreshToken} onChange={(e) => setField("refreshToken", e.target.value)} />
                                        <FieldError msg={errors.refreshToken} />
                                    </div>
                                </>
                            )}

                            {form.providerType === "SMTP" && (
                                <>
                                    <div className="grid grid-cols-[1fr_100px] gap-3">
                                        <div>
                                            <label className={labelCls}>SMTP host <span className="text-[var(--red)]">*</span></label>
                                            <input type="text" autoComplete="off" className={`${inputCls} ${errors.smtpHost ? errorBorder : ""}`} placeholder="smtp.yourprovider.com" value={form.smtpHost} onChange={(e) => setField("smtpHost", e.target.value)} />
                                            <FieldError msg={errors.smtpHost} />
                                        </div>
                                        <div>
                                            <label className={labelCls}>Port <span className="text-[var(--red)]">*</span></label>
                                            <input type="number" min={1} max={65535} className={`${inputCls} ${errors.smtpPort ? errorBorder : ""}`} value={form.smtpPort} onChange={(e) => setField("smtpPort", e.target.value)} />
                                            <FieldError msg={errors.smtpPort} />
                                        </div>
                                    </div>
                                    <Toggle
                                        checked={form.secure}
                                        onChange={(v) => setField("secure", v)}
                                        label="TLS / SSL"
                                        description="Enable for port 465. Leave off for port 587 (STARTTLS)."
                                    />
                                    <div>
                                        <label className={labelCls}>Username <span className="text-[var(--red)]">*</span></label>
                                        <input type="text" autoComplete="off" className={`${inputCls} ${errors.username ? errorBorder : ""}`} placeholder="Usually your full email address" value={form.username} onChange={(e) => setField("username", e.target.value)} />
                                        <FieldError msg={errors.username} />
                                    </div>
                                    <div>
                                        <label className={labelCls}>Password <span className="text-[var(--red)]">*</span></label>
                                        <input type="password" autoComplete="new-password" className={`${inputCls} ${errors.password ? errorBorder : ""}`} placeholder="App password or SMTP password" value={form.password} onChange={(e) => setField("password", e.target.value)} />
                                        <FieldError msg={errors.password} />
                                    </div>
                                    <div className="pt-1 border-t border-[var(--border)]">
                                        <p className="text-xs text-[var(--text-muted)] mb-3">IMAP (optional — for reply tracking)</p>
                                        <div className="grid grid-cols-[1fr_100px] gap-3">
                                            <div>
                                                <label className={labelCls}>IMAP host</label>
                                                <input type="text" autoComplete="off" className={inputCls} placeholder="imap.yourprovider.com" value={form.imapHost} onChange={(e) => setField("imapHost", e.target.value)} />
                                            </div>
                                            <div>
                                                <label className={labelCls}>Port</label>
                                                <input type="number" min={1} max={65535} className={`${inputCls} ${errors.imapPort ? errorBorder : ""}`} value={form.imapPort} onChange={(e) => setField("imapPort", e.target.value)} />
                                                <FieldError msg={errors.imapPort} />
                                            </div>
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                    )}

                    {/* Step 3 — Settings */}
                    {step === "settings" && (
                        <div className="space-y-4">
                            <div>
                                <label className={labelCls}>Label <span className="text-[var(--red)]">*</span></label>
                                <input
                                    ref={firstInputRef}
                                    type="text"
                                    autoComplete="off"
                                    className={`${inputCls} ${errors.label ? errorBorder : ""}`}
                                    placeholder="e.g. Outreach — John"
                                    value={form.label}
                                    onChange={(e) => setField("label", e.target.value)}
                                />
                                <FieldError msg={errors.label} />
                                <p className="mt-1 text-xs text-[var(--text-muted)]">A friendly name to identify this mailbox in campaigns.</p>
                            </div>
                            <div>
                                <label className={labelCls}>Daily send limit <span className="text-[var(--red)]">*</span></label>
                                <input
                                    type="number"
                                    min={1}
                                    max={10000}
                                    className={`${inputCls} ${errors.dailyLimit ? errorBorder : ""}`}
                                    placeholder="50"
                                    value={form.dailyLimit}
                                    onChange={(e) => setField("dailyLimit", e.target.value)}
                                />
                                <FieldError msg={errors.dailyLimit} />
                                <p className="mt-1 text-xs text-[var(--text-muted)]">Start at 25–50 during warmup. Increase gradually over weeks.</p>
                            </div>
                            <Toggle
                                checked={form.warmupEnabled}
                                onChange={(v) => setField("warmupEnabled", v)}
                                label="Enable warmup"
                                description="Gradually increases sending volume to build sender reputation."
                            />
                            {serverError && (
                                <div className="flex items-start gap-2 p-3 bg-[var(--red-glow)] border border-[var(--border-red)] rounded-lg">
                                    <svg className="flex-shrink-0 mt-0.5 text-[var(--red)]" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                                    </svg>
                                    <p className="text-xs text-[var(--red)]">{serverError}</p>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Footer */}
                {step !== "provider" && (
                    <div className="flex items-center gap-3 px-5 py-4 border-t border-[var(--border)] flex-shrink-0">
                        <button
                            onClick={requestClose}
                            className="flex-1 h-10 rounded-lg text-sm font-medium text-[var(--text-secondary)] bg-[var(--surface-2)] hover:bg-[var(--surface)] border border-[var(--border)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                        >
                            Cancel
                        </button>
                        {step === "credentials" && (
                            <button
                                onClick={handleCredentialsNext}
                                className="flex-1 h-10 rounded-lg text-sm font-semibold text-white bg-[var(--red)] hover:bg-[var(--red-dim)] active:scale-[0.98] transition-all duration-150 flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                            >
                                Next
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                                    <path d="M9 18l6-6-6-6" />
                                </svg>
                            </button>
                        )}
                        {step === "settings" && (
                            <button
                                onClick={handleSubmit}
                                disabled={submitting}
                                className="flex-1 h-10 rounded-lg text-sm font-semibold text-white bg-[var(--red)] hover:bg-[var(--red-dim)] active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-150 flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                            >
                                {submitting ? (
                                    <>
                                        <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                                        </svg>
                                        Connecting…
                                    </>
                                ) : "Connect Mailbox"}
                            </button>
                        )}
                    </div>
                )}
            </aside>
        </dialog>
    );
}
