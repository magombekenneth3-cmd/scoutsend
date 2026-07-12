async function testHost(name: string, url: string) {
  const start = Date.now();
  try {
    const res = await fetch(url);
    console.log(`${name} (${url}) status: ${res.status} in ${Date.now() - start}ms`);
  } catch (error: any) {
    console.log(`${name} (${url}) failed in ${Date.now() - start}ms: ${error.message}`);
  }
}

async function main() {
  console.log("Testing IPv6 vs IPv4 resolution times...");
  await testHost("localhost", "http://localhost:8080/health");
  await testHost("127.0.0.1", "http://127.0.0.1:8080/health");
}

main();

export {};

