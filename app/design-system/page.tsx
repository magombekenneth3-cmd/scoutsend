"use client";

import React, { useState } from "react";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Tooltip } from "../components/ui/Tooltip";
import { GlassModal } from "../components/ui/GlassModal";
import {
    SignalBadge,
    ActionBadge,
    PipelinePill,
    EmailStatusBadge,
    CompetitorBadge,
} from "../components/ui/Badge";
import { CampaignBadge, DomainBadge } from "../components/dashboard/badges";

export default function DesignSystemPage() {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [inputValue, setInputValue] = useState("");
    const [isLight, setIsLight] = useState(false);

    const toggleTheme = () => {
        const nextLight = !isLight;
        setIsLight(nextLight);
        if (nextLight) {
            document.documentElement.classList.add("light");
            localStorage.setItem("theme", "light");
        } else {
            document.documentElement.classList.remove("light");
            localStorage.setItem("theme", "dark");
        }
    };

    return (
        <div className="min-h-screen bg-[var(--background)] text-[var(--text-primary)] p-8 font-sans space-y-12 max-w-6xl mx-auto transition-colors duration-300">
            {/* Header */}
            <div className="border-b border-[var(--border)] pb-6 flex flex-wrap items-center justify-between gap-4">
                <div className="space-y-2">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[var(--red-glow)] border border-[var(--border-red)]">
                        <span className="text-xs font-bold font-display text-[var(--red)] uppercase tracking-wider">
                            Design System Showcase
                        </span>
                    </div>
                    <h1 className="text-3xl font-extrabold font-display tracking-tight text-[var(--text-primary)]">
                        ScoutSend Primitive Library & Token Showcase
                    </h1>
                    <p className="text-sm text-[var(--text-secondary)]">
                        Canonical design tokens, micro-interactions, components, and state management.
                    </p>
                </div>
                <Button variant="secondary" onClick={toggleTheme} className="gap-2">
                    {isLight ? "☀️ Light Mode (Clay)" : "🌙 Dark Mode"}
                </Button>
            </div>

            {/* Buttons */}
            <section className="space-y-4 card-glass p-6">
                <h2 className="text-lg font-bold font-display text-[var(--text-primary)]">
                    Button Primitives
                </h2>
                <div className="flex flex-wrap gap-4 items-center">
                    <Button variant="primary">Primary Action</Button>
                    <Button variant="secondary">Secondary Action</Button>
                    <Button variant="ghost">Ghost Button</Button>
                    <Button variant="danger">Danger Action</Button>
                    <Button variant="primary" isLoading>
                        Loading
                    </Button>
                    <Button variant="primary" size="sm">
                        Small
                    </Button>
                    <Button variant="primary" size="lg">
                        Large Hero
                    </Button>
                </div>
            </section>

            {/* Inputs */}
            <section className="space-y-4 card-glass p-6">
                <h2 className="text-lg font-bold font-display text-[var(--text-primary)]">
                    Input Primitives
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <Input
                        label="Work Email"
                        placeholder="amara@stackvault.io"
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        helperText="We'll never share your email."
                    />
                    <Input
                        label="API Key"
                        placeholder="sk_live_..."
                        value="invalid_key"
                        error="Invalid API key format"
                    />
                </div>
            </section>

            {/* Status Badges */}
            <section className="space-y-4 card-glass p-6">
                <h2 className="text-lg font-bold font-display text-[var(--text-primary)]">
                    Status Badges & Indicators
                </h2>
                <div className="space-y-4">
                    <div className="flex flex-wrap gap-3 items-center">
                        <CampaignBadge status="SENDING" />
                        <CampaignBadge status="GENERATING" />
                        <CampaignBadge status="REVIEW" />
                        <CampaignBadge status="FAILED" />
                        <CampaignBadge status="COMPLETED" />
                    </div>
                    <div className="flex flex-wrap gap-3 items-center">
                        <DomainBadge health="HEALTHY" />
                        <DomainBadge health="DEGRADED" />
                        <DomainBadge health="WARNING" />
                        <DomainBadge health="CRITICAL" />
                    </div>
                    <div className="flex flex-wrap gap-3 items-center">
                        <ActionBadge action="HIGH_PRIORITY" />
                        <ActionBadge action="STANDARD" />
                        <PipelinePill stage="QUALIFIED" />
                        <PipelinePill stage="ENGAGED" />
                        <EmailStatusBadge status="VERIFIED" />
                        <EmailStatusBadge status="BOUNCED" />
                        <CompetitorBadge tech={["apollo", "outreach"]} />
                    </div>
                </div>
            </section>

            {/* Tooltips & Modals */}
            <section className="space-y-4 card-glass p-6">
                <h2 className="text-lg font-bold font-display text-[var(--text-primary)]">
                    Overlays & Tooltips
                </h2>
                <div className="flex gap-6 items-center">
                    <Tooltip content="Domain reputation score: 99.4%" position="top">
                        <Button variant="secondary">Hover for Tooltip</Button>
                    </Tooltip>

                    <Button variant="primary" onClick={() => setIsModalOpen(true)}>
                        Open GlassModal
                    </Button>
                </div>
            </section>

            {/* Modal instance */}
            <GlassModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                title="GlassModal Component Demo"
                size="md"
            >
                <div className="p-6 space-y-4 text-sm text-[var(--text-secondary)]">
                    <p>
                        This modal consumes the canonical <code className="text-[var(--red)] font-mono">GlassModal</code> component with backdrop blur, keyboard trap, and spring animations.
                    </p>
                    <div className="flex justify-end gap-3 pt-4">
                        <Button variant="secondary" onClick={() => setIsModalOpen(false)}>
                            Cancel
                        </Button>
                        <Button variant="primary" onClick={() => setIsModalOpen(false)}>
                            Confirm Action
                        </Button>
                    </div>
                </div>
            </GlassModal>
        </div>
    );
}
