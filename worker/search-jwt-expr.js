const fs = require('fs');
const content = fs.readFileSync('src/index.js', 'utf8');
const lines = content.split('\n');
lines.forEach((line, idx) => {
    if (line.includes('jwt') || line.includes('token') || line.includes('exp')) {
        if (line.toLowerCase().includes('sign') || line.toLowerCase().includes('generate') || line.toLowerCase().includes('secret')) {
            console.log(`Line ${idx + 1}: ${line.trim()}`);
        }
    }
});
