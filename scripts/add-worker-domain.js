const accountId = '08f4a1647bc1230e867e4818b5aada0a';
const zoneId = '35d51114b1e5cae6da558031413f3ebe';
const apiKey = 'cfk_8XQiA8F34ClevRpeqkllMAapCF7najJUJ1LOSBK8edf6885f';
const email = 'huzaimrosli@gmail.com';
const apiDomain = 'api.socialhub.kwikezee.my';
const serviceName = 'socialhub-api';

console.log(`🚀 Adding custom Worker domain '${apiDomain}' to Cloudflare Worker '${serviceName}'...`);

async function addWorkerDomain() {
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/domains`;
    const res = await fetch(url, {
        method: 'PUT',
        headers: {
            'X-Auth-Email': email,
            'X-Auth-Key': apiKey,
            'Content-Type': 'application/json'
        },
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
