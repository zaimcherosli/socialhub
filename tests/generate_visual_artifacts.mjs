/**
 * generate_visual_artifacts.mjs
 * Generates actual 1080x1080 PNG poster renders for all 3 Phase 2.6 fixtures:
 * 1. tests/output/before-after.png
 * 2. tests/output/profession-specific.png
 * 3. tests/output/problem-solution.png
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const outputDir = path.resolve(__dirname, 'output');
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

// Locate headless browser
const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
];

const browserExe = candidates.find(p => fs.existsSync(p));
if (!browserExe) {
    console.error('Error: No supported browser found (Edge/Chrome) for PNG artifact rendering.');
    process.exit(1);
}

console.log(`Using browser for Canvas rendering: ${browserExe}`);

const runnerHtmlPath = path.resolve(__dirname, 'render_runner.html').replace(/\\/g, '/');

const targets = [
    { key: 'testA', filename: 'before-after.png', label: 'BEFORE_AFTER (Test A)' },
    { key: 'testB', filename: 'profession-specific.png', label: 'PROFESSION_SPECIFIC (Test B)' },
    { key: 'testC', filename: 'problem-solution.png', label: 'PROBLEM_SOLUTION (Test C)' }
];

console.log('Generating 1080x1080 visual PNG artifacts...\n');

for (const target of targets) {
    const outPath = path.join(outputDir, target.filename);
    const targetUrl = `file:///${runnerHtmlPath}?fixture=${target.key}`;

    console.log(`Rendering ${target.label} -> ${target.filename}...`);

    const args = [
        '--headless=new',
        '--disable-gpu',
        `--screenshot=${outPath}`,
        '--window-size=1080,1080',
        '--force-device-scale-factor=1',
        '--default-background-color=00000000',
        '--hide-scrollbars',
        '--virtual-time-budget=2500',
        '--allow-file-access-from-files',
        targetUrl
    ];

    try {
        execFileSync(browserExe, args, { stdio: 'pipe', timeout: 15000 });
        const stats = fs.statSync(outPath);
        console.log(`  ✓ Generated: ${target.filename} (${Math.round(stats.size / 1024)} KB)`);
    } catch (err) {
        console.error(`  ✗ Failed to render ${target.filename}:`, err.message);
        process.exit(1);
    }
}

console.log('\nAll 3 visual PNG fixtures successfully generated in tests/output/');
