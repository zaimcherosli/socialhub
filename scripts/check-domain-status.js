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

async function checkDomains() {
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${projectName}/domains`;
    const res = await fetch(url, {
        headers: getAuthHeaders()
    });
    const data = await res.json();
    console.log('Pages Domains:', JSON.stringify(data, null, 2));

    // Also check DNS records for kwikezee.my
    const dnsRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records?name=socialhub.kwikezee.my`, {
        headers: getAuthHeaders()
    });
    const dnsData = await dnsRes.json();
    console.log('\nDNS Records:', JSON.stringify(dnsData, null, 2));
}

checkDomains();
