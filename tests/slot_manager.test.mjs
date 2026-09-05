import assert from 'node:assert/strict';
import test from 'node:test';
import { SlotManager, STANDARD_SLOTS } from '../worker/src/services/scheduler/SlotManager.js';

function createMockDb(existingPosts = []) {
    return {
        prepare: (query) => ({
            bind: (...args) => ({
                all: async () => ({ results: existingPosts }),
                first: async () => existingPosts[0] || null,
                run: async () => ({ success: true })
            })
        })
    };
}

test('SlotManager - basic slots constants', () => {
    assert.deepEqual(STANDARD_SLOTS, [9, 12, 15, 18, 21]);
});

test('SlotManager - empty schedule returns first upcoming slot today', async () => {
    const mockDb = createMockDb([]);
    // Set simulated start time to 08:00 AM MYT (00:00 UTC) on 2026-09-05
    const simDate = new Date('2026-09-05T00:00:00.000Z');

    const result = await SlotManager.findNextAvailableSlot(mockDb, {
        workspaceId: 'ws-123',
        accountId: 'acc-fb-1',
        platform: 'facebook',
        startDate: simDate,
        timezone: 8
    });

    assert.equal(result.slotHour, 9);
    assert.equal(result.localDateStr, '2026-09-05');
    // 09:00 MYT is 01:00 UTC
    assert.equal(result.publishAt, '2026-09-05T01:00:00.000Z');
});

test('SlotManager - skips past slots for today', async () => {
    const mockDb = createMockDb([]);
    // Set simulated start time to 10:00 AM MYT (02:00 UTC) on 2026-09-05
    const simDate = new Date('2026-09-05T02:00:00.000Z');

    const result = await SlotManager.findNextAvailableSlot(mockDb, {
        workspaceId: 'ws-123',
        accountId: 'acc-fb-1',
        platform: 'facebook',
        startDate: simDate,
        timezone: 8
    });

    // 09:00 MYT has passed, next slot must be 12:00 PM MYT (04:00 UTC)
    assert.equal(result.slotHour, 12);
    assert.equal(result.localDateStr, '2026-09-05');
    assert.equal(result.publishAt, '2026-09-05T04:00:00.000Z');
});

test('SlotManager - Option 1: Per-Platform Slot-Filling (FB at 9am & 12pm -> FB gets 3pm, Threads gets 9am)', async () => {
    // Existing posts: FB has 09:00 AM and 12:00 PM on 2026-09-05
    const existingPosts = [
        {
            id: 1,
            account_id: 'acc-fb-1',
            platform: 'facebook',
            publish_at: '2026-09-05T01:00:00.000Z', // 09:00 MYT
            status: 'scheduled'
        },
        {
            id: 2,
            account_id: 'acc-fb-1',
            platform: 'facebook',
            publish_at: '2026-09-05T04:00:00.000Z', // 12:00 MYT
            status: 'scheduled'
        }
    ];

    const mockDb = createMockDb(existingPosts);
    // Simulating morning 08:00 AM MYT
    const simDate = new Date('2026-09-05T00:00:00.000Z');

    // 1. Check Threads slot
    const threadsSlot = await SlotManager.findNextAvailableSlot(mockDb, {
        workspaceId: 'ws-123',
        accountId: 'acc-th-1',
        platform: 'threads',
        startDate: simDate,
        timezone: 8
    });

    // Threads has no posts today, so it takes 09:00 AM MYT (01:00 UTC)
    assert.equal(threadsSlot.slotHour, 9);
    assert.equal(threadsSlot.publishAt, '2026-09-05T01:00:00.000Z');

    // 2. Check Facebook slot
    const fbSlot = await SlotManager.findNextAvailableSlot(mockDb, {
        workspaceId: 'ws-123',
        accountId: 'acc-fb-1',
        platform: 'facebook',
        startDate: simDate,
        timezone: 8
    });

    // FB already has 09:00 and 12:00, so FB intelligently fills 15:00 (3:00 PM MYT / 07:00 UTC)!
    assert.equal(fbSlot.slotHour, 15);
    assert.equal(fbSlot.publishAt, '2026-09-05T07:00:00.000Z');
});

