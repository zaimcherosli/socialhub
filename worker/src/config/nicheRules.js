export const SYSTEM_NICHE_RULES = {
    hartanah: {
        name: "Ejen Hartanah & Properti",
        detectionKeywords: ["rumah", "apartment", "condo", "tanah", "teres", "semi-d", "saujana", "hartanah", "listing", "sale", "rent", "kondo", "bilik", "sewa", "jual", "flat", "bungalow", "banglo", "saujana putra", "wangsa melawati", "wangsa ceria", "dengkil"],
        rules: [
            "You MUST include the property price (e.g. RM 325,000 or RM 325k) in the copywriting to attract buyers.",
            "Focus on the actual property details (type, location, size/sqft, features, facilities) from the product info.",
            "NEVER include any phone numbers (e.g. 017-xxx xxxx), agent names, PEA/REN numbers, or agency names (e.g. IQI Realty) in the caption or CTA. The only contact method is via the link provided separately.",
            "For real estate/properties, include specific hashtags based on transaction type (e.g. #jualbelirumah #jualrumah #rumahsewa #rumahuntukdijual)."
        ]
    },
    affiliate: {
        name: "Affiliate Shopee/TikTok/Lazada",
        detectionKeywords: ["shopee", "lazada", "tiktok shop", "beli di", "beg kuning", "racun shopee", "racun tiktok", "murah gila", "diskaun", "voucher", "promo", "gadget", "barang dapur"],
        rules: [
            "DO NOT include the price (e.g. RMxx) in the copywriting. Keep the price secret to make the audience curious so they click the link.",
            "Write in a highly engaging, casual, and conversational style (Manglish / Bahasa Rojak) to recommend the product naturally.",
            "Use conversational hooks that capture attention instantly (e.g. 'Korang yang selalu workout tu wajib tengok ni...', 'Giler ah, tak sangka ada item ni...').",
            "Focus on benefits and pain points solved by the product."
        ]
    },
    automotif: {
        name: "Ejen Jual Kereta / Motor",
        detectionKeywords: ["kereta", "car", "perodua", "proton", "honda", "toyota", "bulanan", "loan", "trade-in", "deposit", "full loan", "myvi", "bezza", "saga", "alza", "x50"],
        rules: [
            "Focus on low monthly installments (bayaran bulanan), rebates, or free gifts.",
            "Highlight easy loan approvals, full loan availability, or fast trade-in deals.",
            "Use a professional yet friendly and accessible tone.",
            "Encourage users to check their loan eligibility as the main hook/CTA."
        ]
    }
};
