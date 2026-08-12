const accountId = '08f4a1647bc1230e867e4818b5aada0a';
const projectName = 'socialhub';
const apiKey = 'cfk_8XQiA8F34ClevRpeqkllMAapCF7najJUJ1LOSBK8edf6885f';
const email = 'huzaimrosli@gmail.com';

async function checkDomains() {
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${projectName}/domains`;
    const res = await fetch(url, {
        headers: {
            'X-Auth-Email': email,
            'X-Auth-Key': apiKey,
            'Content-Type': 'application/json'
        }
    });
    const data = await res.json();
    console.log('Pages Domains:', JSON.stringify(data, null, 2));

    // Also check DNS records for kwikezee.my
    const zoneId = '35d51114b1e5cae6da558031413f3ebe';
    const dnsRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records?name=socialhub.kwikezee.my`, {
        headers: {
            'X-Auth-Email': email,
            'X-Auth-Key': apiKey,
            'Content-Type': 'application/json'
        }
    });
    const dnsData = await dnsRes.json();
    console.log('\nDNS Records:', JSON.stringify(dnsData, null, 2));
}

checkDomains();