test('SlotManager - Multi-channel 1-minute stagger when both accounts take the same slot', async () => {
    const mockDb = createMockDb([]);
    const simDate = new Date('2026-09-05T00:00:00.000Z'); // 08:00 AM MYT

    // Target 1: Threads (accIdx 0)
    const slot1 = await SlotManager.findNextAvailableSlot(mockDb, {
        workspaceId: 'ws-123',
        accountId: 'acc-th-1',
        platform: 'threads',
        startDate: simDate,
        timezone: 8,
        staggerMinutes: 0
    });

    // Target 2: Facebook (accIdx 1, staggerMinutes: 1)
    const slot2 = await SlotManager.findNextAvailableSlot(mockDb, {
        workspaceId: 'ws-123',
        accountId: 'acc-fb-1',
        platform: 'facebook',
        startDate: simDate,
        timezone: 8,
        staggerMinutes: 1
    });

    assert.equal(slot1.publishAt, '2026-09-05T01:00:00.000Z'); // 09:00:00 MYT
    assert.equal(slot2.publishAt, '2026-09-05T01:01:00.000Z'); // 09:01:00 MYT (+1 min stagger)
});

test('SlotManager - rolls over to tomorrow 09:00 AM when all slots today are filled', async () => {
    const allTodaySlots = [
        { id: 1, account_id: 'acc-1', platform: 'threads', publish_at: '2026-09-05T01:00:00.000Z', status: 'scheduled' }, // 09:00
        { id: 2, account_id: 'acc-1', platform: 'threads', publish_at: '2026-09-05T04:00:00.000Z', status: 'scheduled' }, // 12:00
        { id: 3, account_id: 'acc-1', platform: 'threads', publish_at: '2026-09-05T07:00:00.000Z', status: 'scheduled' }, // 15:00
        { id: 4, account_id: 'acc-1', platform: 'threads', publish_at: '2026-09-05T10:00:00.000Z', status: 'scheduled' }, // 18:00
        { id: 5, account_id: 'acc-1', platform: 'threads', publish_at: '2026-09-05T13:00:00.000Z', status: 'scheduled' }  // 21:00
    ];

    const mockDb = createMockDb(allTodaySlots);
    const simDate = new Date('2026-09-05T00:00:00.000Z'); // 08:00 AM MYT

    const result = await SlotManager.findNextAvailableSlot(mockDb, {
        workspaceId: 'ws-123',
        accountId: 'acc-1',
        platform: 'threads',
        startDate: simDate,
        timezone: 8
    });

    assert.equal(result.dayOffset, 1);
    assert.equal(result.localDateStr, '2026-09-06');
    assert.equal(result.slotHour, 9);
    assert.equal(result.publishAt, '2026-09-06T01:00:00.000Z'); // Tomorrow 09:00 AM MYT
});

test('SlotManager - In-memory batch reservations prevent internal collisions', async () => {
    const mockDb = createMockDb([]);
    const simDate = new Date('2026-09-05T00:00:00.000Z');
    const existingBookedSlots = [];

    // Schedule 3 campaign posts in a row for the same account
    const post1 = await SlotManager.findNextAvailableSlot(mockDb, {
        workspaceId: 'ws-123',
        accountId: 'acc-fb-1',
        platform: 'facebook',
        startDate: simDate,
        existingBookedSlots
    });
    existingBookedSlots.push({ accountId: 'acc-fb-1', platform: 'facebook', slotDate: post1.nominalSlotAt });

    const post2 = await SlotManager.findNextAvailableSlot(mockDb, {
        workspaceId: 'ws-123',
        accountId: 'acc-fb-1',
        platform: 'facebook',
        startDate: simDate,
        existingBookedSlots
    });
    existingBookedSlots.push({ accountId: 'acc-fb-1', platform: 'facebook', slotDate: post2.nominalSlotAt });

    const post3 = await SlotManager.findNextAvailableSlot(mockDb, {
        workspaceId: 'ws-123',
        accountId: 'acc-fb-1',
        platform: 'facebook',
        startDate: simDate,
        existingBookedSlots
    });

    assert.equal(post1.slotHour, 9);
    assert.equal(post2.slotHour, 12);
    assert.equal(post3.slotHour, 15);
});

test('SlotManager - allowedSlots restricts candidates (e.g. 1 post/day restricts to 09:00 AM only)', async () => {
    const mockDb = createMockDb([]);
    const simDate = new Date('2026-09-05T00:00:00.000Z'); // 08:00 AM MYT
    const existingBookedSlots = [];

    // First post takes 09:00 AM today
    const post1 = await SlotManager.findNextAvailableSlot(mockDb, {
        workspaceId: 'ws-123',
        accountId: 'acc-1',
        platform: 'threads',
        startDate: simDate,
        existingBookedSlots,
        allowedSlots: [9]
    });
    existingBookedSlots.push({ accountId: 'acc-1', platform: 'threads', slotDate: post1.nominalSlotAt });

    // Second post with allowedSlots = [9] must roll over to TOMORROW 09:00 AM (skipping 12pm, 3pm, 6pm, 9pm today!)
    const post2 = await SlotManager.findNextAvailableSlot(mockDb, {
        workspaceId: 'ws-123',
        accountId: 'acc-1',
        platform: 'threads',
        startDate: simDate,
        existingBookedSlots,
        allowedSlots: [9]
    });

    assert.equal(post1.slotHour, 9);
    assert.equal(post1.localDateStr, '2026-09-05');

    assert.equal(post2.slotHour, 9);
    assert.equal(post2.localDateStr, '2026-09-06');
});

