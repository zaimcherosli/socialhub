const fs = require('fs');

function searchFile(filename) {
    const content = fs.readFileSync(filename, 'utf8');
    const lines = content.split('\n');
    lines.forEach((line, idx) => {
        if (line.toLowerCase().includes('post-editor') || line.toLowerCase().includes('edit')) {
            console.log(`${filename} [Line ${idx + 1}]: ${line.trim()}`);
        }
    });
}

searchFile('calendar.html');
searchFile('queue.html');
