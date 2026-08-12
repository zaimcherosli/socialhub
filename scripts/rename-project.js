const accountId = '08f4a1647bc1230e867e4818b5aada0a';
const oldProjectName = 'socialhub';
const newProjectName = 'socialhub-kwikezee';
const apiKey = 'cfk_8XQiA8F34ClevRpeqkllMAapCF7najJUJ1LOSBK8edf6885f';
const email = 'huzaimrosli@gmail.com';

console.log(`🚀 Renaming Pages project from '${oldProjectName}' to '${newProjectName}'...`);

async function renameProject() {
    // API endpoint to update pages project configuration/name
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${oldProjectName}`;
    const res = await fetch(url, {
        method: 'PATCH',
        headers: {
            'X-Auth-Email': email,
            'X-Auth-Key': apiKey,
            'Content-Type': 'application/json'
        },
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
