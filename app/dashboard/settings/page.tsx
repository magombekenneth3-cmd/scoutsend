"use client";

import { useState, useEffect, useCallback } from "react";
import { TopBar } from "../../components/dashboard/TopBar";

interface UserProfile {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
    createdAt: string;
    updatedAt: string;
}

type SaveState = "idle" | "saving" | "saved" | "error";

function Field({
    id,
    label,
    value,
    onChange,
    type = "text",
    placeholder,
    autoComplete,
}: {
    id: string;
    label: string;
    value: string;
    onChange: (v: string) => void;
    type?: string;
    placeholder?: string;
    autoComplete?: string;
}) {
    return (
        <div className="flex flex-col gap-1.5">
            <label htmlFor={id} className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-widest">
                {label}
            </label>
            <input
                id={id}
                type={type}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                autoComplete={autoComplete}
                className="w-full px-3 py-2.5 text-sm bg-[var(--surface)] border border-[var(--border)] rounded-lg text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-red)] focus:ring-1 focus:ring-[var(--red)]/20 transition-colors"
            />
        </div>
    );
}

export default function SettingsPage() {
    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);

    const [firstName, setFirstName] = useState("");
    const [lastName, setLastName] = useState("");
    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");

    const [profileState, setProfileState] = useState<SaveState>("idle");
    const [profileError, setProfileError] = useState<string | null>(null);
    const [passwordState, setPasswordState] = useState<SaveState>("idle");
    const [passwordError, setPasswordError] = useState<string | null>(null);

    const loadProfile = useCallback(async () => {
        try {
            const res = await fetch("/api/auth/me");
            if (!res.ok) throw new Error(`Status ${res.status}`);
            const data: UserProfile = await res.json();
            setProfile(data);
            setFirstName(data.firstName ?? "");
            setLastName(data.lastName ?? "");
        } catch {
            setLoadError("Failed to load profile. Please refresh.");
        }
    }, []);

    useEffect(() => { loadProfile(); }, [loadProfile]);

    async function saveProfile(e: React.FormEvent) {
        e.preventDefault();
        setProfileState("saving");
        setProfileError(null);
        try {
            const res = await fetch("/api/users/profile", {
                method: "PATCH",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    ...(firstName.trim() && { firstName: firstName.trim() }),
                    ...(lastName.trim() && { lastName: lastName.trim() }),
                }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
            setProfile((p) => p ? { ...p, firstName: data.firstName, lastName: data.lastName } : p);
            setProfileState("saved");
            setTimeout(() => setProfileState("idle"), 3000);
        } catch (err) {
            setProfileError(err instanceof Error ? err.message : "Save failed");
            setProfileState("error");
            setTimeout(() => setProfileState("idle"), 4000);
        }
    }

    async function savePassword(e: React.FormEvent) {
        e.preventDefault();
        if (newPassword !== confirmPassword) {
            setPasswordError("Passwords do not match");
            return;
        }
        if (newPassword.length < 8) {
            setPasswordError("Password must be at least 8 characters");
            return;
        }
        setPasswordState("saving");
        setPasswordError(null);
        try {
            const res = await fetch("/api/users/profile", {
                method: "PATCH",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ currentPassword, newPassword }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
            setCurrentPassword("");
            setNewPassword("");
            setConfirmPassword("");
            setPasswordState("saved");
            setTimeout(() => setPasswordState("idle"), 3000);
        } catch (err) {
            setPasswordError(err instanceof Error ? err.message : "Save failed");
            setPasswordState("error");
            setTimeout(() => setPasswordState("idle"), 4000);
        }
    }

    return (
        <div className="flex flex-col h-full">
            <TopBar title="Settings" subtitle="Manage your profile and account security" />

            <div className="flex-1 overflow-y-auto p-6">
                {loadError && (
                    <div role="alert" className="mb-6 flex items-center gap-3 px-4 py-3 bg-[var(--red-glow)] border border-[var(--border-red)] rounded-xl text-sm text-[var(--red)]">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                        {loadError}
                    </div>
                )}

                <div className="max-w-xl space-y-8">

                    <section aria-labelledby="profile-heading" className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
                        <div className="px-6 py-4 border-b border-[var(--border)]">
                            <h2 id="profile-heading" className="text-sm font-semibold font-display text-[var(--text-primary)]">Profile</h2>
                            <p className="text-xs text-[var(--text-muted)] mt-0.5">Update your display name</p>
                        </div>

                        <form onSubmit={saveProfile} className="px-6 py-5 space-y-4">
                            <div className="flex items-center gap-4 mb-5">
                                <div className="w-14 h-14 rounded-full bg-gradient-to-br from-[var(--red)] to-[var(--navy-deep)] flex items-center justify-center text-lg font-bold text-white flex-shrink-0">
                                    {profile ? `${(profile.firstName?.[0] ?? "").toUpperCase()}${(profile.lastName?.[0] ?? "").toUpperCase()}` : "··"}
                                </div>
                                <div>
                                    <p className="text-sm font-semibold text-[var(--text-primary)]">{profile ? `${profile.firstName} ${profile.lastName}` : "—"}</p>
                                    <p className="text-xs text-[var(--text-muted)]">{profile?.email}</p>
                                    <span className="inline-block mt-1 text-xs font-medium px-2 py-0.5 rounded-full bg-[var(--surface-2)] text-[var(--text-secondary)]">
                                        {profile?.role ? profile.role.charAt(0) + profile.role.slice(1).toLowerCase() : ""}
                                    </span>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <Field id="firstName" label="First Name" value={firstName} onChange={setFirstName} autoComplete="given-name" />
                                <Field id="lastName" label="Last Name" value={lastName} onChange={setLastName} autoComplete="family-name" />
                            </div>

                            {profileError && (
                                <p role="alert" className="text-xs text-[var(--red)]">{profileError}</p>
                            )}

                            <div className="flex items-center justify-end pt-1">
                                <button
                                    type="submit"
                                    disabled={profileState === "saving"}
                                    className="inline-flex items-center gap-2 text-xs font-semibold px-4 py-2 rounded-lg bg-[var(--red)] text-white hover:bg-[var(--red-dim)] active:scale-[0.97] transition-all duration-150 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                                >
                                    {profileState === "saving" && (
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="animate-spin" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                                    )}
                                    {profileState === "saved" ? "✓ Saved" : profileState === "saving" ? "Saving…" : "Save Changes"}
                                </button>
                            </div>
                        </form>
                    </section>

                    <section aria-labelledby="password-heading" className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
                        <div className="px-6 py-4 border-b border-[var(--border)]">
                            <h2 id="password-heading" className="text-sm font-semibold font-display text-[var(--text-primary)]">Change Password</h2>
                            <p className="text-xs text-[var(--text-muted)] mt-0.5">Use a strong password of at least 8 characters</p>
                        </div>

                        <form onSubmit={savePassword} className="px-6 py-5 space-y-4">
                            <Field
                                id="currentPassword"
                                label="Current Password"
                                type="password"
                                value={currentPassword}
                                onChange={setCurrentPassword}
                                autoComplete="current-password"
                            />
                            <Field
                                id="newPassword"
                                label="New Password"
                                type="password"
                                value={newPassword}
                                onChange={setNewPassword}
                                autoComplete="new-password"
                            />
                            <Field
                                id="confirmPassword"
                                label="Confirm New Password"
                                type="password"
                                value={confirmPassword}
                                onChange={setConfirmPassword}
                                autoComplete="new-password"
                            />

                            {passwordError && (
                                <p role="alert" className="text-xs text-[var(--red)]">{passwordError}</p>
                            )}

                            <div className="flex items-center justify-end pt-1">
                                <button
                                    type="submit"
                                    disabled={passwordState === "saving" || !currentPassword || !newPassword || !confirmPassword}
                                    className="inline-flex items-center gap-2 text-xs font-semibold px-4 py-2 rounded-lg bg-[var(--red)] text-white hover:bg-[var(--red-dim)] active:scale-[0.97] transition-all duration-150 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                                >
                                    {passwordState === "saving" && (
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="animate-spin" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                                    )}
                                    {passwordState === "saved" ? "✓ Password Updated" : passwordState === "saving" ? "Saving…" : "Update Password"}
                                </button>
                            </div>
                        </form>
                    </section>

                </div>
            </div>
        </div>
    );
}