test('SlotManager - fills remaining open standard slot today (21:00 PM) when candidate slots passed/occupied', async () => {
    // Scenario matching user's Saturday Sept 5 state:
    // Posts already booked at 12:00 PM, 3:00 PM, 6:00 PM
    const existingPosts = [
        { id: 1, account_id: 'acc-1', platform: 'threads', publish_at: '2026-09-05T04:00:00.000Z', status: 'scheduled' }, // 12:00 PM MYT
        { id: 2, account_id: 'acc-1', platform: 'threads', publish_at: '2026-09-05T07:00:00.000Z', status: 'scheduled' }, // 03:00 PM MYT
        { id: 3, account_id: 'acc-1', platform: 'threads', publish_at: '2026-09-05T10:00:00.000Z', status: 'scheduled' }  // 06:00 PM MYT
    ];

    const mockDb = createMockDb(existingPosts);
    // Simulating user at 11:53 AM MYT (03:53 UTC) on 2026-09-05
    const simDate = new Date('2026-09-05T03:53:00.000Z');

    // Generated with allowedSlots = [9] (1 Post/day)
    const result1Post = await SlotManager.findNextAvailableSlot(mockDb, {
        workspaceId: 'ws-123',
        accountId: 'acc-1',
        platform: 'threads',
        startDate: simDate,
        allowedSlots: [9]
    });

    // 09:00 AM passed, 12, 15, 18 occupied -> MUST fill 21:00 (9:00 PM) TODAY!
    assert.equal(result1Post.slotHour, 21);
    assert.equal(result1Post.localDateStr, '2026-09-05');
    assert.equal(result1Post.publishAt, '2026-09-05T13:00:00.000Z'); // 21:00 MYT is 13:00 UTC

    // Also verify with allowedSlots = [9, 12, 15] (3 Posts/day)
    const result3Post = await SlotManager.findNextAvailableSlot(mockDb, {
        workspaceId: 'ws-123',
        accountId: 'acc-1',
        platform: 'threads',
        startDate: simDate,
        allowedSlots: [9, 12, 15]
    });

    assert.equal(result3Post.slotHour, 21);
    assert.equal(result3Post.localDateStr, '2026-09-05');
    assert.equal(result3Post.publishAt, '2026-09-05T13:00:00.000Z');
});

test('SlotManager - Multi-post batch: Post 1 fills today 21:00 PM, Post 2 takes tomorrow 09:00 AM', async () => {
    const existingPosts = [
        { id: 1, account_id: 'acc-1', platform: 'threads', publish_at: '2026-09-05T04:00:00.000Z', status: 'scheduled' }, // 12:00 PM MYT
        { id: 2, account_id: 'acc-1', platform: 'threads', publish_at: '2026-09-05T07:00:00.000Z', status: 'scheduled' }, // 03:00 PM MYT
        { id: 3, account_id: 'acc-1', platform: 'threads', publish_at: '2026-09-05T10:00:00.000Z', status: 'scheduled' }  // 06:00 PM MYT
    ];

    const mockDb = createMockDb(existingPosts);
    const simDate = new Date('2026-09-05T03:53:00.000Z'); // 11:53 AM MYT
    const existingBookedSlots = [];

    // Post 1 with allowedSlots = [9]
    const post1 = await SlotManager.findNextAvailableSlot(mockDb, {
        workspaceId: 'ws-123',
        accountId: 'acc-1',
        platform: 'threads',
        startDate: simDate,
        existingBookedSlots,
        allowedSlots: [9]
    });
    existingBookedSlots.push({ accountId: 'acc-1', platform: 'threads', slotDate: post1.nominalSlotAt });

    // Post 2 in the same batch
    const post2 = await SlotManager.findNextAvailableSlot(mockDb, {
        workspaceId: 'ws-123',
        accountId: 'acc-1',
        platform: 'threads',
        startDate: simDate,
        existingBookedSlots,
        allowedSlots: [9]
    });

    // Post 1 should fill 21:00 PM today
    assert.equal(post1.slotHour, 21);
    assert.equal(post1.localDateStr, '2026-09-05');

    // Post 2 should roll over to TOMORROW 09:00 AM
    assert.equal(post2.slotHour, 9);
    assert.equal(post2.localDateStr, '2026-09-06');
});

