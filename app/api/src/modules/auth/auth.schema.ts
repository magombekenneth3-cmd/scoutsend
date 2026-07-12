import z from "zod";

export const registerSchema = z.object({
    email: z.string().email(),
    password: z.string().min(8).max(100),
    firstName: z.string().min(2).max(50),
    lastName: z.string().min(2).max(50),
});

export const loginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(8).max(100),
});

export const forgotPasswordSchema = z.object({
    email: z.string().email(),
});

export const resetPasswordSchema = z.object({
    token: z.string().min(1),
    password: z.string().min(8).max(100),
});