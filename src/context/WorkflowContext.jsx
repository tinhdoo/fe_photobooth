import { createContext, useContext, useState, useEffect } from 'react';
import { getDeviceId, getDeviceName, setDeviceName } from '../utils/deviceId';
import { isSupabaseBrowserConfigured, supabase } from '../services/supabaseClient';
import { API_URL, CLOUD_API_URL } from '../config/api';
const WorkflowContext = createContext();
const isLocalApp = () => typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname);
const apiPath = (path) => `${API_URL}${path}`;
const cloudApiPath = (path) => `${CLOUD_API_URL}${path}`;
const CONFIG_CACHE_KEY = 'ptb_configs_cache';
const CLOUD_SYNC_KEYS = [
    'price', 'print_price', 'mobile_price', 'mobile_print_price', 'price_schedule',
    'session_timeout', 'mobile_session_timeout', 'countdown', 'hotfolder_capture_timeout', 'canon_capture_timeout',
    'bg_welcome', 'bg_source-selection', 'bg_choose-slot', 'bg_select-photo-number', 'bg_payment', 'bg_payment-wait',
    'bg_select-photo', 'bg_filter-adjustment', 'bg_preview-when', 'bg_print-photo', 'bg_wait-print-photo', 'bg_qr-photo',
    'brand_text_primary', 'brand_text_secondary'
];

const DEFAULT_CONFIGS = {
    price: 60000,
    print_price: 20000,
    mobile_price: 30000,
    mobile_print_price: 10000,
    session_timeout: 600,
    mobile_session_timeout: 300,
    countdown: 5,
    hotfolder_capture_timeout: 30,
    canon_capture_timeout: 30,
    camera_mode: 'webcam',
    hot_folder: 'C:/Photobooth_Input',
    staff_pin: '8888',
    print_brightness: 0,
    print_contrast: 0,
    print_saturation: 0,
    print_pink: 8,
    print_skin_whitening: 6,
    print_warmth: 2,
    price_schedule: '[]',
};

const normalizeConfigs = (nextConfigs = {}, fallback = DEFAULT_CONFIGS) => ({
    ...fallback,
    ...nextConfigs,
    price: parseInt(nextConfigs.price ?? fallback.price) || DEFAULT_CONFIGS.price,
    print_price: parseInt(nextConfigs.print_price ?? fallback.print_price) || DEFAULT_CONFIGS.print_price,
    mobile_price: parseInt(nextConfigs.mobile_price ?? fallback.mobile_price) || DEFAULT_CONFIGS.mobile_price,
    mobile_print_price: parseInt(nextConfigs.mobile_print_price ?? fallback.mobile_print_price) || DEFAULT_CONFIGS.mobile_print_price,
    session_timeout: parseInt(nextConfigs.session_timeout ?? fallback.session_timeout) || DEFAULT_CONFIGS.session_timeout,
    mobile_session_timeout: parseInt(nextConfigs.mobile_session_timeout ?? fallback.mobile_session_timeout) || DEFAULT_CONFIGS.mobile_session_timeout,
    countdown: parseInt(nextConfigs.countdown ?? fallback.countdown) || DEFAULT_CONFIGS.countdown,
    hotfolder_capture_timeout: parseInt(nextConfigs.hotfolder_capture_timeout ?? fallback.hotfolder_capture_timeout) || DEFAULT_CONFIGS.hotfolder_capture_timeout,
    canon_capture_timeout: parseInt(nextConfigs.canon_capture_timeout ?? fallback.canon_capture_timeout) || DEFAULT_CONFIGS.canon_capture_timeout,
    camera_mode: nextConfigs.camera_mode || fallback.camera_mode || DEFAULT_CONFIGS.camera_mode,
    hot_folder: nextConfigs.hot_folder || fallback.hot_folder || DEFAULT_CONFIGS.hot_folder,
    staff_pin: String(nextConfigs.staff_pin || fallback.staff_pin || DEFAULT_CONFIGS.staff_pin),
    print_brightness: parseInt(nextConfigs.print_brightness ?? fallback.print_brightness) || 0,
    print_contrast: parseInt(nextConfigs.print_contrast ?? fallback.print_contrast) || 0,
    print_saturation: parseInt(nextConfigs.print_saturation ?? fallback.print_saturation) || 0,
    print_pink: parseInt(nextConfigs.print_pink ?? fallback.print_pink) || 0,
    print_skin_whitening: parseInt(nextConfigs.print_skin_whitening ?? fallback.print_skin_whitening) || 0,
    print_warmth: parseInt(nextConfigs.print_warmth ?? fallback.print_warmth) || 0,
    price_schedule: nextConfigs.price_schedule ?? fallback.price_schedule ?? DEFAULT_CONFIGS.price_schedule,
});

