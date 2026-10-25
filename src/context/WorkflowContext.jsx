import { createContext, useCallback, useContext, useState, useEffect, useRef } from 'react';
import { getDeviceId, getDeviceName, setDeviceName } from '../utils/deviceId';
import { isSupabaseBrowserConfigured, supabase } from '../services/supabaseClient';
import { API_URL, CLOUD_API_URL } from '../config/api';
import { guiLaiInThemConKet } from '../utils/inThem';
const WorkflowContext = createContext();
const isLocalApp = () => typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname);
const apiPath = (path) => `${API_URL}${path}`;
const cloudApiPath = (path) => `${CLOUD_API_URL}${path}`;

// Promise upload ảnh gốc/video ở NỀN (Edit đặt sau khi hiện QR). resetSession sẽ CHỜ promise
// này xong (có trần thời gian) trước khi reload -> không mất ảnh lẻ/video nếu khách bấm "Về
// trang chủ" hoặc hết giờ trước khi upload nền hoàn tất.
let pendingMediaUpload = null;
export const setPendingMediaUpload = (promise) => { pendingMediaUpload = promise; };
// Thêm một việc nền nữa (vd ghi doanh thu IN THÊM ở màn Kết quả) mà KHÔNG bỏ việc đang chờ của Edit.
export const themViecNen = (promise) => {
    pendingMediaUpload = pendingMediaUpload ? Promise.allSettled([pendingMediaUpload, promise]) : promise;
};

// Canon middleware chạy ngay trên máy booth (cùng máy với trình duyệt kiosk).
const CANON_MIDDLEWARE_URL = 'http://localhost:5001';
// Bật/tắt Live View qua middleware. Không phải máy booth (vd cloud) -> fetch lỗi, bỏ qua.
const controlCanonLiveView = (action) => {
    try {
        fetch(`${CANON_MIDDLEWARE_URL}/${action}`, { cache: 'no-store' }).catch(() => {});
    } catch {
        // ignore
    }
};
// TẠM NGƯNG KHI RẢNH: booth đứng ở Welcome quá lâu -> pause video nền, ngưng poll, đóng cổng
// máy đọc tiền. Video nền chạy = Chrome giữ power request 'Display Required' -> màn hình không bao giờ tắt.
// Từ 2026-10-24 máy tính KHÔNG còn sleep (Canon middleware xin giữ máy thức: sleep rồi thức là Windows dò
// lại USB, rớt máy ảnh, kiosk kẹt ở bước Chụp) -> tạm ngưng giờ chỉ để MÀN HÌNH tắt theo power plan và
// máy nghỉ tải (Chrome, mạng, cổng serial).
const IDLE_SUSPEND_MS = 60 * 60 * 1000; // 1 giờ không ai chạm
const IDLE_CHECK_MS = 30 * 1000;
const IDLE_ACTIVITY_EVENTS = ['pointerdown', 'touchstart', 'keydown', 'wheel'];
// Khách bỏ ngang TRƯỚC khi vào lượt (chọn bố cục / số lượng / thanh toán): không ai chạm bấy lâu thì
// cảnh báo đếm ngược, hết giờ tự về trang chủ (xem effect cạnh resetSession).
const PRE_SESSION_IDLE_MS = 3 * 60 * 1000;
const PRE_SESSION_WARN_S = 30;

const CONFIG_CACHE_KEY = 'ptb_configs_cache';
const CLOUD_SYNC_KEYS = [
    'price', 'print_price', 'mobile_price', 'mobile_print_price', 'price_schedule',
    'session_timeout', 'mobile_session_timeout', 'countdown', 'hotfolder_capture_timeout', 'canon_capture_timeout',
    // Đồng hồ phiên theo chặng (0.0.30): Chụp / Chọn ảnh / Chọn khung & in / Studio ảnh thẻ (Chỉnh ảnh = photo_edit_timeout).
    'session_capture_timeout', 'session_review_timeout', 'session_frame_timeout', 'id_studio_timeout',
    'bg_welcome', 'bg_mode-selection', 'bg_choose-slot', 'bg_select-photo-number', 'bg_payment', 'bg_payment-wait',
    'bg_select-photo', 'bg_filter-adjustment', 'bg_preview-when', 'bg_qr-photo', 'bg_id-photo',
    'brand_text_primary', 'brand_text_secondary',
    // Logo đổi ở trang Thương hiệu trên cloud. Trước 0.0.24 tới booth nhờ realtime áp nguyên khối cấu hình;
    // realtime giờ chỉ nhận các khoá trong danh sách này nên phải có tên ở đây.
    'logo_main',
    // Mốc admin đổi giá gốc (0.0.24): mốc lịch giá chạy trước đó nhường cho giá gốc (utils/pricing.js).
    'price_updated_at',
    // Bước 5.5 "Chỉnh ảnh": bật/tắt + thời gian từ trang Cài đặt trên cloud, không phải thao tác trên máy booth.
    'photo_edit_enabled', 'photo_edit_timeout',
    // Giá riêng ảnh thẻ (trang Cài đặt trên cloud); rỗng = theo giá photobooth (PrintQuantity).
    'id_photo_price', 'id_photo_print_price',
];

