/* SocialHub Session Management Service
   Handles JWT token storage, persistence preferences, and frontend route protection guards. */

const JWT_KEY = 'socialhub_jwt';

function parseJwt(token) {
    try {
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(atob(base64).split('').map(c => {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
        return JSON.parse(jsonPayload);
    } catch (e) {
        return null;
    }
}

export const sessionService = {
    /**
     * Store authentication token in storage
     * @param {string} token JWT token
     * @param {boolean} rememberMe Keep session persistent across browser restarts
     */
    saveToken(token, rememberMe) {
        this.clearToken();
        if (rememberMe) {
            localStorage.setItem(JWT_KEY, token);
        } else {
            sessionStorage.setItem(JWT_KEY, token);
        }
    },

    /**
     * Retrieve active authentication token
     * @returns {string|null} token
     */
    getToken() {
        return localStorage.getItem(JWT_KEY) || sessionStorage.getItem(JWT_KEY);
    },

    /**
     * Discard active session token
     */
    clearToken() {
        localStorage.removeItem(JWT_KEY);
        sessionStorage.removeItem(JWT_KEY);
    },

    /**
     * Local check for active and unexpired session
     * @returns {boolean}
     */
    isAuthenticated() {
        const token = this.getToken();
        if (!token) return false;
        
        const payload = parseJwt(token);
        if (!payload) return false;

        const currentTimestamp = Math.floor(Date.now() / 1000);
        if (payload.exp && payload.exp < currentTimestamp) {
            this.clearToken(); // Auto-clean expired token
            return false;
        }

        return true;
    },

    /**
     * Guard: Require authenticated user. Redirect to login.html if not.
     */
    requireAuth() {
        if (!this.isAuthenticated()) {
            console.warn('[SessionGuard] Unauthenticated access denied. Redirecting to login.html');
            window.location.replace('login.html');
        }
    },

    /**
     * Guard: Require guest status. Redirect to dashboard.html if user is logged in.
     */
    requireGuest() {
        if (this.isAuthenticated()) {
            console.log('[SessionGuard] Logged-in user redirected away from guest routes. Redirecting to dashboard.html');
            window.location.replace('dashboard.html');
        }
    }
};

export default sessionService;
