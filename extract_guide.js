const fs = require('fs');
const raw = fs.readFileSync('queue_guide_raw.json', 'utf8');
const data = JSON.parse(raw);
const content = data.content;
fs.writeFileSync('queue_guide.md', content);
console.log('Successfully wrote queue_guide.md');