const DEFAULT_CONFIGS = {
    price: 60000,
    print_price: 20000,
    mobile_price: 30000,
    mobile_print_price: 10000,
    session_timeout: 600,
    mobile_session_timeout: 300,
    session_capture_timeout: 300,
    session_review_timeout: 120,
    session_frame_timeout: 180,
    id_studio_timeout: 300,
    countdown: 5,
    hotfolder_capture_timeout: 30,
    canon_capture_timeout: 30,
    camera_mode: 'canon',
    hot_folder: 'C:/Photobooth_Input',
    staff_pin: '8888',
    mode_switch_password: '', // mật khẩu đổi chế độ Trả phí/Sự kiện; rỗng -> tạm dùng staff_pin
    print_brightness: 0,
    print_contrast: 0,
    print_saturation: 0,
    print_warmth: 0,
    print_red: 0,
    print_green: 0,
    print_blue: 0,
    price_schedule: '[]',
    photo_edit_enabled: 'false',
    photo_edit_timeout: 200,
};

// ĐỒNG HỒ PHIÊN THEO CHẶNG (0.0.30). Trước đây một đồng hồ chung cho cả lượt (session_timeout): hết giờ là mọi bước còn
// lại tự chạy một mạch tới in. Giờ mỗi chặng có số giây riêng (trang Cài đặt); chặng trước dùng không hết thì phần dư
// CỘNG DỒN sang chặng sau. Tải ảnh từ điện thoại vẫn một đồng hồ chung (mobile_session_timeout).
export const TEN_CHANG = { chup: 'Chụp', chon: 'Chọn ảnh', chinh: 'Chỉnh ảnh', khung: 'Chọn khung', the: 'Ảnh thẻ', tai_len: '' };
export const changCuaBuoc = (step, laTaiLen) => {
    if (step === 8) return laTaiLen ? 'tai_len' : 'the';
    if (step >= 7) return null; // Kết quả: không tính giờ phiên (màn này tự về trang chủ theo luật riêng)
    if (laTaiLen) return 'tai_len';
    if (step === 5) return 'chon';
    if (step === 5.5) return 'chinh';
    if (step === 6) return 'khung';
    return 'chup'; // Chuẩn bị (3.5) + Chụp (4); trước khi vào lượt đồng hồ chưa chạy
};
export const soGiayChang = (chang, cfg) => {
    const so = (k) => Math.max(10, parseInt(cfg?.[k], 10) || DEFAULT_CONFIGS[k]);
    switch (chang) {
        case 'tai_len': return so('mobile_session_timeout');
        case 'chup': return so('session_capture_timeout');
        case 'chon': return so('session_review_timeout');
        case 'chinh': return Math.max(30, parseInt(cfg?.photo_edit_timeout, 10) || DEFAULT_CONFIGS.photo_edit_timeout);
        case 'khung': return so('session_frame_timeout');
        case 'the': return so('id_studio_timeout');
        default: return 0;
    }
};

// Bước 5.5 "Chỉnh ảnh" (giữa Chọn ảnh 5 và Chỉnh sửa 6). Mặc định tắt: booth chạy y như cũ tới khi admin bật.
export const isPhotoEditEnabled = (configs) => String(configs?.photo_edit_enabled ?? 'false') === 'true';

