import { cookies } from "next/headers";
import Jwt from "jsonwebtoken";

interface SessionPayload {
    userId: string;
}

export async function getServerSession(): Promise<SessionPayload | null> {
    try {
        const store = await cookies();
        const token = store.get("token")?.value;
        if (!token) return null;

        const JWT_SECRET = process.env.JWT_SECRET;
        if (!JWT_SECRET) return null;

        const decoded = Jwt.verify(token, JWT_SECRET) as { userId: string };
        if (!decoded || !decoded.userId) return null;

        return { userId: decoded.userId };
    } catch {
        return null;
    }
}
