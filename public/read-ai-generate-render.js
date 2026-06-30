const fs = require('fs');
const content = fs.readFileSync('ai-generate.html', 'utf8');
const lines = content.split('\n');
lines.forEach((line, idx) => {
    if (line.toLowerCase().includes('generate') || line.toLowerCase().includes('result') || line.toLowerCase().includes('render')) {
        if (line.trim().length > 0 && line.trim().length < 150) {
            console.log(`Line ${idx + 1}: ${line.trim()}`);
        }
    }
});
