const scrapedDescription = `WTS - Want To Sell 🟢

https://t.me/HussinAliHMPropertyListings/11002

❗️PRIME LOCATION
❗️SIZE BESAR
❗️TANAH BELAKANG LUAS 

2 Storey Terrace
Seksyen 11 Shah Alam

Details :
==============
-Leasehold Bumi 
-Land Size : 22x75
-Build up : 1,700 sqft approx
-4 Bedroom  2 Bathroom
-Tanah Luas Belakang
`;

const extractTelegramTitleFixed = (scrapedTitle, scrapedDescription) => {
    if (!scrapedDescription) return scrapedTitle || "";
    
    // Clean emojis and bullet markers from each line
    // Also strip variation selectors and heavy exclamation marks like ❗️ or ❗
    const rawLines = scrapedDescription.split('\n');
    const cleanLines = rawLines.map(l => l.replace(/[✅✨🏠📌🔥*‼️•⁠🏡❗️❗]/g, '').replace(/^[-–\s]+/, '').trim());

    // Priority 1: Find the main listing line containing property type + transaction type
    // e.g. "For Sale - Semi D Cluster Two Storey House SP 10 Bandar Saujana Putra"
    const mainListingRegex = /(?:For\s*Sale|WTS|WTL|For\s*Rent|Sewa|Jual).*(?:Storey|Tingkat|Terrace|Teres|Semi.?D|Bungalow|Banglo|Condo|Apartment|Pangsapuri|Flat|House|Rumah)/i;
    const mainLine = cleanLines.find(l => mainListingRegex.test(l));
    if (mainLine) {
        return mainLine.replace(/^(?:For\s*Sale|WTS|WTL|For\s*Rent|Sewa|Jual)\s*[-–:]?\s*/i, '').substring(0, 100).trim();
    }

    // Definitions
    const buildingTypeRegex = /\b(?:Storey|Tingkat|Sty|Terrace|Teres|Semi.?D|Bungalow|Banglo|Condo|Condominium|Kondominium|Apartment|Pangsapuri|Flat|Townhouse|House|Rumah|Suite|Office|Shoplot|Cluster)\b/i;
    const landTypeRegex = /\b(?:Land|Tanah|Lot)\b/i;
    const propertyTypeRegex = /\b(?:Storey|Tingkat|Sty|Terrace|Teres|Semi.?D|Bungalow|Banglo|Condo|Condominium|Kondominium|Apartment|Pangsapuri|Flat|Townhouse|House|Rumah|Suite|Office|Shoplot|Land|Tanah|Lot|Cluster)\b/i;
    
    const locationKeyword = /\b(?:Bandar|Taman|Pandan|Subang|Shah Alam|Petaling|Ampang|Rawang|Semenyih|Dengkil|Klang|Cheras|Setapak|Puchong|Serdang|Cyberjaya|Putrajaya|Kajang|Sepang|Sri|KL|Kuala Lumpur|Damansara|Kepong|Selayang|Batu|Seremban|Nilai|Alam|Perdana|Indah|Permai|Damai|Maju|Jaya|Murni|Harmoni|Saujana|Putra|Prima|Utama|Raya|Seksyen|BSP|SP\s*\d+)\b/i;

    // Sub-Priority 2a: Building Type AND Location
    const bestBuildingLine = cleanLines.find(l => buildingTypeRegex.test(l) && locationKeyword.test(l));
    if (bestBuildingLine) return bestBuildingLine.substring(0, 100).trim();

    // Sub-Priority 2b: Building Type alone (excluding bullet features containing words like 'luas', 'belakang' to avoid feature matching)
    const buildingAloneLine = cleanLines.find(l => l.length > 5 && buildingTypeRegex.test(l) && !/Asking\s*Price|ASKING|PRICE|Land\s*Area|Built\s*Up|Bedrooms|Bathrooms|sqft/i.test(l));
    if (buildingAloneLine) return buildingAloneLine.substring(0, 100).trim();

    // Sub-Priority 2c: Land/Tanah Type AND Location
    const bestLandLine = cleanLines.find(l => landTypeRegex.test(l) && locationKeyword.test(l));
    if (bestLandLine) return bestLandLine.substring(0, 100).trim();

    // Sub-Priority 2d: Land/Tanah Type alone (excluding bullet features containing 'luas', 'belakang' to avoid feature matching)
    const landAloneLine = cleanLines.find(l => l.length > 5 && landTypeRegex.test(l) && !/Luas|Belakang|Depan|Sisi|Tepi|Asking\s*Price|ASKING|PRICE|Land\s*Area|Built\s*Up|Bedrooms|Bathrooms|sqft/i.test(l));
    if (landAloneLine) return landAloneLine.substring(0, 100).trim();

    // Fallback to general property type if none of the above matched
    const anyTypeLine = cleanLines.find(l => l.length > 5 && propertyTypeRegex.test(l) && !/Asking\s*Price|ASKING|PRICE|Land\s*Area|Built\s*Up|Bedrooms|Bathrooms|sqft/i.test(l));
    if (anyTypeLine) return anyTypeLine.substring(0, 100).trim();

    // Priority 4: Fallback to first non-trivial line
    const firstLine = cleanLines.find(l => l.length > 10 && !/^\d+|MAHAFIZ|IQI|REN|PEA|NEARBY|DETAILS|EASY\s*ACCESS|ASKING|PRICE/i.test(l));
    return firstLine ? firstLine.substring(0, 100).trim() : (scrapedTitle || "");
};

console.log('Fixed Title extracted:', extractTelegramTitleFixed('', scrapedDescription));

let locationInfo = '';
// Horizontal whitespace check for explicit Location
const locMatch = scrapedDescription.match(/(?:Location|Lokasi|Located\s+at|Terletak\s+di)[ \t]*[:\-]?[ \t]*([^\n,]+)/i);
if (locMatch) {
    locationInfo = locMatch[1].trim();
} else {
    const areaKeywords = /\b(Bandar|Taman|Pandan|Subang|Shah Alam|Petaling|Ampang|Rawang|Semenyih|Dengkil|Klang|Cheras|Setapak|Puchong|Serdang|Cyberjaya|Putrajaya|Kajang|Sepang|Sri|Damansara|Kepong|Selayang|Batu|Seremban|Nilai|Saujana|Putra|Prima|Utama|BSP|SP\s*\d+)\b[\w\s]*/i;
    const lines = scrapedDescription.split('\n').map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
        const areaMatch = line.match(areaKeywords);
        if (areaMatch && areaMatch[0].length > 3) {
            // Get full line (excluding leading bullet characters) for richer location info
            locationInfo = line.replace(/^[✅✨🏠📌🔥*‼️•⁠🏡❗️❗\-–\s]+/, '').trim().substring(0, 50);
            break;
        }
    }
}
console.log('Fixed Location extracted:', locationInfo);
