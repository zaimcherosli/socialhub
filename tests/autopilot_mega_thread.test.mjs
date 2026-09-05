import { test } from 'node:test';
import assert from 'node:assert';
import { AutopilotService } from '../worker/src/services/ai/AutopilotService.js';

test('AutopilotService - mega_thread batches 6 posts into 2 batches of 3 and sets max_tokens 8192', async () => {
    const promptsReceived = [];
    const mockProvider = {
        constructor: { name: 'OpenAIProvider' },
        model: 'gpt-4o-mini',
        _fetchChatCompletions: async ({ messages, max_tokens }) => {
            const userMsg = messages.find(m => m.role === 'user')?.content || '';
            promptsReceived.push({ userMsg, max_tokens });
            return {
                choices: [{
                    message: {
                        content: JSON.stringify([
                            {
                                caption: Array.from({ length: 8 }, (_, i) => `Slide ${i + 1} content here.`).join('\n---thread-separator---\n'),
                                cta: 'WhatsApp kami',
                                hashtags: ['#keretarecond']
                            },
                            {
                                caption: Array.from({ length: 7 }, (_, i) => `Slaid ${i + 1} info kereta.`).join('\n---thread-separator---\n'),
                                cta: 'Hubungi kami',
                                hashtags: ['#keretabaru']
                            },
                            {
                                caption: Array.from({ length: 9 }, (_, i) => `Slide ${i + 1} perbandingan.`).join('\n---thread-separator---\n'),
                                cta: 'Semak sekarang',
                                hashtags: ['#jimat']
                            }
                        ])
                    }
                }]
            };
        }
    };

    const service = new AutopilotService(mockProvider);
    const result = await service.generateAutopilotCampaign({
        niche: 'kereta recond dgn kereta baru apa bezanya?',
        targetAudience: 'bakal pembeli kereta recond',
        platform: 'threads',
        count: 6,
        language: 'Bahasa Melayu',
        frequency: 3,
        ctaLink: 'https://wa.me/60123456789',
        postFormat: 'mega_thread'
    });

    assert.strictEqual(result.length, 6);
    assert.strictEqual(promptsReceived.length, 2);
    assert.strictEqual(promptsReceived[0].max_tokens, 8192);
    assert(promptsReceived[0].userMsg.includes('strictly 7 to 10 thread posts/slides'));
    assert(promptsReceived[0].userMsg.includes('---thread-separator---'));

    result.forEach((post, i) => {
        const slides = post.content.split('---thread-separator---');
        assert(slides.length >= 7, `Post #${i + 1} must have at least 7 slides`);
        assert(post.content.includes('wa.me/60123456789'));
    });
});

test('AutopilotService - handles array caption and fallback labeled slides', async () => {
    const mockProvider = {
        constructor: { name: 'OpenAIProvider' },
        model: 'gpt-4o-mini',
        _fetchChatCompletions: async () => ({
            choices: [{
                message: {
                    content: JSON.stringify([
                        {
                            caption: ['Slide 1', 'Slide 2', 'Slide 3', 'Slide 4', 'Slide 5', 'Slide 6', 'Slide 7', 'Slide 8'],
                            cta: 'Contact',
                            hashtags: []
                        },
                        {
                            caption: 'Slide 1: Intro\nSlide 2: Detail 1\nSlide 3: Detail 2\nSlide 4: Detail 3\nSlide 5: Detail 4\nSlide 6: Detail 5\nSlide 7: Outro',
                            cta: '',
                            hashtags: []
                        }
                    ])
                }
            }]
        })
    };

    const service = new AutopilotService(mockProvider);
    const res = await service.generateAutopilotCampaign({
        niche: 'automotif',
        targetAudience: 'umum',
        platform: 'threads',
        count: 2,
        frequency: 1,
        ctaLink: '',
        postFormat: 'mega_thread'
    });

    assert.strictEqual(res.length, 2);
    assert.strictEqual(res[0].content.split('---thread-separator---').length, 8);
    assert.strictEqual(res[1].content.split('---thread-separator---').length, 7);
});
