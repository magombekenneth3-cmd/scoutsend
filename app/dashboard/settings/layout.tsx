"use client";

import { type ReactNode } from "react";

export default function SettingsLayout({ children }: { children: ReactNode }) {
    return (
        <div className="flex flex-col h-full overflow-hidden">
            <div className="flex-1 flex flex-col overflow-hidden min-w-0">
                {children}
            </div>
        </div>
    );
}
