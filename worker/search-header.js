const fs = require('fs');
const content = fs.readFileSync('../public/js/components/Header.js', 'utf8');
const lines = content.split('\n');
lines.forEach((line, idx) => {
    if (line.toLowerCase().includes('backdrop') || line.toLowerCase().includes('z-index') || line.toLowerCase().includes('sidebar')) {
        console.log(`${idx + 1}: ${line.trim()}`);
    }
});