const normalizeConfigs = (nextConfigs = {}, fallback = DEFAULT_CONFIGS) => ({
    ...fallback,
    ...nextConfigs,
    price: parseInt(nextConfigs.price ?? fallback.price) || DEFAULT_CONFIGS.price,
    print_price: parseInt(nextConfigs.print_price ?? fallback.print_price) || DEFAULT_CONFIGS.print_price,
    mobile_price: parseInt(nextConfigs.mobile_price ?? fallback.mobile_price) || DEFAULT_CONFIGS.mobile_price,
    mobile_print_price: parseInt(nextConfigs.mobile_print_price ?? fallback.mobile_print_price) || DEFAULT_CONFIGS.mobile_print_price,
    session_timeout: parseInt(nextConfigs.session_timeout ?? fallback.session_timeout) || DEFAULT_CONFIGS.session_timeout,
    mobile_session_timeout: parseInt(nextConfigs.mobile_session_timeout ?? fallback.mobile_session_timeout) || DEFAULT_CONFIGS.mobile_session_timeout,
    session_capture_timeout: parseInt(nextConfigs.session_capture_timeout ?? fallback.session_capture_timeout) || DEFAULT_CONFIGS.session_capture_timeout,
    session_review_timeout: parseInt(nextConfigs.session_review_timeout ?? fallback.session_review_timeout) || DEFAULT_CONFIGS.session_review_timeout,
    session_frame_timeout: parseInt(nextConfigs.session_frame_timeout ?? fallback.session_frame_timeout) || DEFAULT_CONFIGS.session_frame_timeout,
    id_studio_timeout: parseInt(nextConfigs.id_studio_timeout ?? fallback.id_studio_timeout) || DEFAULT_CONFIGS.id_studio_timeout,
    countdown: parseInt(nextConfigs.countdown ?? fallback.countdown) || DEFAULT_CONFIGS.countdown,
    hotfolder_capture_timeout: parseInt(nextConfigs.hotfolder_capture_timeout ?? fallback.hotfolder_capture_timeout) || DEFAULT_CONFIGS.hotfolder_capture_timeout,
    canon_capture_timeout: parseInt(nextConfigs.canon_capture_timeout ?? fallback.canon_capture_timeout) || DEFAULT_CONFIGS.canon_capture_timeout,
    camera_mode: nextConfigs.camera_mode || fallback.camera_mode || DEFAULT_CONFIGS.camera_mode,
    hot_folder: nextConfigs.hot_folder || fallback.hot_folder || DEFAULT_CONFIGS.hot_folder,
    staff_pin: String(nextConfigs.staff_pin || fallback.staff_pin || DEFAULT_CONFIGS.staff_pin),
    mode_switch_password: String(nextConfigs.mode_switch_password ?? fallback.mode_switch_password ?? DEFAULT_CONFIGS.mode_switch_password),
    print_brightness: parseInt(nextConfigs.print_brightness ?? fallback.print_brightness) || 0,
    print_contrast: parseInt(nextConfigs.print_contrast ?? fallback.print_contrast) || 0,
    print_saturation: parseInt(nextConfigs.print_saturation ?? fallback.print_saturation) || 0,
    print_warmth: parseInt(nextConfigs.print_warmth ?? fallback.print_warmth) || 0,
    print_red: parseInt(nextConfigs.print_red ?? fallback.print_red) || 0,
    print_green: parseInt(nextConfigs.print_green ?? fallback.print_green) || 0,
    print_blue: parseInt(nextConfigs.print_blue ?? fallback.print_blue) || 0,
    price_schedule: nextConfigs.price_schedule ?? fallback.price_schedule ?? DEFAULT_CONFIGS.price_schedule,
    photo_edit_enabled: String(nextConfigs.photo_edit_enabled ?? fallback.photo_edit_enabled ?? DEFAULT_CONFIGS.photo_edit_enabled),
    photo_edit_timeout: parseInt(nextConfigs.photo_edit_timeout ?? fallback.photo_edit_timeout) || DEFAULT_CONFIGS.photo_edit_timeout,
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
        source: 'camera', // Luôn chụp tại quầy (đã bỏ tuỳ chọn tải ảnh từ điện thoại)
        // Chế độ chụp do KHÁCH chọn ở màn Welcome: 'normal' (ảnh chơi) | 'id' (ảnh thẻ).
        // Khác với isEventMode — cái đó là cài đặt TOÀN MÁY do nhân viên bật.
        captureMode: 'normal',
    });


    // Dynamic Configs
    const [configs, setConfigs] = useState(() => normalizeConfigs(readCachedConfigs()));

    // Trạng thái tạm ngưng khi rảnh. Dùng kèm ref vì các setInterval bên dưới được tạo 1 lần,
    // closure của chúng không thấy được giá trị state mới.
    const [isIdleSuspended, setIsIdleSuspended] = useState(false);
    const idleSuspendedRef = useRef(false);

    const setIdleSuspended = (next) => {
        if (idleSuspendedRef.current === next) return;
        idleSuspendedRef.current = next;
        setIsIdleSuspended(next);
        // Báo backend để đóng/mở cổng serial máy đọc tiền. Best-effort: lỗi mạng không được
        // chặn UI (khách chạm là phải tỉnh ngay, kể cả khi backend chưa trả lời).
        fetch(apiPath('/api/system/idle'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idle: next }),
        }).catch(() => { });
    };

    const wakeFromIdle = () => setIdleSuspended(false);

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
        // Booth chỉ nhận các khoá đồng bộ (CLOUD_SYNC_KEYS) như fetchConfigs. Cấu hình trên cloud còn có
        // camera_mode (mặc định 'webcam'), staff_pin, print_*... — trước 0.0.24 sự kiện realtime áp NGUYÊN
        // khối: admin lưu giá một cái là booth chuyển sang webcam, đổi PIN nhân viên, đổi màu in.
        let incoming = nextConfigs;
        if (isLocalApp()) {
            incoming = {};
            CLOUD_SYNC_KEYS.forEach((key) => {
                if (nextConfigs[key] !== undefined) incoming[key] = nextConfigs[key];
            });
            if (!Object.keys(incoming).length) return;
            fetch(apiPath('/api/config'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(incoming),
            }).catch((error) => console.error('Failed to sync realtime cloud config:', error));
        }
        setConfigs(prev => {
            const normalized = normalizeConfigs(incoming, prev);
            if (sameConfig(prev, normalized)) return prev;
            cacheConfigs(normalized);
            return normalized;
        });
    };

    // Doanh thu in thêm chưa lên cloud ở lần chạy trước (trang tải lại / mất mạng) -> gửi bù sau khi app ổn định.
    useEffect(() => {
        const t = setTimeout(() => { guiLaiInThemConKet().catch(() => {}); }, 20000);
        return () => clearTimeout(t);
    }, []);

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
            if (idleSuspendedRef.current || realtimeReady || document.visibilityState !== 'visible') return;
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
    // Khởi đầu = chế độ xác nhận lần gần nhất, không chờ mạng. Có cloud: đọc BOOTH_MODE_CLOUD, khoá CHỈ ghi từ
    // giá trị cloud trả về. Không dùng BOOTH_MODE: bản trước 0.0.24 ghi khoá đó cả khi gạt tay, có thể còn
    // 'event' -> mở máy lúc chưa tới được cloud là chụp miễn phí. Chưa từng có xác nhận -> Trả phí.
    const [isEventMode, setIsEventMode] = useState(() => {
        try {
            return localStorage.getItem(CLOUD_API_URL ? 'BOOTH_MODE_CLOUD' : 'BOOTH_MODE') === 'event';
        } catch {
            return false;
        }
    });
    // Ảnh thẻ bật RIÊNG từng máy (admin bật ở trang Thiết bị trên cloud; api/devices device_features). Máy tắt thì
    // bỏ luôn màn Chọn chế độ (1.5): Welcome đi thẳng sang Bố cục. Giữ giá trị cloud xác nhận lần gần nhất để mất mạng
    // vẫn đúng; chưa từng xác nhận -> tắt.
    const [idPhotoOn, setIdPhotoOn] = useState(() => {
        try {
            return localStorage.getItem('ID_PHOTO_CLOUD') === 'true';
        } catch {
            return false;
        }
    });
    // Lưu id (numeric) bản ghi thiết bị trên CLOUD -> để nút gạt Event/Payment ghi bền lên cloud.
    const cloudDeviceIdRef = useRef(null);

    // Device Management
    useEffect(() => {
        // Only run device heartbeat for Photobooth and Admin, not public viewers/uploaders
        const ignorePaths = ['/album/', '/m/upload/'];
        if (ignorePaths.some(p => window.location.pathname.startsWith(p))) {
            return;
        }

        const deviceId = getDeviceId();
        // Mã máy đang chạy thật: syncDevice đổi sang mã backend cấp nếu khác localStorage (xem kênh realtime).
        let currentDeviceId = deviceId;
        // Kiosk trên máy booth đã lấy được mã máy từ backend cục bộ chưa. Chưa thì KHÔNG báo lên cloud: mã trong
        // localStorage có thể là mã ngẫu nhiên 'sf-device-…' (backend chưa lên lúc bật máy, trình duyệt bị xoá dữ
        // liệu, máy dev) -> mỗi lần như vậy cloud thêm một "máy ma" (trang Thiết bị có hơn 70 máy, 24/10/2026).
        let maMayDaXacNhan = false;

        // Chế độ Trả phí/Sự kiện: có cloud thì CHỈ cloud quyết định (đổi ở trang Cài đặt, PUT chỉ admin).
        // Trước 0.0.24 nhịp tim áp chế độ của backend local rồi mới tới chế độ cloud -> mỗi 60 s lật qua
        // lại giữa hai giá trị, mất mạng thì đứng luôn ở giá trị local (có thể là 'event' = chụp miễn phí).
        // Giờ: cloud trả về -> áp + lưu BOOTH_MODE_CLOUD làm dự phòng; cloud lỗi -> giữ chế độ cloud xác nhận
        // lần gần nhất. Không cấu hình cloud (máy chạy độc lập) -> theo backend local như cũ (BOOTH_MODE).
        const applyDeviceMode = (mode, xacNhan = false) => {
            if (mode !== 'event' && mode !== 'payment') return;
            if (xacNhan) {
                try {
                    localStorage.setItem(CLOUD_API_URL ? 'BOOTH_MODE_CLOUD' : 'BOOTH_MODE', mode);
                } catch {
                    // bỏ qua (private mode / đầy bộ nhớ)
                }
            }
            setIsEventMode(prev => {
                const next = mode === 'event';
                return prev === next ? prev : next;
            });
        };

        const applyIdPhoto = (on) => {
            if (typeof on !== 'boolean') return;
            try {
                localStorage.setItem('ID_PHOTO_CLOUD', on ? 'true' : 'false');
            } catch {
                // bỏ qua (private mode / đầy bộ nhớ)
            }
            setIdPhotoOn((prev) => (prev === on ? prev : on));
        };

        const syncDevice = async () => {
            if (!API_URL && !isLocalApp()) return;

            let deviceName = getDeviceName();
            if (!deviceName) {
                deviceName = "Máy Chụp 1";
                setDeviceName(deviceName);
            }

            let activeDeviceId = deviceId;
            // Danh tính MÁY (hostname, thư mục cài, phiên bản) do backend cục bộ trả về -> gửi kèm nhịp tim
            // lên cloud. Để trang Doanh thu chỉ ra được "mã máy X đang chạy ở máy nào, từ thư mục nào"
            // khi hai máy vô tình cùng một device_id (sự cố phòng 3 ghi thành phòng 1, 2026-09-15).
            let machine = null;
            try {
                const sysRes = await fetch(apiPath('/api/config/system'));
                if (sysRes.ok) {
                    const sysData = await sysRes.json();
                    if (sysData.device_id) {
                        maMayDaXacNhan = true;
                        activeDeviceId = sysData.device_id;
                        currentDeviceId = activeDeviceId;
                        localStorage.setItem("device_id", activeDeviceId);
                        localStorage.setItem("DEVICE_ID", activeDeviceId);
                    }
                    if (sysData.machine && typeof sysData.machine === 'object') machine = sysData.machine;
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
                    if (!CLOUD_API_URL) applyDeviceMode(data.mode, true);
                }
            } catch (error) {
                console.error("Device sync failed:", error);
            }

            // Chưa có mã máy từ backend -> nhịp tim kế (60 s) thử lại; chế độ / ảnh thẻ giữ giá trị cloud lần trước.
            if (CLOUD_API_URL && (maMayDaXacNhan || !isLocalApp())) {
                try {
                    const cloudRes = await fetch(`${CLOUD_API_URL}/api/devices`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action: 'heartbeat', deviceId: activeDeviceId, name: deviceName, machine })
                    });
                    if (cloudRes.ok) {
                        const data = await cloudRes.json();
                        if (data.id) cloudDeviceIdRef.current = data.id;
                        applyDeviceMode(data.mode, true);
                        applyIdPhoto(data.id_photo);
                    }
                } catch (error) {
                    console.warn("Cloud device sync failed:", error);
                }
            }
        };

        syncDevice();
        const interval = setInterval(() => {
            if (idleSuspendedRef.current) return; // đang tạm ngưng chờ máy ngủ -> không đánh thức mạng
            syncDevice();
        }, 60000);

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
                        // Kênh đăng ký theo mã máy lúc mở trang; backend có thể cấp mã khác (máy chép
                        // localStorage từ máy khác, sự cố 2026-09-15). Chỉ nhận bản ghi của mã đang chạy, kẻo áp
                        // chế độ Trả phí/Sự kiện của máy khác. Trang tải lại sau mỗi lượt -> lần sau đăng ký đúng mã.
                        if (!row?.mode || row.device_id !== currentDeviceId) return;
                        applyDeviceMode(row.mode, true);
                    }
                )
                // Admin bật/tắt Ảnh thẻ -> áp ngay (không có realtime thì nhịp tim 60 s cũng tới).
                .on(
                    'postgres_changes',
                    { event: '*', schema: 'public', table: 'app_configs', filter: 'key=eq.device_features' },
                    (payload) => {
                        const all = payload.new?.config;
                        if (!all || typeof all !== 'object') return;
                        applyIdPhoto(all[currentDeviceId]?.id_photo === true);
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
        const newMode = !isEventMode;
        const modeStr = newMode ? 'event' : 'payment';
        setIsEventMode(newMode);
        // Có cloud: cloud quyết định, nút gạt chỉ có tác dụng tới nhịp tim kế -> KHÔNG ghi BOOTH_MODE,
        // kẻo mất mạng thì chế độ gạt tay thành vĩnh viễn.
        if (!CLOUD_API_URL) localStorage.setItem('BOOTH_MODE', modeStr);

        // GHI BỀN vào DB (local + cloud). Trước đây chỉ set localStorage -> mỗi 60s heartbeat đọc
        // mode cũ trong DB rồi applyDeviceMode() ghi đè ngược -> nút gạt "không ăn", máy tưởng
        // payment nhưng thực tế vẫn event -> bỏ qua thanh toán. Gửi kèm mode để lưu vào DB.
        const deviceId = getDeviceId();
        const deviceName = getDeviceName() || 'Máy Chụp 1';
        if (API_URL || isLocalApp()) {
            fetch(apiPath('/api/devices/heartbeat'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ deviceId, name: deviceName, mode: modeStr }),
            }).catch((error) => console.warn('Persist local mode failed:', error));
        }
        if (CLOUD_API_URL && cloudDeviceIdRef.current) {
            fetch(cloudApiPath('/api/devices'), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: cloudDeviceIdRef.current, mode: modeStr }),
            }).catch((error) => console.warn('Persist cloud mode failed:', error));
        }
    };

    const photoEditOn = isPhotoEditEnabled(configs) && sessionData.captureMode !== 'id';
    // Đi qua lại 5.5 <-> 6 không được thêm giờ: quay lại bước trước dùng chung hạn của chặng xa nhất đã tới (đồng hồ
    // theo chặng bên dưới), nên không còn cần giới hạn riêng cho 5.5 như trước 0.0.30.
    const canPhotoEdit = photoEditOn;

    const nextStep = () => {
        const isIdPhoto = sessionData.captureMode === 'id';
        setCurrentStep((prev) => {
            // LUỒNG ẢNH THẺ: sau khi Chụp (4) thì rẽ sang Studio ảnh thẻ (8), rồi tới Kết quả (7).
            // Không đi qua Chọn ảnh (5) và Chỉnh sửa (6) — hai màn đó dành cho ảnh chơi.
            if (isIdPhoto && prev === 4) return 8;
            if (isIdPhoto && prev === 8) return 7;

            // Welcome (1) -> trang CHỌN CHẾ ĐỘ (1.5) -> ảnh chơi thì sang chọn bố cục (2),
            // ảnh thẻ thì trang đó tự goToStep(2.5). Bước 1.5 trước đây dùng cho "chọn nguồn"
            // (đã bỏ), nay tái sử dụng số đó.
            // Máy không bật Ảnh thẻ: chỉ có ảnh chơi -> bỏ màn chọn chế độ.
            if (prev === 1) return idPhotoOn ? 1.5 : 2;
            if (prev === 1.5) return 2;

            // Payment Mode: Insert Quantity step between Layout (2) and Payment (3)
            if (!isEventMode && prev === 2) return 2.5; // Go to Quantity
            if (!isEventMode && prev === 2.5) return 3; // Go to Payment

            // Sau Thanh toán (3): chèn màn "Chuẩn bị" (3.5) để camera ấm rồi mới vào Chụp.
            if (prev === 3) return 3.5;
            if (prev === 3.5) return 4; // Chuẩn bị -> Chụp

            // Event Mode: Skip Quantity + Payment. Layout -> qua màn Chuẩn bị (3.5).
            if (isEventMode && prev === 2) return 3.5;

            // Chọn ảnh (5) -> Chỉnh ảnh (5.5) -> Chỉnh sửa (6). Hết giờ chặng Chọn ảnh vẫn vào 5.5: chặng Chỉnh ảnh có
            // giờ riêng (0.0.30), khách bỏ đi thì nó tự hết rồi đi tiếp.
            if (prev === 5) return canPhotoEdit ? 5.5 : 6;
            if (prev === 5.5) return 6;

            return Math.min(prev + 1, 7);
        });
    };

    const prevStep = () => {
        const isIdPhoto = sessionData.captureMode === 'id';
        setCurrentStep((prev) => {
            // Ảnh thẻ: Studio (8) lùi về Chụp (4); Số lượng (2.5) lùi thẳng về Welcome (1)
            // vì luồng này không có bước chọn bố cục.
            if (isIdPhoto && prev === 8) return 4;
            if (isIdPhoto && prev === 2.5) return 1.5;
            // Ảnh thẻ ở chế độ sự kiện không qua Bố cục (2) -> lùi từ Chụp về màn Chọn chế độ.
            if (isIdPhoto && isEventMode && prev === 4) return 1.5;
            // Payment Mode: Handle Quantity step
            if (!isEventMode && prev === 3) return 2.5; // From Payment back to Quantity
            if (!isEventMode && prev === 2.5) return 2; // From Quantity back to Layout

            // Event Mode: Skip back over quantity and payment
            if (isEventMode && prev === 4) return 2; // From Capture back to Layout

            // Lùi: Bố cục (2) -> Chọn chế độ (1.5) -> Welcome (1).
            if (prev === 2) return idPhotoOn ? 1.5 : 1;
            if (prev === 1.5) return 1;

            if (prev === 6) return canPhotoEdit ? 5.5 : 5;
            if (prev === 5.5) return 5;

            return Math.max(prev - 1, 1);
        });
    };

    const goToStep = (step) => setCurrentStep(step);

    // ĐỒNG HỒ PHIÊN THEO CHẶNG (xem changCuaBuoc / soGiayChang). `han` = tổng số giây của các chặng ĐÃ VÀO, `daChay` = số
    // giây đã trôi từ lúc vào lượt; còn lại = han - daChay -> giờ chặng trước dùng không hết tự cộng sang chặng sau.
    // Quay lại bước trước (chụp lại từ Chọn ảnh, lùi từ Chọn khung) KHÔNG cộng thêm giờ: dùng chung hạn của chặng xa nhất
    // đã tới. Hết hạn thì chỉ bước đang đứng tự hoàn tất (timedOut); sang chặng mới là có giờ của chặng đó.
    // han / chặng đã vào là ref cập nhật NGAY trong lúc render: bước mới mount đã thấy timedOut=false — cập nhật bằng
    // effect thì bước mới (effect con chạy trước effect cha) thấy timedOut cũ của chặng trước và tự hoàn tất luôn.
    const laTaiLen = sessionData.source === 'upload';
    const [isSessionActive, setIsSessionActive] = useState(false);
    const [daChay, setDaChay] = useState(0);
    const hanRef = useRef(0);
    const changDaVaoRef = useRef(new Set());
    const changHienTai = changCuaBuoc(currentStep, laTaiLen);
    if (isSessionActive && changHienTai && !changDaVaoRef.current.has(changHienTai)) {
        changDaVaoRef.current.add(changHienTai);
        hanRef.current += soGiayChang(changHienTai, configs);
    }
    const timeLeft = isSessionActive ? Math.max(0, hanRef.current - daChay) : 0;
    const timedOut = isSessionActive && !!changHienTai && hanRef.current > 0 && daChay >= hanRef.current;
    const SESSION_DURATION = soGiayChang(changHienTai || (laTaiLen ? 'tai_len' : 'chup'), configs);
    const batDauDongHo = () => {
        changDaVaoRef.current = new Set();
        hanRef.current = 0;
        setDaChay(0);
        setIsSessionActive(true);
    };
    // Đang chờ upload ảnh nền hoàn tất trước khi reset -> hiện overlay "Đang lưu ảnh...".
    const [savingBeforeReset, setSavingBeforeReset] = useState(false);

    // Start timer when payment is completed — read configs fresh at this moment
    useEffect(() => {
        if (sessionData.paymentStatus === 'completed' && !isSessionActive) {
            batDauDongHo(); // số giây từng chặng đọc lúc vào chặng đó (cấu hình mới nhất)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionData.paymentStatus]);

    // Event mode KHÔNG có bước Thanh toán -> paymentStatus mãi 'pending' -> timer/timeout không bao
    // giờ chạy -> booth KẸT vô hạn nếu khách bỏ ngang. Bật đồng hồ phiên khi vào vùng chụp (>=3.5)
    // để có timeout tự hoàn tất/in/reset như luồng trả phí.
    useEffect(() => {
        if (isEventMode && !isSessionActive && currentStep >= 3.5 && currentStep <= 6) {
            batDauDongHo();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isEventMode, currentStep]);

    // Dọn trạng thái treo ở backend lúc khởi động: nếu tab reload đúng lúc đang tạm ngưng (App.jsx
    // TỰ reload khi chunk lỗi/treo), state React về false nhưng backend vẫn giữ idle=true -> máy
    // đọc tiền bị tắt vĩnh viễn, khách không trả tiền mặt được. Gọi resume 1 lần cho chắc.
    useEffect(() => {
        if (!isLocalApp()) return;
        fetch(apiPath('/api/system/idle'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idle: false }),
        }).catch(() => { });
        // Trang kiosk vừa (tải lại) mở = không ai đang ở màn tiền mặt. Tải lại ĐÚNG LÚC khách ở màn tiền
        // mặt thì không ai gửi accepting:false -> máy đọc tiền vẫn mở, đèn sáng, nuốt tiền mà không lượt nào
        // nhận (0.0.24). Chỉ trang kiosk '/': mở /admin ở tab khác không được tắt hộ khách đang trả tiền.
        if (window.location.pathname === '/') {
            fetch(apiPath('/api/bill/accept'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ accepting: false }),
            }).catch(() => { });
        }
    }, []);

    // Phát hiện booth rảnh -> tạm ngưng để màn hình được tắt (máy tính không sleep, xem IDLE_SUSPEND_MS).
    // Chỉ ngưng khi đang đứng ở Welcome (step 1) và KHÔNG có phiên nào chạy dở, nên không bao
    // giờ cắt ngang khách đang chụp/thanh toán. Effect chạy lại mỗi khi đổi bước -> đồng hồ rảnh
    // được đặt lại, đúng ý "vừa có người thao tác".
    useEffect(() => {
        if (!isLocalApp()) return undefined; // chỉ máy booth, không áp cho web khách/cloud

        let lastActivity = Date.now();
        // Mọi thao tác đều đánh thức, KHÔNG chỉ trông vào lớp phủ đen ở MainLayout: lớp phủ đó chỉ
        // có trên màn kiosk, còn /admin dùng AdminLayout -> nếu chỉ dựa vào nó thì lỡ ngưng khi
        // đang ở trang admin sẽ kẹt vĩnh viễn (máy đọc tiền tắt, không có gì bật lại).
        const markActivity = () => {
            lastActivity = Date.now();
            if (idleSuspendedRef.current) setIdleSuspended(false);
        };
        IDLE_ACTIVITY_EVENTS.forEach((evt) =>
            window.addEventListener(evt, markActivity, { capture: true, passive: true })
        );

        const timer = setInterval(() => {
            if (idleSuspendedRef.current) return; // đã ngưng rồi, chỉ thoát bằng thao tác của người
            // Đọc path MỖI NHỊP: chuyển trang trong SPA (/ -> /admin) KHÔNG làm effect chạy lại,
            // nên chỉ kiểm tra lúc đăng ký là hụt -> đang ngồi trang admin vẫn bị ngưng.
            if (window.location.pathname !== '/' || currentStep !== 1 || isSessionActive) {
                lastActivity = Date.now();
                return;
            }
            if (Date.now() - lastActivity < IDLE_SUSPEND_MS) return;
            setIdleSuspended(true);
        }, IDLE_CHECK_MS);

        return () => {
            clearInterval(timer);
            IDLE_ACTIVITY_EVENTS.forEach((evt) =>
                window.removeEventListener(evt, markActivity, { capture: true })
            );
        };
    }, [currentStep, isSessionActive]);

    // Đếm giờ: chỉ khi đang ở một chặng (màn Kết quả không tính). Tới hạn thì DỪNG ở đó, không trôi tiếp: bước đang
    // đứng tự hoàn tất, chặng sau vẫn nhận đủ giờ của nó dù bước kia mất vài giây mới xong.
    const coDemGio = isSessionActive && !!changHienTai;
    useEffect(() => {
        if (!coDemGio) return undefined;
        const interval = setInterval(() => {
            setDaChay((d) => (d < hanRef.current ? d + 1 : d));
        }, 1000);
        return () => clearInterval(interval);
    }, [coDemGio]);

    // --- Điều khiển Live View Canon theo bước ---
    // Bật từ bước Thanh toán (step 3) để khi vào Chụp (step 4) có hình ngay; tắt khi ở
    // Welcome/Source/Layout để máy ảnh nghỉ (đỡ nóng, đỡ hao). Bỏ qua trang album/upload
    // và các chế độ camera khác 'canon'.
    useEffect(() => {
        const path = typeof window !== 'undefined' ? window.location.pathname : '';
        if (['/album/', '/m/upload/'].some((p) => path.startsWith(p))) return;
        if ((configs.camera_mode || 'canon') !== 'canon') return;

        // Nguồn 'upload' (ảnh từ điện thoại) KHÔNG dùng máy ảnh booth -> luôn tắt LV.
        if (sessionData.source === 'upload') {
            controlCanonLiveView('stop-liveview');
            return;
        }

        // Giữ live view SỐNG LIÊN TỤC trong VÙNG CHỤP: Thanh toán(3) -> Chuẩn bị(3.5) -> Chụp(4)
        // -> Review(5). Nhờ vậy chụp lại từ Review là TỨC THÌ (camera luôn ấm, không warm lại, và
        // Review có thể bỏ qua màn Chuẩn bị). Sang Edit(6)/Result(7) và các bước <3 -> TẮT hẳn cho
        // máy NGHỈ suốt lúc chỉnh/in/hiện QR (phần dài nhất) -> đỡ nóng hơn cả cách cũ (vốn để LV
        // trôi tới khi idle-off 2 phút). Event mode không có Thanh toán nên pre-warm từ Layout(2).
        const startSteps = isEventMode ? [2, 3.5, 4, 5] : [3, 3.5, 4, 5];
        if (startSteps.includes(currentStep)) {
            controlCanonLiveView('start-liveview');
        } else {
            controlCanonLiveView('stop-liveview');
        }
    }, [currentStep, isEventMode, configs.camera_mode, sessionData.source]);

    const resetSession = async () => {
        // Tắt live view trước khi reload để máy ảnh về trạng thái chờ (kết thúc phiên).
        controlCanonLiveView('stop-liveview');
        // Chờ upload ảnh gốc/video ở nền xong (tối đa 15s) để KHÔNG mất ảnh khi reload. Reload
        // sẽ hủy mọi request đang chạy -> nếu bỏ qua bước chờ này, ảnh lẻ/video có thể mất.
        if (pendingMediaUpload) {
            // Chỉ hiện overlay "Đang lưu ảnh..." nếu phải chờ thật (>250ms). Upload đã xong thì
            // reload luôn, không chớp overlay.
            const showTimer = setTimeout(() => setSavingBeforeReset(true), 250);
            try {
                await Promise.race([pendingMediaUpload, new Promise((resolve) => setTimeout(resolve, 15000))]);
            } catch {
                // ignore -> vẫn reload
            }
            clearTimeout(showTimer);
            pendingMediaUpload = null;
        }
        // Tự động tải lại trang để làm mới toàn bộ cài đặt (giá tiền, khung ảnh) và dọn dẹp bộ nhớ
        window.location.reload();
    };

    // KHÁCH BỎ NGANG TRƯỚC KHI VÀO LƯỢT. Đồng hồ phiên chỉ chạy từ lúc trả tiền xong, nên trước 0.0.24
    // booth đứng mãi ở màn bố cục / thanh toán: live view Canon bật suốt (nóng máy, có khi cả đêm) và
    // khách sau phải tự bấm Quay lại. Giờ: không ai chạm PRE_SESSION_IDLE_MS -> MainLayout hiện cảnh báo
    // đếm ngược PRE_SESSION_WARN_S giây, chạm bất kỳ đâu là ở lại, hết giờ thì về trang chủ.
    // Màn Thanh toán GIỮ lại (setIdleHold) khi khách đang trả dở: đã nhét tiền, đơn chuyển khoản còn hạn...
    const idleHoldRef = useRef(null);
    const setIdleHold = useCallback((fn) => { idleHoldRef.current = fn; }, []);
    // Màn Kết quả hỏi khi khách đang trả tiền IN THÊM (Payment ở đó cũng gọi setIdleHold). Lỗi khi hỏi = đang giữ.
    const isIdleHeld = useCallback(() => {
        try {
            return !!idleHoldRef.current?.();
        } catch {
            return true;
        }
    }, []);
    const [idleWarning, setIdleWarning] = useState(null); // số giây còn lại trước khi tự về trang chủ
    useEffect(() => {
        if (!(currentStep > 1 && currentStep < 3.5) || isSessionActive || timedOut) return undefined;

        let lastActivity = Date.now();
        // Chỉ dời mốc, KHÔNG tắt cảnh báo ngay: tắt ngay thì lớp phủ biến mất giữa lúc chạm và cú chạm rơi
        // xuống nút bên dưới. Nhịp kế tiếp (≤ 1 s) tự tắt, cú chạm đã bị lớp phủ nuốt.
        const markActivity = () => { lastActivity = Date.now(); };
        IDLE_ACTIVITY_EVENTS.forEach((evt) =>
            window.addEventListener(evt, markActivity, { capture: true, passive: true })
        );
        let daVe = false;
        const timer = setInterval(() => {
            if (daVe) return;
            let giu = false;
            try {
                giu = !!idleHoldRef.current?.();
            } catch {
                giu = true; // lỗi khi hỏi thì coi như đang giữ: về nhầm trang chủ tệ hơn đứng chờ
            }
            if (window.location.pathname !== '/' || giu) lastActivity = Date.now();
            const quaHan = Date.now() - lastActivity - PRE_SESSION_IDLE_MS;
            if (quaHan < 0) {
                setIdleWarning(null);
                return;
            }
            const conLai = PRE_SESSION_WARN_S - Math.floor(quaHan / 1000);
            if (conLai > 0) {
                setIdleWarning(conLai);
                return;
            }
            daVe = true;
            clearInterval(timer);
            console.warn(`[Workflow] khach bo ngang o buoc ${currentStep} -> ve trang chu`);
            resetSession();
        }, 1000);

        return () => {
            clearInterval(timer);
            IDLE_ACTIVITY_EVENTS.forEach((evt) =>
                window.removeEventListener(evt, markActivity, { capture: true })
            );
            setIdleWarning(null);
        };
    }, [currentStep, isSessionActive, timedOut]);

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
                timeLeft, // giây còn lại của chặng hiện tại (đã cộng phần dư chặng trước)
                changHienTai,
                isSessionActive,
                photoEditOn,
                idPhotoOn,
                timedOut,
                savingBeforeReset,
                idleWarning,
                setIdleHold,
                isIdleHeld,
                isIdleSuspended,
                wakeFromIdle,
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
