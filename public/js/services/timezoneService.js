/* SocialHub Timezone Conversion & Formatting Service
   Translates UTC timestamps stored in D1 database into formatted local client representations. */

export const timezoneService = {
    /**
     * Get active resolved timezone on the browser device
     * @returns {string} e.g. 'Asia/Kuala_Lumpur', 'America/New_York'
     */
    getUserTimezone() {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    },

    /**
     * Convert local HTML input date string (YYYY-MM-DDTHH:MM) to UTC ISO8601 string
     * @param {string} localDateStr 
     * @returns {string} ISO8601 UTC string
     */
    localToUtc(localDateStr) {
        if (!localDateStr) return '';
        const date = new Date(localDateStr);
        return isNaN(date.getTime()) ? '' : date.toISOString();
    },

    /**
     * Convert UTC ISO8601 string to HTML input datetime-local string (YYYY-MM-DDTHH:MM)
     * @param {string} utcStr 
     * @returns {string} Local date string
     */
    utcToLocalInputFormat(utcStr) {
        if (!utcStr) return '';
        const date = new Date(utcStr);
        if (isNaN(date.getTime())) return '';

        const pad = (n) => String(n).padStart(2, '0');
        const yyyy = date.getFullYear();
        const mm = pad(date.getMonth() + 1);
        const dd = pad(date.getDate());
        const hh = pad(date.getHours());
        const min = pad(date.getMinutes());

        return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
    },

    /**
     * Formats UTC ISO8601 dates nicely with local timezone labels
     * @param {string} utcStr 
     * @param {object} options custom formatting configs
     * @returns {string} Legible display date
     */
    formatUtcToLocal(utcStr, options = {}) {
        if (!utcStr) return 'Not yet attempted';
        
        try {
            const date = new Date(utcStr);
            if (isNaN(date.getTime())) return 'Invalid Date';

            const defaultOptions = {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                timeZoneName: 'short',
                ...options
            };

            return date.toLocaleDateString(undefined, defaultOptions);
        } catch (e) {
            return 'Invalid Date';
        }
    }
};

export default timezoneService;
