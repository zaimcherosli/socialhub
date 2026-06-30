const fs = require('fs');
const content = fs.readFileSync('C:/Users/Zaim/.gemini/antigravity/brain/1769f195-0f9c-437d-a362-3b048948f204/.system_generated/tasks/task-1676.log', 'utf8');
const lines = content.split('\n');
lines.forEach((line, idx) => {
    if (line.includes('/api/ai/image') || line.toLowerCase().includes('exception') || line.toLowerCase().includes('error')) {
        console.log(`Line ${idx + 1}: ${line.trim()}`);
    }
});
