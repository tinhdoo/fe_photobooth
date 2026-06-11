
const DB_NAME = 'PhotoboothDB';
const STORE_NAME = 'session_store';
const VERSION = 1;

export const initDB = () => {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, VERSION);

        request.onerror = (event) => reject("DB error: " + event.target.error);

        request.onsuccess = (event) => resolve(event.target.result);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
    });
};

export const saveSessionToDB = async (sessionData, currentStep) => {
    try {
        // 1. Prepare Data (Fetch Blobs individually first)
        const dataToStore = JSON.parse(JSON.stringify(sessionData)); // Deep clone simple data

        // Manually handle Photos (which might be Blob URLs)
        if (sessionData.photos && sessionData.photos.length > 0) {
            dataToStore.photos = await Promise.all(sessionData.photos.map(async (p) => {
                if (typeof p === 'string' && p.startsWith('blob:')) {
                    try {
                        const res = await fetch(p);
                        const blob = await res.blob();
                        return blob;
                    } catch {
                        console.warn("Failed to fetch blob for persistence", p);
                        return null;
                    }
                }
                return p;
            }));
        }

        // Same for selectedPhotos in Review/Edit
        if (sessionData.selectedPhotos && sessionData.selectedPhotos.length > 0) {
            dataToStore.selectedPhotos = await Promise.all(sessionData.selectedPhotos.map(async (p) => {
                if (!p) return null;
                if (typeof p === 'string' && p.startsWith('blob:')) {
                    try {
                        const res = await fetch(p);
                        return await res.blob();
                    } catch { return null; }
                }
                return p;
            }));
        }

        // 2. Open DB and Transaction (Do this LAST to keep transaction short)
        const db = await initDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);

        // Put immediately
        await new Promise((resolve, reject) => {
            const req = store.put({
                id: 'current_session',
                data: dataToStore,
                step: currentStep,
                timestamp: Date.now()
            }, 'active_session');

            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });

        return true;
    } catch (error) {
        console.error("Save Session Error", error);
        return false;
    }
};

export const loadSessionFromDB = async () => {
    try {
        const db = await initDB();
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const result = await new Promise((resolve) => {
            const req = store.get('active_session');
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(null);
        });

        if (!result) return null;

        // Check timeout (e.g. 30 mins)
        if (Date.now() - result.timestamp > 30 * 60 * 1000) {
            // Expired
            return null;
        }

        // Convert Blobs back to URLs
        const data = result.data;
        if (data.photos) {
            data.photos = data.photos.map(p => {
                if (p instanceof Blob) return URL.createObjectURL(p);
                return p;
            });
        }
        if (data.selectedPhotos) {
            data.selectedPhotos = data.selectedPhotos.map(p => {
                if (p instanceof Blob) return URL.createObjectURL(p);
                return p;
            });
        }

        return { sessionData: data, currentStep: result.step };
    } catch (error) {
        console.error("Load Session Error", error);
        return null;
    }
};

export const clearSessionDB = async () => {
    try {
        const db = await initDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.delete('active_session');
    } catch (e) { console.error(e); }
};
