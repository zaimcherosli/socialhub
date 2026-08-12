const zoneId = '35d51114b1e5cae6da558031413f3ebe';
const apiKey = 'cfk_8XQiA8F34ClevRpeqkllMAapCF7najJUJ1LOSBK8edf6885f';
const email = 'huzaimrosli@gmail.com';

console.log(`🌐 Creating CNAME DNS record for socialhub.kwikezee.my...`);

async function addDNS() {
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
            name: 'socialhub',
            content: 'socialhub-4zl.pages.dev',
            proxied: true
        })
    });
    const data = await res.json();
    console.log('DNS API Response:', JSON.stringify(data, null, 2));

    if (data.success || (data.errors && data.errors.some(e => e.code === 81057))) {
        console.log(`\n🎉 CNAME DNS record for 'socialhub.kwikezee.my' is ACTIVE & READY!`);
    } else {
        console.error('\n⚠️ DNS Error:', data.errors);
    }
}

addDNS();
