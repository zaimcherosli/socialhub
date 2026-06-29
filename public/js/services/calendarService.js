/* SocialHub Calendar Construction Service
   Calculates day counts, offsets, and compiles scheduled queue lists grouped by date indexes. */

export const calendarService = {
    /**
     * Compile day objects list representing monthly grid cells (padding from prev/next months)
     * @param {number} year 
     * @param {number} month 0-indexed (0 = Jan, 11 = Dec)
     * @returns {Array<object>} Day objects { date: Date, isCurrentMonth: boolean }
     */
    getMonthGridDays(year, month) {
        const firstDayOfMonth = new Date(year, month, 1);
        const lastDayOfMonth = new Date(year, month + 1, 0);

        const days = [];
        
        // Days of previous month required to pad the first week grid (Sunday starting)
        const prevMonthPaddingCount = firstDayOfMonth.getDay();
        for (let i = prevMonthPaddingCount; i > 0; i--) {
            const date = new Date(year, month, 1 - i);
            days.push({ date, isCurrentMonth: false });
        }

        // Days of current month
        const daysInMonth = lastDayOfMonth.getDate();
        for (let i = 1; i <= daysInMonth; i++) {
            const date = new Date(year, month, i);
            days.push({ date, isCurrentMonth: true });
        }

        // Days of next month padding to complete a 42-day calendar block (6 weeks)
        const remainingPaddingCount = 42 - days.length;
        for (let i = 1; i <= remainingPaddingCount; i++) {
            const date = new Date(year, month + 1, i);
            days.push({ date, isCurrentMonth: false });
        }

        return days;
    },

    /**
     * Group schedules by date key string (YYYY-MM-DD) in user's local timezone display
     * @param {Array<object>} schedules 
     * @returns {object} Date key mappings to schedules arrays
     */
    groupSchedulesByDate(schedules) {
        const groups = {};
        
        schedules.forEach(item => {
            if (!item.scheduled_at) return;
            
            try {
                const date = new Date(item.scheduled_at);
                if (isNaN(date.getTime())) return;
                
                // Extract local date key YYYY-MM-DD
                const yyyy = date.getFullYear();
                const mm = String(date.getMonth() + 1).padStart(2, '0');
                const dd = String(date.getDate()).padStart(2, '0');
                const dateKey = `${yyyy}-${mm}-${dd}`;
                
                if (!groups[dateKey]) {
                    groups[dateKey] = [];
                }
                groups[dateKey].push(item);
            } catch (e) {
                console.error('[CalendarService] Error grouping schedule:', e);
            }
        });

        return groups;
    }
};

export default calendarService;
