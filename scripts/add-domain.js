const accountId = '08f4a1647bc1230e867e4818b5aada0a';
const projectName = 'socialhub';
const domainName = 'socialhub.kwikezee.my';
const apiKey = 'cfk_8XQiA8F34ClevRpeqkllMAapCF7najJUJ1LOSBK8edf6885f';
const email = 'huzaimrosli@gmail.com';

console.log(`🚀 Adding custom domain '${domainName}' to Pages project '${projectName}' via Cloudflare REST API...`);

async function run() {
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${projectName}/domains`;
    
    // Variation 1: Bearer Token
    console.log(`Attempting Variation 1 (Bearer Token)...`);
    let res = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name: domainName })
    });
    let data = await res.json();
    console.log('Response #1:', JSON.stringify(data, null, 2));

    if (data.success) {
        console.log(`\n🎉 SUCCESS! Custom domain '${domainName}' has been added!`);
        return;
    }

    // Variation 2: Global API Key (X-Auth-Email + X-Auth-Key)
    console.log(`\nAttempting Variation 2 (Global API Key)...`);
    res = await fetch(url, {
        method: 'POST',
        headers: {
            'X-Auth-Email': email,
            'X-Auth-Key': apiKey,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name: domainName })
    });
    data = await res.json();
    console.log('Response #2:', JSON.stringify(data, null, 2));

    if (data.success) {
        console.log(`\n🎉 SUCCESS! Custom domain '${domainName}' has been added to Cloudflare Pages!`);
    } else {
        console.error('\n⚠️ Errors:', data.errors);
    }
}

run();
