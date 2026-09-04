const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || '08f4a1647bc1230e867e4818b5aada0a';
const projectName = process.env.CLOUDFLARE_PROJECT_NAME || 'socialhub';
const zoneId = process.env.CLOUDFLARE_ZONE_ID || '35d51114b1e5cae6da558031413f3ebe';
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
const apiKey = process.env.CLOUDFLARE_API_KEY;
const email = process.env.CLOUDFLARE_EMAIL;

function getAuthHeaders() {
    if (apiToken) {
        return {
            'Authorization': `Bearer ${apiToken}`,
            'Content-Type': 'application/json'
        };
    }
    if (apiKey && email) {
        return {
            'X-Auth-Email': email,
            'X-Auth-Key': apiKey,
            'Content-Type': 'application/json'
        };
    }
    console.error('Error: Set CLOUDFLARE_API_TOKEN or both CLOUDFLARE_EMAIL and CLOUDFLARE_API_KEY.');
    process.exit(1);
}

async function updateDNSAndCheck() {
    // 1. Update CNAME to socialhub-4zl.pages.dev
    const dnsId = process.env.CLOUDFLARE_DNS_RECORD_ID || 'f7325149e01bd7f98a7c07e108ca2adb';
    console.log('🔄 Updating CNAME target to socialhub-4zl.pages.dev...');
    
    await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records/${dnsId}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({
            type: 'CNAME',
            name: 'socialhub',
            content: 'socialhub-4zl.pages.dev',
            proxied: true
        })
    });

    // 2. Poll domain status
    console.log('🔍 Polling Pages Custom Domain SSL Validation status...');
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${projectName}/domains`;
    const res = await fetch(url, {
        headers: getAuthHeaders()
    });
    const data = await res.json();
    const targetDomain = data.result.find(d => d.name === 'socialhub.kwikezee.my');
    console.log('Domain Status:', JSON.stringify(targetDomain, null, 2));
}

updateDNSAndCheck();