test('SlotManager - findNextAvailableIntervalSlot schedules consecutive posts every 30 minutes', async () => {
    const mockDb = createMockDb([]);
    // Simulating 12:10 PM MYT (04:10 UTC)
    const simDate = new Date('2026-09-05T04:10:00.000Z');
    const existingBookedSlots = [];

    // URL Post 1
    const post1 = await SlotManager.findNextAvailableIntervalSlot(mockDb, {
        workspaceId: 'ws-123',
        accountId: 'acc-1',
        platform: 'threads',
        startDate: simDate,
        existingBookedSlots
    });
    existingBookedSlots.push({ accountId: 'acc-1', platform: 'threads', slotDate: post1.nominalSlotAt });

    // URL Post 2
    const post2 = await SlotManager.findNextAvailableIntervalSlot(mockDb, {
        workspaceId: 'ws-123',
        accountId: 'acc-1',
        platform: 'threads',
        startDate: simDate,
        existingBookedSlots
    });
    existingBookedSlots.push({ accountId: 'acc-1', platform: 'threads', slotDate: post2.nominalSlotAt });

    // URL Post 3
    const post3 = await SlotManager.findNextAvailableIntervalSlot(mockDb, {
        workspaceId: 'ws-123',
        accountId: 'acc-1',
        platform: 'threads',
        startDate: simDate,
        existingBookedSlots
    });

    // 12:10 PM + 15m minLead = 12:25 PM -> rounded up to next 30m = 12:30 PM MYT (04:30 UTC)
    assert.equal(post1.slotHour, 12);
    assert.equal(post1.slotMinute, 30);
    assert.equal(post1.publishAt, '2026-09-05T04:30:00.000Z');

    // Post 2 = +30m = 01:00 PM MYT (05:00 UTC)
    assert.equal(post2.slotHour, 13);
    assert.equal(post2.slotMinute, 0);
    assert.equal(post2.publishAt, '2026-09-05T05:00:00.000Z');

    // Post 3 = +30m = 01:30 PM MYT (05:30 UTC)
    assert.equal(post3.slotHour, 13);
    assert.equal(post3.slotMinute, 30);
    assert.equal(post3.publishAt, '2026-09-05T05:30:00.000Z');
});

test('SlotManager - findNextAvailableIntervalSlot avoids existing DB posts and respects quiet hours', async () => {
    // Existing post at 01:00 PM MYT (05:00 UTC)
    const existingPosts = [
        { id: 1, account_id: 'acc-1', platform: 'threads', publish_at: '2026-09-05T05:00:00.000Z', status: 'scheduled' }
    ];
    const mockDb = createMockDb(existingPosts);
    // Simulating 12:40 PM MYT (04:40 UTC)
    const simDate = new Date('2026-09-05T04:40:00.000Z');

    const post = await SlotManager.findNextAvailableIntervalSlot(mockDb, {
        workspaceId: 'ws-123',
        accountId: 'acc-1',
        platform: 'threads',
        startDate: simDate
    });

    // 12:40 + 15m = 12:55 -> 01:00 PM is occupied -> so it advances to 01:30 PM MYT (05:30 UTC)!
    assert.equal(post.slotHour, 13);
    assert.equal(post.slotMinute, 30);
    assert.equal(post.publishAt, '2026-09-05T05:30:00.000Z');

    // Test Quiet Hours: Simulating 11:45 PM MYT (15:45 UTC)
    const nightDate = new Date('2026-09-05T15:45:00.000Z');
    const nightPost = await SlotManager.findNextAvailableIntervalSlot(mockDb, {
        workspaceId: 'ws-123',
        accountId: 'acc-1',
        platform: 'threads',
        startDate: nightDate
    });

    // 11:45 PM + 15m is 12:00 AM midnight (quiet hours 00:00 - 08:00) -> jumps to 08:00 AM next morning!
    assert.equal(nightPost.slotHour, 8);
    assert.equal(nightPost.slotMinute, 0);
    assert.equal(nightPost.localDateStr, '2026-09-06');
    assert.equal(nightPost.publishAt, '2026-09-06T00:00:00.000Z'); // 08:00 AM MYT is 00:00 UTC
});



