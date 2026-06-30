const fs = require('fs');
const content = fs.readFileSync('src/index.js', 'utf8');
const lines = content.split('\n');
lines.forEach((line, idx) => {
    if (line.includes('scheduled-posts') || line.includes('scheduled_posts')) {
        console.log(`${idx + 1}: ${line.trim()}`);
    }
});
