const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || '08f4a1647bc1230e867e4818b5aada0a';
const zoneId = process.env.CLOUDFLARE_ZONE_ID || '35d51114b1e5cae6da558031413f3ebe';
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
const apiKey = process.env.CLOUDFLARE_API_KEY;
const email = process.env.CLOUDFLARE_EMAIL;
const apiDomain = process.env.CLOUDFLARE_WORKER_DOMAIN || 'api.socialhub.kwikezee.my';
const serviceName = process.env.CLOUDFLARE_WORKER_SERVICE || 'socialhub-api';

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

console.log(`🚀 Adding custom Worker domain '${apiDomain}' to Cloudflare Worker '${serviceName}'...`);

async function addWorkerDomain() {
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/domains`;
    const res = await fetch(url, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({
            environment: 'production',
            hostname: apiDomain,
            service: serviceName,
            zone_id: zoneId
        })
    });

    const data = await res.json();
    console.log('Worker Domain API Response:', JSON.stringify(data, null, 2));

    if (data.success) {
        console.log(`\n🎉 SUCCESS! Custom Worker domain '${apiDomain}' is attached and ACTIVE!`);
    } else {
        console.error('\n⚠️ Worker Domain API Error:', data.errors);
    }
}

addWorkerDomain();
