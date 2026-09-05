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
