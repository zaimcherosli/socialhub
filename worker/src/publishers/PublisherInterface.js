/**
 * SocialHub Publisher Interface Class
 * Defines the strict interface signature that every platform provider class must implement.
 */
export class PublisherInterface {
    async connect(credentials) {
        throw new Error("connect() not implemented");
    }

    async disconnect(credentials) {
        throw new Error("disconnect() not implemented");
    }

    async publish(post, credentials) {
        throw new Error("publish() not implemented");
    }

    async validate(post) {
        throw new Error("validate() not implemented");
    }

    async refreshToken(token) {
        throw new Error("refreshToken() not implemented");
    }
}

export default PublisherInterface;
