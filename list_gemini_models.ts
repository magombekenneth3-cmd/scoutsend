import "dotenv/config";
import { GoogleGenerativeAI } from "@google/generative-ai";

async function main() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    console.error("No API key");
    process.exit(1);
  }
  const genAI = new GoogleGenerativeAI(key);
  try {
    // We can list models using the generative model client or the REST client
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
    const json = await response.json();
    console.log(JSON.stringify(json, null, 2));
  } catch (err: any) {
    console.error("Error listing models:", err.message || err);
  }
}

main();
