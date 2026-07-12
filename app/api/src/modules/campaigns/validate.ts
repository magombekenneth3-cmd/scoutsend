export function isUUID(value: string): boolean {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const cuid2 = /^[a-z0-9]{20,30}$/;
    return uuid.test(value) || cuid2.test(value);
}