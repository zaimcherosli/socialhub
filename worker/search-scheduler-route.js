const fs = require('fs');
const content = fs.readFileSync('src/index.js', 'utf8');
const lines = content.split('\n');
lines.forEach((line, idx) => {
    if (line.toLowerCase().includes('scheduled_posts') || line.toLowerCase().includes('api/scheduler')) {
        console.log(`${idx + 1}: ${line.trim()}`);
    }
});
