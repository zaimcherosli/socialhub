const zoneId = '35d51114b1e5cae6da558031413f3ebe';
const apiKey = 'cfk_8XQiA8F34ClevRpeqkllMAapCF7najJUJ1LOSBK8edf6885f';
const email = 'huzaimrosli@gmail.com';

async function addWorkerDNS() {
    console.log('🌐 Adding CNAME DNS record for api.socialhub.kwikezee.my...');
    const url = `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records`;
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'X-Auth-Email': email,
            'X-Auth-Key': apiKey,
            'Content-Type': 'application/json'
        },
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
