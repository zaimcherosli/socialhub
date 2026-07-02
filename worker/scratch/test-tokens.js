const crypto = require('crypto');

// Decryption helper
async function decryptToken(encryptedText, secretKey) {
    if (!encryptedText) return null;
    try {
        const parts = encryptedText.split(':');
        const iv = Buffer.from(parts.shift(), 'hex');
        const encrypted = Buffer.from(parts.join(':'), 'hex');
        
        // Hash the secret key to ensure it is 32 bytes
        const key = crypto.createHash('sha256').update(String(secretKey)).digest();
        const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
        
        let decrypted = decipher.update(encrypted);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        return decrypted.toString();
    } catch (e) {
        console.error('Decryption failed:', e.message);
        return null;
    }
}

async function run() {
    const encryptedThreadsToken = process.argv[2];
    const encryptedFbToken = process.argv[3];
    
    // Test secrets
    const defaultSecret = "socialhub-dev-super-secret-key-12345!@#";
    
    console.log("Decrypting Threads token...");
    const threadsToken = await decryptToken(encryptedThreadsToken, defaultSecret);
    console.log("Decrypted Threads token:", threadsToken ? (threadsToken.substring(0, 15) + "...") : "Failed");
    
    console.log("Decrypting FB token...");
    const fbToken = await decryptToken(encryptedFbToken, defaultSecret);
    console.log("Decrypted FB token:", fbToken ? (fbToken.substring(0, 15) + "...") : "Failed");
    
    if (threadsToken) {
        console.log("Testing Threads token validity with Graph API...");
        const res = await fetch("https://graph.threads.net/v1.0/me?fields=id,username", {
            headers: { 'Authorization': `Bearer ${threadsToken}` }
        });
        const data = await res.json();
        console.log("Threads Response:", res.status, data);
    }
    
    if (fbToken) {
        console.log("Testing Facebook token validity with Graph API...");
        const res = await fetch("https://graph.facebook.com/v18.0/me?fields=id,name", {
            headers: { 'Authorization': `Bearer ${fbToken}` }
        });
        const data = await res.json();
        console.log("Facebook Response:", res.status, data);
        
        if (res.ok) {
            console.log("Fetching managed Facebook pages...");
            const pagesRes = await fetch(`https://graph.facebook.com/v18.0/me/accounts?access_token=${fbToken}`);
            const pagesData = await pagesRes.json();
            console.log("Facebook Pages:", pagesRes.status, pagesData);
        }
    }
}

run();
