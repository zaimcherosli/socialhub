/**
 * copy-pages.js
 * Copies all public HTML pages, CSS, JS, and static files to the Vite dist output directory.
 * This ensures every page (login.html, dashboard.html, etc.) is available on Cloudflare Pages,
 * with full CSS and JavaScript module support.
 *
 * Cache-busting: Injects ?v=<version> query string onto all local CSS/JS imports inside
 * HTML files so browsers always fetch fresh files after every deploy.
 */

const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '../public');
const DIST = path.resolve(__dirname, '../public/dist');

// ── Read app version from package.json ──────────────────────────────────────
const pkg = require('../package.json');
const VERSION = pkg.version;
const BUILD_DATE = new Date().toISOString().split('T')[0];
console.log(`🔖 Central Versioning: v${VERSION} (Build Date: ${BUILD_DATE})`);

// ── Update public/js/config.js with latest VERSION & BUILD_DATE ─────────────
const configJsPath = path.join(SRC, 'js/config.js');
if (fs.existsSync(configJsPath)) {
    let cfgContent = fs.readFileSync(configJsPath, 'utf8');
    cfgContent = cfgContent
        .replace(/VERSION:\s*['"].*?['"]/, `VERSION: '${VERSION}'`)
        .replace(/BUILD_DATE:\s*['"].*?['"]/, `BUILD_DATE: '${BUILD_DATE}'`)
        .replace(/PWA_VERSION:\s*['"].*?['"]/, `PWA_VERSION: 'v${VERSION}'`);
    fs.writeFileSync(configJsPath, cfgContent, 'utf8');
    console.log(`⚙️  Updated public/js/config.js with VERSION v${VERSION}`);
}

// ── Helper: recursively copy a directory ────────────────────────────────────
function copyDirRecursive(srcDir, destDir) {
    if (!fs.existsSync(srcDir)) return 0;
    fs.mkdirSync(destDir, { recursive: true });

    let count = 0;
    const entries = fs.readdirSync(srcDir, { withFileTypes: true });
    for (const entry of entries) {
        const srcPath = path.join(srcDir, entry.name);
        const destPath = path.join(destDir, entry.name);
        if (entry.isDirectory()) {
            count += copyDirRecursive(srcPath, destPath);
        } else {
            if (entry.name === 'Sidebar.js') {
                let jsContent = fs.readFileSync(srcPath, 'utf8');
                jsContent = jsContent.replace(/v1\.4\.\d+/g, `v${VERSION}`).replace(/VERSION\s*\|\|\s*['"].*?['"]/g, `VERSION || '${VERSION}'`);
                fs.writeFileSync(destPath, jsContent, 'utf8');
            } else {
                fs.copyFileSync(srcPath, destPath);
            }
            count++;
        }
    }
    return count;
}

// ── Helper: inject ?v=VERSION onto local CSS/JS references & config.js inside HTML ───────
function injectCacheBust(html) {
    let out = html;
    // Inject config.js in <head> if not present
    if (!out.includes('config.js')) {
        out = out.replace(/<head>/i, `<head>\n    <script src="./js/config.js?v=${VERSION}"></script>`);
    } else {
        out = out.replace(/(src=["'])((?:\.\/)?js\/config\.js(?:\?v=[^"']*)?)(["'])/g, `$1./js/config.js?v=${VERSION}$3`);
    }

    return out
        // <link rel="stylesheet" href="css/..." /> or href="./css/..."
        .replace(/(href=["'])((?:\.\/)?css\/[^"'?]+)(["'])/g, `$1$2?v=${VERSION}$3`)
        // <script type="module" src="./js/..." /> or src="js/..."
        .replace(/(src=["'])((?:\.\/)?js\/[^"'?]+)(["'])/g, `$1$2?v=${VERSION}$3`)
        // ES module static imports: import ... from './js/...' or '../js/...'
        .replace(/(from\s+["'])((?:\.{1,2}\/)?(?:js\/)[^"'?]+)(["'])/g, `$1$2?v=${VERSION}$3`)
        // import('...') dynamic imports
        .replace(/(import\s*\(\s*["'])((?:\.{1,2}\/)?(?:js\/)[^"'?]+)(["']\s*\))/g, `$1$2?v=${VERSION}$3`);
}

// ── 1. Individual static files ───────────────────────────────────────────────
const staticFiles = [
    '_headers',
    'manifest.json',
    'socialhub_pwa_icon.png',
    'pwa_mobile_screen.jpg',
    'gltd2qpcwmyoozmg5sacsmspqd53de.html',
    'sw.js',
];
for (const file of staticFiles) {
    const src = path.join(SRC, file);
    const dest = path.join(DIST, file);
    if (fs.existsSync(src)) {
        if (file === 'sw.js') {
            let swContent = fs.readFileSync(src, 'utf8');
            swContent = swContent.replace(/const CACHE_NAME = ['"].*?['"];/, `const CACHE_NAME = 'socialhub-cache-v${VERSION}';`);
            fs.writeFileSync(dest, swContent, 'utf8');
            console.log(`✅ Copied & version-busted sw.js (v${VERSION})`);
        } else {
            fs.copyFileSync(src, dest);
            console.log(`✅ Copied: ${file}`);
        }
    } else {
        console.warn(`⚠️  Skipped (not found): ${file}`);
    }
}

// ── 2. All HTML pages — copy with cache-busting injected ─────────────────────
const htmlPages = fs.readdirSync(SRC).filter(f =>
    f.endsWith('.html') && f !== 'index.html'
);
for (const file of htmlPages) {
    const raw = fs.readFileSync(path.join(SRC, file), 'utf8');
    const busted = injectCacheBust(raw);
    fs.writeFileSync(path.join(DIST, file), busted, 'utf8');
    console.log(`📄 Copied page (cache-busted): ${file}`);
}

// ── 3. CSS and JS source directories (needed by all HTML pages) ──────────────
const srcDirs = ['css', 'js'];
for (const dir of srcDirs) {
    const count = copyDirRecursive(path.join(SRC, dir), path.join(DIST, dir));
    console.log(`📂 Copied ${dir}/ (${count} files)`);
}

// ── 4. Static subdirectories ─────────────────────────────────────────────────
const subDirs = ['privacy', 'terms', 'data-deletion', 'assets'];
for (const dir of subDirs) {
    const count = copyDirRecursive(path.join(SRC, dir), path.join(DIST, dir));
    if (count > 0) console.log(`📁 Copied ${dir}/ (${count} files)`);
}

console.log(`\n🎉 Done! Copied ${htmlPages.length} HTML pages (v${VERSION} cache-busted) + CSS/JS/static files to dist/`);
