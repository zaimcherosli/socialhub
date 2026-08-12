/**
 * SocialHub Central Versioning & System Configuration
 * Dynamically populated during build process from package.json
 */
(function() {
    const CONFIG = Object.freeze({
        VERSION: '1.4.96',
        BUILD_DATE: new Date().toLocaleDateString('ms-MY'),
        ENV: 'production',
        PWA_VERSION: 'v1.4.96'
    });

    window.SYS_CONFIG = CONFIG;

    // ── Stylish F12 Console Output ──────────────────────────────────────────
    if (typeof console !== 'undefined' && console.log) {
        console.log(
            `%c 🚀 SocialHub SaaS %c v${CONFIG.VERSION} %c (${CONFIG.ENV}) `,
            'background: #7c3aed; color: #ffffff; font-weight: bold; padding: 4px 8px; border-radius: 4px 0 0 4px; font-family: system-ui, sans-serif;',
            'background: #db2777; color: #ffffff; font-weight: bold; padding: 4px 8px; font-family: system-ui, sans-serif;',
            'background: #0f172a; color: #38bdf8; padding: 4px 8px; border-radius: 0 4px 4px 0; font-family: system-ui, sans-serif;'
        );
        console.log(`%c Build Date: ${CONFIG.BUILD_DATE} | PWA Version: ${CONFIG.PWA_VERSION} `, 'color: #94a3b8; font-size: 0.75rem;');
    }

    // ── Auto-Inject Version into HTML Badges ────────────────────────────────
    function initVersionBadges() {
        const badges = document.querySelectorAll('#versionBadge, .version-badge-dynamic');
        badges.forEach(b => {
            b.textContent = `v${CONFIG.VERSION}`;
            b.style.cursor = 'pointer';
            b.title = 'Tekan untuk info sistem diagnostik';
            b.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                window.showSystemInfo();
            });
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initVersionBadges);
    } else {
        initVersionBadges();
    }

    // ── System Info Diagnostic Dialog ───────────────────────────────────────
    window.showSystemInfo = function() {
        let modal = document.getElementById('systemInfoModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'systemInfoModal';
            modal.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100vw;
                height: 100vh;
                background: rgba(15, 23, 42, 0.75);
                backdrop-filter: blur(12px);
                -webkit-backdrop-filter: blur(12px);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 999999;
                opacity: 0;
                transition: opacity 0.3s cubic-bezier(0.16, 1, 0.3, 1);
                box-sizing: border-box;
                padding: 1rem;
            `;
            modal.innerHTML = `
                <div style="background: #0f172a; border: 1px solid rgba(139, 92, 246, 0.3); border-radius: 20px; padding: 1.5rem; width: 100%; max-width: 440px; color: #f8fafc; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7); font-family: system-ui, -apple-system, sans-serif;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 0.85rem;">
                        <div style="font-weight: 800; font-size: 1.15rem; display: flex; align-items: center; gap: 0.5rem; color: #f8fafc;">
                            <span style="display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; background: rgba(124,58,237,0.25); border-radius: 10px; color: #a78bfa;">⚙️</span>
                            Sistem Diagnostik
                        </div>
                        <button id="closeSysInfoBtn" style="background: rgba(255,255,255,0.08); border: none; color: #94a3b8; width: 32px; height: 32px; border-radius: 50%; font-size: 1.1rem; cursor: pointer; display: flex; align-items: center; justify-content: center;">✕</button>
                    </div>
                    
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; margin-bottom: 1.25rem;">
                        <div style="background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.06); padding: 0.75rem; border-radius: 12px;">
                            <span style="color: #94a3b8; font-size: 0.72rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; display: block; margin-bottom: 0.2rem;">Versi Perisian</span>
                            <strong style="color: #38bdf8; font-size: 1rem;">v${CONFIG.VERSION}</strong>
                        </div>
                        <div style="background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.06); padding: 0.75rem; border-radius: 12px;">
                            <span style="color: #94a3b8; font-size: 0.72rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; display: block; margin-bottom: 0.2rem;">Persekitaran</span>
                            <strong style="color: #4ade80; font-size: 1rem;">${CONFIG.ENV}</strong>
                        </div>
                        <div style="background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.06); padding: 0.75rem; border-radius: 12px;">
                            <span style="color: #94a3b8; font-size: 0.72rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; display: block; margin-bottom: 0.2rem;">Tarikh Binaan</span>
                            <strong style="color: #c084fc; font-size: 0.9rem;">${CONFIG.BUILD_DATE}</strong>
                        </div>
                        <div style="background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.06); padding: 0.75rem; border-radius: 12px;">
                            <span style="color: #94a3b8; font-size: 0.72rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; display: block; margin-bottom: 0.2rem;">Status PWA</span>
                            <strong style="color: #facc15; font-size: 0.9rem;">${'serviceWorker' in navigator ? 'Aktif ✓' : 'N/A'}</strong>
                        </div>
                    </div>

                    <div style="font-size: 0.75rem; color: #94a3b8; line-height: 1.5; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.05); padding: 0.85rem; border-radius: 12px; margin-bottom: 1.25rem;">
                        <div><strong>Browser:</strong> ${navigator.userAgent.split(' ')[0]}</div>
                        <div><strong>Skrin:</strong> ${window.innerWidth} x ${window.innerHeight} px</div>
                        <div><strong>URL Semasa:</strong> ${window.location.pathname}</div>
                    </div>

                    <button id="sysHardRefreshBtn" style="width: 100%; background: linear-gradient(135deg, #7c3aed, #db2777); color: white; border: none; padding: 0.75rem; border-radius: 12px; font-weight: 700; font-size: 0.88rem; cursor: pointer; box-shadow: 0 4px 14px rgba(124,58,237,0.4); transition: transform 0.2s;">
                        🔄 Muat Semula Semua Cache (Hard Refresh)
                    </button>
                </div>
            `;
            document.body.appendChild(modal);

            document.getElementById('closeSysInfoBtn').addEventListener('click', () => {
                modal.style.opacity = '0';
                setTimeout(() => modal.style.display = 'none', 300);
            });

            document.getElementById('sysHardRefreshBtn').addEventListener('click', async () => {
                const btn = document.getElementById('sysHardRefreshBtn');
                btn.disabled = true;
                btn.textContent = 'Memuat semula...';
                try {
                    if ('caches' in window) {
                        const keys = await caches.keys();
                        await Promise.all(keys.map(k => caches.delete(k)));
                    }
                    if ('serviceWorker' in navigator) {
                        const regs = await navigator.serviceWorker.getRegistrations();
                        for (const reg of regs) {
                            await reg.unregister();
                        }
                    }
                } catch (e) {}
                window.location.href = window.location.origin + window.location.pathname + '?v=' + Date.now();
            });
        }

        modal.style.display = 'flex';
        requestAnimationFrame(() => modal.style.opacity = '1');
    };
})();
