import { prisma } from "../app/api/src/lib/prisma";

async function testAllCategoryBModels() {
  console.log("=== EXHAUSTIVE REAL DB TEST ON ALL CATEGORY B MODELS ===");

  // 1. SenderMailbox findFirst
  console.log("\n1. Testing prisma.senderMailbox.findFirst()...");
  try {
    const box = await prisma.senderMailbox.findFirst();
    console.log("SenderMailbox.findFirst() SUCCESS! Found:", box?.id);
  } catch (err: any) {
    console.log("SenderMailbox.findFirst() THREW ERROR:", err.code, err.message);
  }

  // 2. Reply findFirst
  console.log("\n2. Testing prisma.reply.findFirst()...");
  try {
    const reply = await prisma.reply.findFirst();
    console.log("Reply.findFirst() SUCCESS! Found:", reply?.id);
  } catch (err: any) {
    console.log("Reply.findFirst() THREW ERROR:", err.code, err.message);
  }

  // 3. Lead findFirst
  console.log("\n3. Testing prisma.lead.findFirst()...");
  try {
    const lead = await prisma.lead.findFirst();
    console.log("Lead.findFirst() SUCCESS! Found:", lead?.id);
  } catch (err: any) {
    console.log("Lead.findFirst() THREW ERROR:", err.code, err.message);
  }

  // 4. OutreachMessage findFirst
  console.log("\n4. Testing prisma.outreachMessage.findFirst()...");
  try {
    const msg = await prisma.outreachMessage.findFirst();
    console.log("OutreachMessage.findFirst() SUCCESS! Found:", msg?.id);
  } catch (err: any) {
    console.log("OutreachMessage.findFirst() THREW ERROR:", err.code, err.message);
  }

  // 5. BrandSettings findFirst
  console.log("\n5. Testing prisma.brandSettings.findFirst()...");
  try {
    const brand = await prisma.brandSettings.findFirst();
    console.log("BrandSettings.findFirst() SUCCESS! Found:", brand?.id);
  } catch (err: any) {
    console.log("BrandSettings.findFirst() THREW ERROR:", err.code, err.message);
  }

  // 6. SendIntent findFirst
  console.log("\n6. Testing prisma.sendIntent.findFirst()...");
  try {
    const intent = await (prisma as any).sendIntent.findFirst();
    console.log("SendIntent.findFirst() SUCCESS! Found:", intent?.id);
  } catch (err: any) {
    console.log("SendIntent.findFirst() THREW ERROR:", err.code, err.message);
  }

  await prisma.$disconnect();
}

testAllCategoryBModels().catch((e) => {
  console.error("Test error:", e);
  prisma.$disconnect();
});
