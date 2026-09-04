const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || '08f4a1647bc1230e867e4818b5aada0a';
const projectName = process.env.CLOUDFLARE_PROJECT_NAME || 'socialhub';
const domainName = process.env.CLOUDFLARE_DOMAIN_NAME || 'socialhub.kwikezee.my';
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

console.log(`🚀 Adding custom domain '${domainName}' to Pages project '${projectName}' via Cloudflare REST API...`);

async function run() {
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${projectName}/domains`;
    
    let res = await fetch(url, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ name: domainName })
    });
    let data = await res.json();
    console.log('Response:', JSON.stringify(data, null, 2));

    if (data.success) {
        console.log(`\n🎉 SUCCESS! Custom domain '${domainName}' has been added to Cloudflare Pages!`);
    } else {
        console.error('\n⚠️ Errors:', data.errors);
    }
}

run();
