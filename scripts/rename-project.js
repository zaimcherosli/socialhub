const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || '08f4a1647bc1230e867e4818b5aada0a';
const oldProjectName = process.env.CLOUDFLARE_OLD_PROJECT_NAME || 'socialhub';
const newProjectName = process.env.CLOUDFLARE_NEW_PROJECT_NAME || 'socialhub-kwikezee';
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

console.log(`🚀 Renaming Pages project from '${oldProjectName}' to '${newProjectName}'...`);

async function renameProject() {
    // API endpoint to update pages project configuration/name
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${oldProjectName}`;
    const res = await fetch(url, {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({
            name: newProjectName
        })
    });

    const data = await res.json();
    console.log('API Response:', JSON.stringify(data, null, 2));

    if (data.success) {
        console.log(`\n🎉 SUCCESS! Cloudflare Pages project renamed to '${newProjectName}'!`);
        console.log(`New fallback domain: https://${newProjectName}.pages.dev`);
    } else {
        console.error('\n⚠️ Rename API Error:', data.errors);
    }
}

renameProject();
