import { prisma } from "./lib/prisma";

async function main() {
    const settings = await prisma.brandSettings.findMany();
    console.log("BRAND_SETTINGS_COUNT:", settings.length);
    console.log("SETTINGS:", JSON.stringify(settings, null, 2));
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
