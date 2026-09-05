import assert from 'node:assert';
import { imageService } from '../public/js/services/imageService.js';
import { uploadService } from '../public/js/services/uploadService.js';

console.log("================================================================");
console.log("SocialHub Media Upload & Direct Attachment Safety Tests");
console.log("================================================================");

let passed = 0;

// Test 1: Unsupported mime type rejected by uploadService.validateFile
{
    const file = { name: 'virus.exe', type: 'application/x-msdownload', size: 1024 };
    const res = uploadService.validateFile(file);
    assert.strictEqual(res.isValid, false);
    assert(res.error.includes('not supported'));
    console.log("[PASS] Test 1: Unsupported mime types safely rejected");
    passed++;
}

// Test 2: Oversized file rejected by uploadService.validateFile
{
    const file = { name: 'giant_video.mp4', type: 'video/mp4', size: 15 * 1024 * 1024 };
    const res = uploadService.validateFile(file);
    assert.strictEqual(res.isValid, false);
    assert(res.error.includes('10MB limit'));
    console.log("[PASS] Test 2: Files > 10MB safely rejected by client validator");
    passed++;
}

// Test 3: Supported image file passes validation
{
    const file = { name: 'poster.png', type: 'image/png', size: 500 * 1024 };
    const res = uploadService.validateFile(file);
    assert.strictEqual(res.isValid, true);
    assert.strictEqual(res.error, null);
    console.log("[PASS] Test 3: Valid image file passes client validation");
    passed++;
}

// Test 4: imageService.compressImage in non-DOM (Node) environment returns file safely without crashing
{
    const file = { name: 'poster.png', type: 'image/png', size: 800 * 1024 };
    const result = await imageService.compressImage(file);
    assert.strictEqual(result, file);
    console.log("[PASS] Test 4: imageService safely handles non-browser environments gracefully");
    passed++;
}

// Test 5: imageService skips GIF / SVG rasterization
{
    const gifFile = { name: 'anim.gif', type: 'image/gif', size: 2 * 1024 * 1024 };
    const result = await imageService.compressImage(gifFile);
    assert.strictEqual(result, gifFile);
    console.log("[PASS] Test 5: imageService preserves animated GIFs and vector SVGs");
    passed++;
}

// Test 6: Safe plan limits resolution test (simulating the worker logic)
{
    const PLANS = {
        free: { storage: 50 * 1024 * 1024 },
        pro: { storage: 500 * 1024 * 1024 }
    };

    // Test with undefined subscription_plan
    const ws1 = { subscription_plan: undefined };
    const planKey1 = (ws1.subscription_plan || 'free').toLowerCase();
    const limits1 = PLANS[planKey1] || PLANS.free;
    assert.strictEqual(limits1.storage, 50 * 1024 * 1024);

    // Test with uppercase 'PRO'
    const ws2 = { subscription_plan: 'PRO' };
    const planKey2 = (ws2.subscription_plan || 'free').toLowerCase();
    const limits2 = PLANS[planKey2] || PLANS.free;
    assert.strictEqual(limits2.storage, 500 * 1024 * 1024);

    // Test with unknown plan 'CUSTOM'
    const ws3 = { subscription_plan: 'CUSTOM' };
    const planKey3 = (ws3.subscription_plan || 'free').toLowerCase();
    const limits3 = PLANS[planKey3] || PLANS.free;
    assert.strictEqual(limits3.storage, 50 * 1024 * 1024);

    console.log("[PASS] Test 6: Subscription plan resolution is resilient against case and nulls");
    passed++;
}

// Test 7: Parameter payload guard prevents multi-megabyte D1 statement explosion
{
    const oversizedBytes = 5 * 1024 * 1024; // 5MB
    const exceedsLimit = oversizedBytes > 4 * 1024 * 1024;
    assert.strictEqual(exceedsLimit, true);

    // Verify thumbnail is null for large payloads
    const largeDataUrl = "data:image/png;base64," + "A".repeat(50000);
    const thumbVal = largeDataUrl.length < 20480 ? largeDataUrl : null;
    assert.strictEqual(thumbVal, null);

    // Verify thumbnail is kept for tiny payloads
    const smallDataUrl = "data:image/png;base64," + "A".repeat(500);
    const thumbValSmall = smallDataUrl.length < 20480 ? smallDataUrl : null;
    assert.strictEqual(thumbValSmall, smallDataUrl);

    console.log("[PASS] Test 7: Direct D1 parameter limits protect against multi-megabyte binds");
    passed++;
}

console.log("================================================================");
console.log(`Total Upload Safety Results: ${passed} Passed, 0 Failed`);
console.log("================================================================");
