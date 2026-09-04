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

async function addWorkerDNS() {
    console.log('🌐 Adding CNAME DNS record for api.socialhub.kwikezee.my...');
    const url = `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records`;
    const res = await fetch(url, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
            type: 'CNAME',
            name: 'api.socialhub',
            content: 'socialhub-api.huzaimrosli.workers.dev',
            proxied: true
        })
    });

    const data = await res.json();
    console.log('API Response:', JSON.stringify(data, null, 2));
}

addWorkerDNS();
