/* SocialHub Editor Analysis & Undo/Redo Engine
   Provides text calculations (character counts, word counts, reading speeds) and history stack undo/redo operations. */

let undoStack = [];
let redoStack = [];
const MAX_STACK_DEPTH = 50;

export const editorService = {
    // ==================== TEXT METRICS ====================

    /**
     * Get length count of a string
     * @param {string} text 
     * @returns {number}
     */
    getCharacterCount(text) {
        return text ? text.length : 0;
    },

    /**
     * Extract count of words in a string
     * @param {string} text 
     * @returns {number}
     */
    getWordCount(text) {
        if (!text) return 0;
        const cleanText = text.trim().replace(/\s+/g, ' ');
        return cleanText ? cleanText.split(' ').length : 0;
    },

    /**
     * Estimate reading speed in minutes
     * @param {string} text 
     * @returns {number}
     */
    estimateReadingTime(text) {
        const words = this.getWordCount(text);
        // Average reading speed is 200 WPM
        return Math.max(1, Math.round(words / 200));
    },

    // ==================== TEXT REGEX PARSERS ====================

    /**
     * Regex identify URL strings
     * @param {string} text 
     * @returns {Array<string>} Matching URLs
     */
    detectUrls(text) {
        if (!text) return [];
        const urlRegex = /https?:\/\/[^\s$.?#].[^\s]*/gi;
        return text.match(urlRegex) || [];
    },

    /**
     * Regex identify hashtag strings
     * @param {string} text 
     * @returns {Array<string>} Matching hashtags
     */
    detectHashtags(text) {
        if (!text) return [];
        const hashtagRegex = /#[a-z0-9_]+/gi;
        return text.match(hashtagRegex) || [];
    },

    /**
     * Regex identify user @mentions
     * @param {string} text 
     * @returns {Array<string>} Matching mentions
     */
    detectMentions(text) {
        if (!text) return [];
        const mentionRegex = /@[a-z0-9_]+/gi;
        return text.match(mentionRegex) || [];
    },

    // ==================== UNDO / REDO HISTORY STACKS ====================

    /**
     * Reset history context
     * @param {object} initialState { title, caption, visibility }
     */
    resetHistory(initialState) {
        undoStack = [JSON.stringify(initialState)];
        redoStack = [];
    },

    /**
     * Record a new state snapshot
     * @param {object} state { title, caption, visibility }
     */
    pushState(state) {
        const stateStr = JSON.stringify(state);
        // Skip consecutive duplicate snapshots
        if (undoStack.length > 0 && undoStack[undoStack.length - 1] === stateStr) {
            return;
        }
        
        undoStack.push(stateStr);
        if (undoStack.length > MAX_STACK_DEPTH) {
            undoStack.shift();
        }
        
        redoStack = []; // Clear redo stack on new actions
        console.log('[EditorService] Recorded snapshot. Undo stack depth:', undoStack.length);
    },

    /**
     * Revert to previous recorded state
     * @param {object} currentState { title, caption, visibility }
     * @returns {object|null} Previous state object
     */
    undo(currentState) {
        if (undoStack.length <= 1) return null; // No state to undo to
        
        // Pop the current state and push to redo stack
        const current = undoStack.pop();
        redoStack.push(current);
        
        // Return the top of the stack
        const previousState = undoStack[undoStack.length - 1];
        return JSON.parse(previousState);
    },

    /**
     * Restore a previously reverted state
     * @returns {object|null} Restored state object
     */
    redo() {
        if (redoStack.length === 0) return null;
        
        const next = redoStack.pop();
        undoStack.push(next);
        
        return JSON.parse(next);
    }
};

export default editorService;
