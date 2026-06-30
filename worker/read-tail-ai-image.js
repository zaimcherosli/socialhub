const fs = require('fs');
const content = fs.readFileSync('C:/Users/Zaim/.gemini/antigravity/brain/1769f195-0f9c-437d-a362-3b048948f204/.system_generated/tasks/task-1498.log', 'utf8');
const lines = content.split('\n');
lines.forEach((line, idx) => {
    if (line.includes('/api/ai/image') || line.includes('imageResponse') || line.toLowerCase().includes('dreamshaper') || line.toLowerCase().includes('ai/image')) {
        console.log(`Line ${idx + 1}: ${line.trim()}`);
    }
});