const readCachedConfigs = () => {
    if (typeof window === 'undefined') return {};
    try {
        return JSON.parse(localStorage.getItem(CONFIG_CACHE_KEY) || '{}');
    } catch {
        return {};
    }
};

const cacheConfigs = (configs) => {
    if (typeof window === 'undefined') return;
    try {
        localStorage.setItem(CONFIG_CACHE_KEY, JSON.stringify(configs));
    } catch {
        // Ignore storage quota/private mode errors.
    }
};

const sameConfig = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export const WorkflowProvider = ({ children }) => {
    const [currentStep, setCurrentStep] = useState(1);
    const [sessionData, setSessionData] = useState({
        layout: null,
        photos: [],
        paymentMethod: null, // 'cash', 'qr', 'code'
        paymentStatus: 'pending', // 'pending', 'completed'
        selectedFilters: {},
        finalImage: null,
        printQuantity: 1,
        printPrice: 60000,
        capturedPhotos: [], // Stable inventory of all taken photos
        activeSlot: null, // Track which slot is being edited
        source: null, // 'camera' or 'upload' - Bổ sung nguồn ảnh
    });


    // Dynamic Configs
    const [configs, setConfigs] = useState(() => normalizeConfigs(readCachedConfigs()));

    const fetchConfigs = async () => {
        try {
            if (!API_URL && !CLOUD_API_URL && !isLocalApp()) return;
            let res = null;
            let configData = null;

            if (API_URL || isLocalApp()) {
                res = await fetch(`${apiPath('/api/config')}?t=${Date.now()}`, { cache: 'no-store' });
                if (res.ok) configData = await res.json();
            }

            if (isLocalApp() && CLOUD_API_URL) {
                const cloudRes = await fetch(`${cloudApiPath('/api/config')}?t=${Date.now()}`, { cache: 'no-store' });
                if (cloudRes.ok) {
                    const cloudData = await cloudRes.json();
                    const syncedConfig = {};
                    CLOUD_SYNC_KEYS.forEach((key) => {
                        if (cloudData[key] !== undefined) syncedConfig[key] = cloudData[key];
                    });

                    if (Object.keys(syncedConfig).length) {
                        configData = { ...(configData || {}), ...syncedConfig };
                        fetch(apiPath('/api/config'), {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(syncedConfig),
                        }).catch((error) => console.error('Failed to sync cloud price config:', error));
                    }
                }
            }

            if (!configData && (!res || !res.ok) && CLOUD_API_URL) {
                res = await fetch(`${cloudApiPath('/api/config')}?t=${Date.now()}`, { cache: 'no-store' });
                if (res.ok) configData = await res.json();
            }

            if (configData) {
                const data = configData;
                setConfigs(prev => {
                    const normalized = normalizeConfigs(data, prev);
                    if (sameConfig(prev, normalized)) return prev;
                    cacheConfigs(normalized);
                    return normalized;
                });
            }
        } catch (error) {
            console.error("Failed to load configs:", error);
        }
    };

    const applyRemoteConfigs = (nextConfigs = {}) => {
        setConfigs(prev => {
            const normalized = normalizeConfigs(nextConfigs, prev);
            if (sameConfig(prev, normalized)) return prev;
            cacheConfigs(normalized);
            return normalized;
        });
    };

    useEffect(() => {
        fetchConfigs();

        let fallbackInterval = null;
        let realtimeReady = false;
        let channel = null;

        if (isSupabaseBrowserConfigured && supabase) {
            channel = supabase
                .channel('app-configs-realtime')
                .on(
                    'postgres_changes',
                    { event: '*', schema: 'public', table: 'app_configs', filter: 'key=eq.app' },
                    (payload) => {
                        const nextConfig = payload.new?.config;
                        if (nextConfig && typeof nextConfig === 'object') {
                            applyRemoteConfigs(nextConfig);
                        } else {
                            fetchConfigs();
                        }
                    }
                )
                .subscribe((status) => {
                    realtimeReady = status === 'SUBSCRIBED';
                });
        }

        fallbackInterval = setInterval(() => {
            if (realtimeReady || document.visibilityState !== 'visible') return;
            fetchConfigs();
        }, isLocalApp() ? 60000 : 300000);

        const handleFocus = () => fetchConfigs();
        window.addEventListener('focus', handleFocus);

        return () => {
            clearInterval(fallbackInterval);
            window.removeEventListener('focus', handleFocus);
            if (channel && supabase) supabase.removeChannel(channel);
        };
    }, []);

    // Initialize mode from localStorage (fallback)
    const [isEventMode, setIsEventMode] = useState(false);

    // Device Management
    useEffect(() => {
        // Only run device heartbeat for Photobooth and Admin, not public viewers/uploaders
        const ignorePaths = ['/album/', '/m/upload/'];
        if (ignorePaths.some(p => window.location.pathname.startsWith(p))) {
            return;
        }

        const deviceId = getDeviceId();

        const applyDeviceMode = (mode) => {
            setIsEventMode(prev => {
                const next = mode === 'event';
                return prev === next ? prev : next;
            });
        };

        const syncDevice = async () => {
            if (!API_URL && !isLocalApp()) return;

            let deviceName = getDeviceName();
            if (!deviceName) {
                deviceName = "Máy Chụp 1";
                setDeviceName(deviceName);
            }

            let activeDeviceId = deviceId;
            try {
                const sysRes = await fetch(apiPath('/api/config/system'));
                if (sysRes.ok) {
                    const sysData = await sysRes.json();
                    if (sysData.device_id) {
                        activeDeviceId = sysData.device_id;
                        localStorage.setItem("device_id", activeDeviceId);
                        localStorage.setItem("DEVICE_ID", activeDeviceId);
                    }
                }
            } catch (error) {
                console.warn("Could not fetch system device_id, using fallback", error);
            }

            try {
                // Initial registration / sync on the local backend.
                const res = await fetch(apiPath('/api/devices/heartbeat'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ deviceId: activeDeviceId, name: deviceName })
                });

                if (res.ok) {
                    const data = await res.json();
                    applyDeviceMode(data.mode);
                }
            } catch (error) {
                console.error("Device sync failed:", error);
                // Fallback to local setting if offline
                setIsEventMode(localStorage.getItem('BOOTH_MODE') === 'event');
            }

            if (CLOUD_API_URL) {
                try {
                    const cloudRes = await fetch(`${CLOUD_API_URL}/api/devices`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action: 'heartbeat', deviceId: activeDeviceId, name: deviceName })
                    });
                    if (cloudRes.ok) {
                        const data = await cloudRes.json();
                        applyDeviceMode(data.mode);
                    }
                } catch (error) {
                    console.warn("Cloud device sync failed:", error);
                }
            }
        };

        syncDevice();
        const interval = setInterval(syncDevice, 60000);

        let channel = null;
        if (isSupabaseBrowserConfigured && supabase) {
            channel = supabase
                .channel(`device-mode-${deviceId}`)
                .on(
                    'postgres_changes',
                    {
                        event: '*',
                        schema: 'public',
                        table: 'devices',
                        filter: `device_id=eq.${deviceId}`
                    },
                    (payload) => {
                        const row = payload.new || payload.old;
                        if (row?.mode) applyDeviceMode(row.mode);
                    }
                )
                .subscribe();
        }

        return () => {
            clearInterval(interval);
            if (channel && supabase) supabase.removeChannel(channel);
        };
    }, []);

    const toggleEventMode = () => {
        // This is now just a local optimistic update, 
        // ideally real toggle happens via Admin API
        const newMode = !isEventMode;
        setIsEventMode(newMode);
        localStorage.setItem('BOOTH_MODE', newMode ? 'event' : 'payment');
    };

    const nextStep = () => {
        setCurrentStep((prev) => {
            // Từ Welcome (1) -> Source Selection (1.5)
            if (prev === 1) return 1.5;

            // Từ Source Selection (1.5) -> Layout Selection (2)
            if (prev === 1.5) return 2;

            // Payment Mode: Insert Quantity step between Layout (2) and Payment (3)
            if (!isEventMode && prev === 2) return 2.5; // Go to Quantity
            if (!isEventMode && prev === 2.5) return 3; // Go to Payment

            // Event Mode: Skip both Quantity and Payment
            if (isEventMode && prev === 2) return 4; // Skip directly to Capture

            // Upload flow: Skip Review (step 5), go directly to Edit (step 6)
            if (prev === 4 && sessionData.source === 'upload') return 6;

            return Math.min(prev + 1, 7);
        });
    };

    const prevStep = () => {
        setCurrentStep((prev) => {
            // Payment Mode: Handle Quantity step
            if (!isEventMode && prev === 3) return 2.5; // From Payment back to Quantity
            if (!isEventMode && prev === 2.5) return 2; // From Quantity back to Layout

            // Event Mode: Skip back over quantity and payment
            if (isEventMode && prev === 4) return 2; // From Capture back to Layout

            // Từ Layout (2) quay lại Source Selection (1.5)
            if (prev === 2) return 1.5;
            // Từ Source Selection (1.5) quay lại Welcome (1)
            if (prev === 1.5) return 1;

            return Math.max(prev - 1, 1);
        });
    };

    const goToStep = (step) => setCurrentStep(step);

    // Session Timer
    const SESSION_DURATION = sessionData.source === 'upload'
        ? configs.mobile_session_timeout
        : configs.session_timeout;
    const [timeLeft, setTimeLeft] = useState(SESSION_DURATION);
    const [isSessionActive, setIsSessionActive] = useState(false);
    // Cờ BỀN VỮNG: phiên đã hết giờ. Giữ true tới hết flow để CHUỖI auto-chuyển-bước + auto-in
    // không bị đứt (isSessionActive tắt ngay khi hết giờ, không dùng để gate các bước được).
    const [timedOut, setTimedOut] = useState(false);

    // Start timer when payment is completed — read configs fresh at this moment
    useEffect(() => {
        if (sessionData.paymentStatus === 'completed' && !isSessionActive) {
            const freshDuration = sessionData.source === 'upload'
                ? configs.mobile_session_timeout
                : configs.session_timeout;
            setIsSessionActive(true);
            setTimedOut(false);
            setTimeLeft(freshDuration);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionData.paymentStatus]);

    // Timer Countdown
    useEffect(() => {
        if (!isSessionActive) return undefined;

        const interval = setInterval(() => {
            setTimeLeft((prev) => Math.max(0, prev - 1));
        }, 1000);

        return () => clearInterval(interval);
    }, [isSessionActive]);

    useEffect(() => {
        if (timeLeft === 0 && isSessionActive) {
            setIsSessionActive(false); // dừng đếm giờ
            setTimedOut(true);         // ...nhưng đánh dấu đã hết giờ để các bước tự hoàn tất + in
        }
    }, [timeLeft, isSessionActive]);

    const resetSession = () => {
        // Tự động tải lại trang để làm mới toàn bộ cài đặt (giá tiền, khung ảnh) và dọn dẹp bộ nhớ
        window.location.reload();
    };

    const updateSessionData = (key, value) => {
        setSessionData((prev) => ({ ...prev, [key]: value }));
    };

    const applyConfigs = (nextConfigs = {}) => {
        setConfigs(prev => {
            const normalized = normalizeConfigs(nextConfigs, prev);
            cacheConfigs(normalized);
            return normalized;
        });
    };

    return (
        <WorkflowContext.Provider
            value={{
                currentStep,
                sessionData,
                nextStep,
                prevStep,
                goToStep,
                resetSession,
                updateSessionData,
                isEventMode,
                toggleEventMode,
                timeLeft, // Expose timer
                isSessionActive,
                timedOut,
                SESSION_DURATION,
                configs, // Expose generic configs
                applyConfigs,
                refreshConfigs: fetchConfigs
            }}
        >
            {children}
        </WorkflowContext.Provider>
    );
};

export const useWorkflow = () => useContext(WorkflowContext);
