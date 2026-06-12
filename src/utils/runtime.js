export const isLocalHost = () => {
    if (typeof window === 'undefined') return false;
    return ['localhost', '127.0.0.1'].includes(window.location.hostname);
};

export const isCloudHost = () => !isLocalHost();
