const fs = require('fs');
const content = fs.readFileSync('../public/css/layout.css', 'utf8');
const lines = content.split('\n');
lines.forEach((line, idx) => {
    if (line.toLowerCase().includes('backdrop')) {
        console.log(`${idx + 1}: ${line.trim()}`);
    }
});
