const accountId = '08f4a1647bc1230e867e4818b5aada0a';
const projectName = 'socialhub';
const zoneId = '35d51114b1e5cae6da558031413f3ebe';
const apiKey = 'cfk_8XQiA8F34ClevRpeqkllMAapCF7najJUJ1LOSBK8edf6885f';
const email = 'huzaimrosli@gmail.com';

async function updateDNSAndCheck() {
    // 1. Update CNAME to socialhub-4zl.pages.dev
    const dnsId = 'f7325149e01bd7f98a7c07e108ca2adb';
    console.log('🔄 Updating CNAME target to socialhub-4zl.pages.dev...');
    
    await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records/${dnsId}`, {
        method: 'PUT',
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

    // 2. Poll domain status
    console.log('🔍 Polling Pages Custom Domain SSL Validation status...');
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${projectName}/domains`;
    const res = await fetch(url, {
        headers: {
            'X-Auth-Email': email,
            'X-Auth-Key': apiKey,
            'Content-Type': 'application/json'
        }
    });
    const data = await res.json();
    const targetDomain = data.result.find(d => d.name === 'socialhub.kwikezee.my');
    console.log('Domain Status:', JSON.stringify(targetDomain, null, 2));
}

updateDNSAndCheck();
