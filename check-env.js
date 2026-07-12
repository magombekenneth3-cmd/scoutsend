const fs = require('fs');
const path = require('path');

if (process.env.CI === 'true' && fs.existsSync(path.join(__dirname, '.env'))) {
  console.error('Error: .env file found in CI environment. Secrets must be injected via environment variables.');
  process.exit(1);
}
