"use client";

import { createContext, useContext } from "react";

export interface DashboardUser {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
    emailVerified: boolean;
    orgId: string | null;
    orgRole: string | null;
}

export const UserContext = createContext<DashboardUser | null>(null);

export function useUser(): DashboardUser | null {
    return useContext(UserContext);
}
