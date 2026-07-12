export interface RegisterPayload {
    firstName: string;
    lastName: string;
    email: string;
    password: string;
}

export interface LoginPayload {
    email: string;
    password: string;
}

export interface AuthUser {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
}

export interface AuthResponse {
    user: AuthUser;
    token: string;
}

export type FormStatus = "idle" | "loading" | "success";

export interface RegisterFieldError {
    firstName?: string;
    lastName?: string;
    email?: string;
    password?: string;
    agree?: string;
}

export interface LoginFieldError {
    email?: string;
    password?: string;
}