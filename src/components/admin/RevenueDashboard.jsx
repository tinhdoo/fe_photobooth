import { useState, useEffect, useRef, useMemo } from 'react';
import axios from 'axios';
import { DollarSign, Calendar, TrendingUp, Download, Eye, Filter, ChevronDown, ChevronUp, Clock, CheckCircle, Banknote, QrCode, Hash, Check, Trash2, Pencil, X, Loader2 } from 'lucide-react';
import { io } from "socket.io-client";

import { CLOUD_API_URL } from '../../config/api';
import MenuChon from '../common/MenuChon';
import { authHeader, getUsername, KHOA_CACHE_DOANH_THU } from '../../utils/auth';
const apiPath = (path) => `${CLOUD_API_URL}${path}`;

// Vào trang là THẤY NGAY: nhớ kết quả lần tải gần nhất của chế độ xem mặc định (không lọc) trong trình duyệt,
// mở trang hiện bản nhớ trước rồi tải bản mới ở nền và thay vào. Gắn theo tài khoản; đăng xuất là xoá (clearAuth).
const docCache = () => {
    try {
        const c = JSON.parse(localStorage.getItem(KHOA_CACHE_DOANH_THU) || 'null');
        return c && c.u === getUsername() ? c : null;
    } catch {
        return null;
    }
};
const ghiCache = (phan) => {
    try {
        localStorage.setItem(KHOA_CACHE_DOANH_THU, JSON.stringify({ ...(docCache() || {}), ...phan, u: getUsername() }));
    } catch { /* đầy bộ nhớ / bị chặn -> chỉ mất phần hiện nhanh */ }
};

// --- Voucher (mã thanh toán) KHÔNG tính vào doanh thu ---
// payment_code_applied = số tiền voucher đã che cho giao dịch (backend cloud trả về).
const txValue = (tx) => Number(tx.value ?? tx.amount ?? 0) || 0;
const voucherApplied = (tx) => {
    const applied = Number(tx.payment_code_applied || 0);
    const value = txValue(tx);
    if (applied > 0) return Math.min(applied, value);
    // Thiếu payment_code_applied: ƯU TIÊN dùng GIÁ TRỊ MÃ (payment_code_value) -> voucher che tối đa
    // đúng bằng mệnh giá mã (vd mã 50k trên đơn 60k -> che 50k, còn 10k là tiền mặt/QR). Trước đây
    // coi CẢ tổng là voucher -> hiện sai "Voucher 60k" và làm MẤT 10k doanh thu thật.
    const m = String(tx.payment_method || '').toLowerCase();
    if (!m.includes('code')) return 0;
    const codeVal = Number(tx.payment_code_value || 0);
    return codeVal > 0 ? Math.min(codeVal, value) : value; // không có mệnh giá -> đành coi 100% (mã cũ)
};
// Doanh thu THẬT = tiền thu được (tiền mặt + QR) = tổng giá trị trừ phần voucher che.
// Mã một phần (code+cash / code+qr): phần tiền mặt/QR VẪN tính, chỉ trừ phần voucher.
const realRevenue = (tx) => Math.max(0, txValue(tx) - voucherApplied(tx));

// --- Múi giờ VN (UTC+7, không DST) ---
// Trước đây gom nhóm "hôm nay/tuần/tháng" + biểu đồ ngày + bộ lọc dùng GIỜ MÁY ADMIN (getFullYear...),
// còn hiển thị lại ép VN -> lệch tới 7h nếu máy admin không ở UTC+7 (giao dịch quanh nửa đêm bị gán
// nhầm ngày). Các helper này cho MỌI phép gom nhóm theo đúng giờ VN, dùng epoch tuyệt đối để so sánh.
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const vnDateKey = (dateLike) => {
    const v = new Date(new Date(dateLike).getTime() + VN_OFFSET_MS);
    return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}-${String(v.getUTCDate()).padStart(2, '0')}`;
};
const vnNowBounds = () => {
    const v = new Date(Date.now() + VN_OFFSET_MS);
    const y = v.getUTCFullYear(), m = v.getUTCMonth(), d = v.getUTCDate(), dow = v.getUTCDay();
    const diff = d - dow + (dow === 0 ? -6 : 1); // thứ 2 đầu tuần
    return {
        startOfDay: Date.UTC(y, m, d) - VN_OFFSET_MS,
        startOfWeek: Date.UTC(y, m, diff) - VN_OFFSET_MS,
        startOfMonth: Date.UTC(y, m, 1) - VN_OFFSET_MS,
        todayKey: `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
    };
};

const RevenueDashboard = () => {
    const [stats, setStats] = useState(() => docCache()?.stats || { totalRevenue: 0, transactions: [] });
    // Thời điểm của số liệu đang hiện (bản nhớ hoặc vừa tải) -> ghi "Cập nhật lúc ..." cho admin biết.
    const [capNhatLuc, setCapNhatLuc] = useState(() => docCache()?.at || null);
    const [loading, setLoading] = useState(false);
    const [showMobileFilter, setShowMobileFilter] = useState(false);
    const [dateRange, setDateRange] = useState({
        startDate: '',
        endDate: '',
        startTime: '',
        endTime: ''
    });
    const [paymentMethod, setPaymentMethod] = useState('');

    const [showResetModal, setShowResetModal] = useState(false);
    const [resetPassword, setResetPassword] = useState('');
    const [hideTarget, setHideTarget] = useState(null);     // device_id đang chờ ẩn
    const [hideError, setHideError] = useState('');
    const [hideLoading, setHideLoading] = useState(false);
    const [resetLoading, setResetLoading] = useState(false);
    const [resetError, setResetError] = useState('');
    const [notification, setNotification] = useState(null);
    const [errorMsg, setErrorMsg] = useState('');
    const [chartHover, setChartHover] = useState(null); // { chart: 'line'|'bar', i }
    const [devices, setDevices] = useState(() => docCache()?.devices || []);
    const [editingDevice, setEditingDevice] = useState(null);
    const [editNameValue, setEditNameValue] = useState('');

    // Hiển thị danh sách giao dịch theo LÔ (cuộn tới đâu hiện thêm) -> tránh render hàng nghìn dòng
    // một lúc gây lag. Các TỔNG/biểu đồ vẫn tính trên TOÀN BỘ stats.transactions -> không sai số liệu.
    const TX_PAGE_SIZE = 20;
    const [visibleCount, setVisibleCount] = useState(TX_PAGE_SIZE);
    const loadMoreRef = useRef(null);

    // Dữ liệu đổi (fetch/lọc mới) -> hiển thị lại từ lô đầu.
    useEffect(() => { setVisibleCount(TX_PAGE_SIZE); }, [stats.transactions]);

    // Cuộn gần cuối danh sách -> tự nạp thêm 1 lô (infinite scroll). Preload trước 300px.
    useEffect(() => {
        const el = loadMoreRef.current;
        const total = stats.transactions?.length || 0;
        if (!el || visibleCount >= total) return;
        const io = new IntersectionObserver((entries) => {
            if (entries[0]?.isIntersecting) {
                setVisibleCount((c) => Math.min(c + TX_PAGE_SIZE, total));
            }
        }, { rootMargin: '300px' });
        io.observe(el);
        return () => io.disconnect();
    }, [visibleCount, stats.transactions]);

    const visibleTransactions = (stats.transactions || []).slice(0, visibleCount);

    // Lấy danh sách booth (để map device_id -> tên booth)
    const fetchDevices = () => {
        axios.get(apiPath('/api/devices'), { headers: authHeader() })
            .then((res) => {
                const ds = Array.isArray(res.data) ? res.data : [];
                setDevices(ds);
                ghiCache({ devices: ds });
            })
            .catch(() => {});
    };
    useEffect(() => { fetchDevices(); }, []);

    const startEditBooth = (deviceId) => {
        setEditNameValue(boothName(deviceId));
        setEditingDevice(deviceId);
    };
    const saveBoothName = async (deviceId) => {
        const name = editNameValue.trim();
        if (!name) { setEditingDevice(null); return; }
        const row = devices.find((dv) => dv.device_id === deviceId);
        try {
            if (row?.id) {
                await axios.put(apiPath('/api/devices'), { id: row.id, name }, { headers: authHeader() });
            } else {
                await axios.post(apiPath('/api/devices'), { action: 'heartbeat', device_id: deviceId, name });
            }
            fetchDevices();
        } catch (e) {
            console.error('Đổi tên booth thất bại:', e);
        }
        setEditingDevice(null);
    };

    // Ẩn 1 booth khỏi bảng doanh thu (chỉ admin đã đăng nhập — server kiểm). Không xóa dữ liệu — chỉ
    // lọc khỏi thống kê; có thể khôi phục bằng cách bỏ device_id khỏi hidden_booths trên cloud.
    const hideBooth = (deviceId) => {
        setHideTarget(deviceId);
        setHideError('');
    };

    const confirmHideBooth = async () => {
        if (!hideTarget) return;
        setHideLoading(true);
        try {
            await axios.post(apiPath('/api/revenue'), { action: 'hide_booth', device_id: hideTarget }, { headers: authHeader() });
            setHideTarget(null);
            fetchRevenue();
            fetchDevices();
        } catch (e) {
            setHideError(e?.response?.data?.error || 'Ẩn booth thất bại.');
        } finally {
            setHideLoading(false);
        }
    };

    // Map device_id -> device để tra cứu O(1) (tránh devices.find lặp lại trên mỗi hàng/lần render)
    const devicesMap = useMemo(() => {
        const map = new Map();
        devices.forEach((dv) => map.set(dv.device_id, dv));
        return map;
    }, [devices]);

    const boothName = (id) => {
        if (!id) return 'Không rõ máy';
        const d = devicesMap.get(id);
        return d?.name || `Máy ${String(id).slice(-6).toUpperCase()}`;
    };

    const boothReport = (id) => devicesMap.get(id)?.report || null;
    // Danh sách MÁY (hostname) đã gửi nhịp tim với device_id này, mới nhất trước. >= 2 máy = hai máy
    // đang dùng chung một mã -> doanh thu của chúng bị gộp, phải tách (đổi device_id.txt ở một máy).
    const boothMachines = (id) => {
        const m = devicesMap.get(id)?.machines;
        if (!m || typeof m !== 'object') return [];
        return Object.entries(m)
            .map(([hostname, v]) => ({ hostname, ...(v || {}) }))
            .sort((a, b) => new Date(b.last_seen || 0) - new Date(a.last_seen || 0));
    };
    const fmtSeen = (iso) => {
        if (!iso) return '';
        const d = new Date(iso);
        return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
    };

    // Gộp theo từng booth. total = DOANH THU THẬT (tiền mặt + QR), voucher tách riêng KHÔNG cộng
    // vào total. Mã một phần: phần voucher vào cột voucher, phần còn lại vào tiền mặt/QR.
    const revenueByBooth = useMemo(() => {
        const map = new Map();
        (stats.transactions || []).forEach((tx) => {
            const id = tx.device_id || 'unknown';
            if (!map.has(id)) map.set(id, { device_id: id, total: 0, count: 0, luot: 0, cash: 0, qr: 0, code: 0 });
            const b = map.get(id);
            const m = String(tx.payment_method || '').toLowerCase();
            const applied = voucherApplied(tx);
            const real = realRevenue(tx);
            b.code += applied;                                   // voucher (không tính doanh thu)
            const coQr = m.includes('qr') || m.includes('sepay');
            if (coQr && m.includes('cash')) {
                // Tiền mặt + QR (booth 0.0.23): phần tiền mặt = số máy đếm được, còn lại là QR.
                const tienMat = Math.min(Math.max(Number(tx.cash_inserted) || 0, 0), real);
                b.cash += tienMat;
                b.qr += real - tienMat;
            } else if (coQr) b.qr += real;
            else if (!m.includes('code') || m.includes('cash')) b.cash += real; // pure 'code' -> real=0
            b.total += real;                                     // doanh thu thật = cash + qr
            b.count += 1;
            if (!tx.in_them) b.luot += 1; // in thêm ở màn Kết quả: giao dịch riêng, không phải lượt chụp mới
        });
        return Array.from(map.values()).sort((a, b) => b.total - a.total);
    }, [stats.transactions]);

    const PAYMENT_METHODS = [
        { value: '', label: 'Mọi phương thức', icon: <DollarSign size={15} /> },
        { value: 'cash', label: 'Tiền mặt', icon: <Banknote size={15} /> },
        { value: 'qr', label: 'Chuyển khoản', icon: <QrCode size={15} /> },
        { value: 'code', label: 'Mã thanh toán', icon: <Hash size={15} /> },
    ];

    const getFilterRange = () => {
        const hasFilter = dateRange.startDate || dateRange.endDate || dateRange.startTime || dateRange.endTime;
        if (!hasFilter) return {};

        // Ngày trong ô lọc là NGÀY THEO GIỜ VN (admin nghĩ theo VN) -> dựng mốc VN tuyệt đối gửi API,
        // tránh new Date("YYYY-MM-DD") bị hiểu là nửa đêm UTC -> lệch 7h.
        const todayKey = vnNowBounds().todayKey;
        const startStr = dateRange.startDate || todayKey;
        const endStr = dateRange.endDate || todayKey;
        const [sh = 0, sm = 0] = (dateRange.startTime || '00:00').split(':').map(Number);
        const [eh = 23, em = 59] = (dateRange.endTime || '23:59').split(':').map(Number);
        const [sy, smo, sd] = startStr.split('-').map(Number);
        const [ey, emo, ed] = endStr.split('-').map(Number);

        const start = new Date(Date.UTC(sy, smo - 1, sd, sh, sm, 0, 0) - VN_OFFSET_MS);
        const end = new Date(Date.UTC(ey, emo - 1, ed, eh, em, 59, 999) - VN_OFFSET_MS);
        return { start, end };
    };

    const fetchRevenue = async () => {
        setLoading(true);
        try {
            const params = {};
            const filterRange = getFilterRange();
            if (filterRange.start) params.startDate = filterRange.start.toISOString();
            if (filterRange.end) params.endDate = filterRange.end.toISOString();
            if (paymentMethod) params.paymentMethod = paymentMethod;

            console.log("Fetching revenue with params:", params);
            const res = await axios.get(apiPath('/api/revenue'), { params, headers: authHeader() });
            const data = res.data && typeof res.data === 'object' ? res.data : {};
            const moi = {
                totalRevenue: Number(data.totalRevenue || 0),
                transactions: Array.isArray(data.transactions) ? data.transactions : [],
                chartData: Array.isArray(data.chartData) ? data.chartData : [],
                paymentBreakdown: data.paymentBreakdown && typeof data.paymentBreakdown === 'object' ? data.paymentBreakdown : {},
            };
            setStats(moi);
            const luc = Date.now();
            setCapNhatLuc(luc);
            // Chỉ nhớ chế độ xem mặc định (không lọc) — đó là thứ hiện ra lúc mở trang.
            if (!Object.keys(params).length) ghiCache({ stats: moi, at: luc });
            setShowMobileFilter(false);
        } catch (error) {
            console.error("Failed to fetch revenue:", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchRevenue();

        const socket = io('/', {
            transports: ['polling']
        });

        socket.on('revenue_reset', () => {
            fetchRevenue();
            fetchDevices();
        });

        return () => socket.disconnect();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleFilter = (e) => {
        e.preventDefault();
        setErrorMsg('');

        const { startDate, endDate, startTime, endTime } = dateRange;

        if (startDate && endDate) {
            const start = new Date(startDate);
            const end = new Date(endDate);
            if (start > end) {
                setErrorMsg('Ngày bắt đầu không được sau ngày kết thúc!');
                return;
            }
            if (startDate === endDate && startTime && endTime) {
                if (startTime > endTime) {
                    setErrorMsg('Giờ bắt đầu không được sau giờ kết thúc!');
                    return;
                }
            }
        } else if (startTime && endTime && !startDate && !endDate) {
            if (startTime > endTime) {
                setErrorMsg('Giờ bắt đầu không được sau giờ kết thúc!');
                return;
            }
        }

        fetchRevenue();
    };

    const formatCurrency = (amount) => {
        return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(Number(amount || 0));
    };

    // Tách chi tiết thanh toán khi trả GHÉP (voucher + tiền mặt/QR) -> hiện "Voucher 50k + Tiền mặt 10k"
    // thay vì chỉ 1 con số tổng. Trả '' nếu không cần tách (thuần tiền mặt/QR).
    const kShort = (n) => `${Math.round(Number(n || 0) / 1000)}k`;
    const paymentBreakdown = (tx) => {
        const v = voucherApplied(tx);
        const r = realRevenue(tx);
        if (v > 0 && r > 0) {
            // Mã một phần (voucher + tiền mặt/QR): tách doanh thu THỰC thu được và phần voucher che.
            return `Doanh thu thực ${kShort(r)} - Voucher ${kShort(v)}`;
        }
        if (v > 0 && r === 0) return `Voucher ${kShort(v)}`; // trả 100% bằng mã -> không có doanh thu thực
        return '';
    };

    const getMethodLabel = (tx) => {
        if (tx.method_label) return tx.method_label;
        const method = String(tx.payment_method || '').toLowerCase();
        if (method === 'cash') return 'Tiền mặt';
        if (method === 'qr' || method === 'sepay') return 'Chuyển khoản';
        if (method === 'code') return 'Mã thanh toán';
        if (method === 'code+cash') return 'Mã + tiền mặt';
        if (method === 'code+qr') return 'Mã + QR';
        if (method === 'cash+qr') return 'Tiền mặt + QR';
        if (method === 'code+cash+qr') return 'Mã + tiền mặt + QR';
        return tx.payment_method || 'Không xác định';
    };

    const getMethodDetail = (tx) => {
        const chiTiet = getMethodDetailGoc(tx);
        return tx.in_them ? ['In thêm', chiTiet].filter(Boolean).join(' • ') : chiTiet;
    };
    const getMethodDetailGoc = (tx) => {
        if (tx.detail_label) return tx.detail_label;
        const details = [];
        if (tx.payment_code) details.push(`Mã: ${tx.payment_code}`);
        if (tx.sepay_order_code) details.push(tx.sepay_order_code);
        return details.join(' • ');
    };

    // Trạng thái vòng đời album: ACTIVE (còn hạn) / EXPIRED (hết hạn 48h).
    // Không tin tx.status trong DB (nó chỉ đổi thành 'expired' khi có người MỞ album để trigger dọn;
    // nếu không ai mở thì vẫn 'active' dù đã quá hạn). -> TÍNH theo thời điểm tạo: created_at + 48h < nay.
    const ALBUM_MAX_AGE_MS = 48 * 60 * 60 * 1000;
    const statusInfo = (tx) => {
        const ts = tx.created_at || tx.used_at;
        const expiredByAge = ts ? (Date.now() - new Date(ts).getTime() > ALBUM_MAX_AGE_MS) : false;
        const expired = String(tx.status || '').toLowerCase() === 'expired' || expiredByAge;
        return expired
            ? { label: 'EXPIRED', cls: 'bg-gray-200 text-gray-500' }
            : { label: 'ACTIVE', cls: 'bg-green-100 text-green-700' };
    };

    // Mỗi loại thanh toán 1 màu -> tô NỀN CẢ DÒNG: tiền mặt=xanh lá, QR=xanh dương, mã=cam,
    // mã+tiền=teal, mã+QR=tím. `row` là nền dòng, `left` là vạch màu bên trái, `dot` là chấm nhỏ.
    const getMethodStyle = (tx) => {
        const m = String(tx.payment_method || '').toLowerCase();
        if (m.includes('code') && m.includes('cash')) return { row: 'bg-teal-50/60', left: 'border-l-4 border-teal-400', dot: 'bg-teal-500' };
        if (m.includes('code') && m.includes('qr')) return { row: 'bg-purple-50/60', left: 'border-l-4 border-purple-400', dot: 'bg-purple-500' };
        if (m.includes('code')) return { row: 'bg-orange-50/60', left: 'border-l-4 border-orange-400', dot: 'bg-orange-500' };
        if (m.includes('qr') || m.includes('sepay')) return { row: 'bg-blue-50/60', left: 'border-l-4 border-blue-400', dot: 'bg-blue-500' };
        if (m.includes('cash') || m === '') return { row: 'bg-emerald-50/60', left: 'border-l-4 border-emerald-400', dot: 'bg-emerald-500' };
        return { row: 'bg-gray-50', left: 'border-l-4 border-gray-300', dot: 'bg-gray-400' };
    };
    const methodBadge = (tx) => (
        <span className="inline-flex items-center gap-2 font-bold text-[#1a1a2e]">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${getMethodStyle(tx).dot}`} />
            {getMethodLabel(tx)}
        </span>
    );

    const handleResetRevenue = async () => {
        if (!resetPassword) {
            setResetError('Nhập mật khẩu đăng nhập để xác nhận.');
            return;
        }

        setResetLoading(true);
        setResetError('');

        try {
            await axios.post(apiPath('/api/revenue'), { action: 'reset', password: resetPassword }, { headers: authHeader() });

            setShowResetModal(false);
            setResetPassword('');

            fetchRevenue();
            fetchDevices();

            setNotification('Đã reset doanh thu thành công');
            setTimeout(() => setNotification(null), 3000);
        } catch (e) {
            setResetError(e?.response?.data?.error || 'Reset thất bại');
        } finally {
            setResetLoading(false);
        }
    };

    const periodStats = useMemo(() => {
        const { startOfDay, startOfWeek, startOfMonth } = vnNowBounds();

        let today = 0;
        let todayCount = 0;
        let week = 0;
        let month = 0;

        stats.transactions?.forEach(tx => {
            if (!tx.used_at) return;
            const txTime = new Date(tx.used_at).getTime();
            const val = realRevenue(tx); // voucher đã bị loại khỏi doanh thu
            if (txTime >= startOfDay) { today += val; todayCount += 1; }
            if (txTime >= startOfWeek) week += val;
            if (txTime >= startOfMonth) month += val;
        });

        return { today, todayCount, week, month };
    }, [stats.transactions]);

    // Tổng thu THẬT (đã loại voucher) + thống kê voucher đã dùng cho ô riêng.
    const realTotalRevenue = useMemo(
        () => (stats.transactions || []).reduce((s, tx) => s + realRevenue(tx), 0),
        [stats.transactions]
    );
    const voucherStats = useMemo(() => {
        const { startOfDay } = vnNowBounds();
        let total = 0, count = 0, today = 0, todayCount = 0;
        (stats.transactions || []).forEach((tx) => {
            const a = voucherApplied(tx);
            if (a > 0) {
                total += a; count += 1;
                if (tx.used_at && new Date(tx.used_at).getTime() >= startOfDay) { today += a; todayCount += 1; }
            }
        });
        return { total, count, today, todayCount };
    }, [stats.transactions]);

    // Build chart data: group transactions by day for bar chart
    const chartData = useMemo(() => {
        const txs = stats.transactions || [];
        if (txs.length === 0) return [];

        // Determine date range: either from filter or last 14 days
        const now = new Date();
        let rangeStart, rangeEnd;
        const filterRange = getFilterRange();
        if (filterRange.start) {
            rangeStart = filterRange.start;
        } else {
            rangeStart = new Date(now);
            rangeStart.setDate(now.getDate() - 13);
            rangeStart.setHours(0, 0, 0, 0);
        }
        if (filterRange.end) {
            rangeEnd = filterRange.end;
        } else {
            rangeEnd = new Date(now);
            rangeEnd.setHours(23, 59, 59, 999);
        }

        // Sinh danh sách ngày theo GIỜ VN (khớp key với phần gom giao dịch bên dưới). Dùng 1 mốc UTC
        // đại diện cho ngày-lịch-VN để bước qua từng ngày (chỉ phục vụ tạo key/nhãn, không phải mốc thật).
        const toVnDayUtc = (dateLike) => {
            const [y, m, d] = vnDateKey(dateLike).split('-').map(Number);
            return Date.UTC(y, m - 1, d);
        };
        const days = [];
        let curU = toVnDayUtc(rangeStart);
        const endU = toVnDayUtc(rangeEnd);
        while (curU <= endU) {
            const cd = new Date(curU);
            const key = `${cd.getUTCFullYear()}-${String(cd.getUTCMonth() + 1).padStart(2, '0')}-${String(cd.getUTCDate()).padStart(2, '0')}`;
            days.push({ key, label: `${String(cd.getUTCDate()).padStart(2, '0')}/${String(cd.getUTCMonth() + 1).padStart(2, '0')}`, total: 0, voucher: 0 });
            curU += 24 * 60 * 60 * 1000;
        }

        // Gom theo ngày VN
        txs.forEach(tx => {
            if (!tx.used_at) return;
            const key = vnDateKey(tx.used_at);
            const found = days.find(day => day.key === key);
            if (found) { found.total += realRevenue(tx); found.voucher += voucherApplied(tx); }
        });

        return days;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [stats.transactions, dateRange]);

    return (
        <div className="space-y-4 md:space-y-6 animate-fadeIn pb-20 md:pb-0">
            {/* Đầu trang: tiêu đề + giờ cập nhật + nút bộ lọc (điện thoại; máy tính luôn hiện thanh lọc) */}
            <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                    <h1 className="text-2xl md:text-3xl font-bold text-[#1a1a2e] tracking-tight">Doanh thu</h1>
                    {(loading || capNhatLuc) && (
                        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-gray-400">
                            {loading
                                ? <><Loader2 size={12} className="animate-spin" /> Đang cập nhật…</>
                                : <>Cập nhật {new Date(capNhatLuc).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</>}
                        </p>
                    )}
                </div>
                <button
                    type="button"
                    onClick={() => setShowMobileFilter(!showMobileFilter)}
                    className={`lg:hidden relative flex shrink-0 items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-bold transition-all active:scale-95 ${showMobileFilter ? 'border-[#e63946] bg-[#e63946]/5 text-[#e63946]' : 'border-gray-200 bg-white text-gray-700'}`}
                >
                    <Filter size={16} /> Lọc
                    {(dateRange.startDate || dateRange.endDate || dateRange.startTime || dateRange.endTime || paymentMethod) && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-[#e63946] ring-2 ring-white" />}
                </button>
            </div>

            {notification && (
                <div className="p-3 rounded-xl bg-green-50 text-green-700 border border-green-100 flex items-center gap-2 animate-fadeIn">
                    <CheckCircle size={18} />
                    <span className="font-bold text-sm">{notification}</span>
                </div>
            )}

            {/* Bộ lọc — THANH NGANG gọn (áp cho biểu đồ + booth + giao dịch bên dưới) */}
            <div className={`${showMobileFilter ? 'block' : 'hidden'} lg:block bg-white rounded-2xl shadow-sm border border-gray-100`}>
                <div className="p-4">
                    {errorMsg && (
                        <div className="p-3 mb-3 rounded-xl bg-red-50 text-red-600 border border-red-100 text-xs font-bold animate-fadeIn">
                            {errorMsg}
                        </div>
                    )}
                    <form onSubmit={handleFilter} className="grid grid-cols-2 gap-3 sm:flex sm:flex-row sm:flex-wrap sm:items-end">
                        <div className="hidden lg:flex items-center gap-2 self-center pr-1 text-[#1a1a2e] font-bold shrink-0">
                            <Filter size={18} className="text-[#e63946]" /> Bộ lọc
                        </div>
                        <div className="flex flex-col gap-1 min-w-0 flex-1 sm:flex-none sm:w-40">
                            <label htmlFor="startDate" className="text-[10px] font-bold text-gray-400 uppercase ml-1">Từ ngày</label>
                            <input type="date" id="startDate" name="startDate"
                                className="w-full box-border bg-gray-50 border border-gray-100 rounded-xl py-2 px-2.5 outline-none focus:bg-white focus:ring-2 focus:ring-[#e63946]/20 focus:border-[#e63946] transition-all font-medium text-xs md:text-sm text-gray-700"
                                value={dateRange.startDate}
                                onChange={(e) => { setErrorMsg(''); setDateRange({ ...dateRange, startDate: e.target.value }); }} />
                        </div>
                        <div className="flex flex-col gap-1 min-w-0 flex-1 sm:flex-none sm:w-40">
                            <label htmlFor="endDate" className="text-[10px] font-bold text-gray-400 uppercase ml-1">Đến ngày</label>
                            <input type="date" id="endDate" name="endDate"
                                className="w-full box-border bg-gray-50 border border-gray-100 rounded-xl py-2 px-2.5 outline-none focus:bg-white focus:ring-2 focus:ring-[#e63946]/20 focus:border-[#e63946] transition-all font-medium text-xs md:text-sm text-gray-700"
                                value={dateRange.endDate}
                                onChange={(e) => { setErrorMsg(''); setDateRange({ ...dateRange, endDate: e.target.value }); }} />
                        </div>
                        <div className="flex flex-col gap-1 min-w-0 flex-1 sm:flex-none sm:w-28">
                            <label htmlFor="startTime" className="text-[10px] font-bold text-gray-400 uppercase ml-1">Từ giờ</label>
                            <input type="time" id="startTime" name="startTime"
                                className="w-full box-border bg-gray-50 border border-gray-100 rounded-xl py-2 px-2.5 outline-none focus:bg-white focus:ring-2 focus:ring-[#e63946]/20 focus:border-[#e63946] transition-all font-medium text-xs md:text-sm text-gray-700"
                                value={dateRange.startTime}
                                onChange={(e) => { setErrorMsg(''); setDateRange({ ...dateRange, startTime: e.target.value }); }} />
                        </div>
                        <div className="flex flex-col gap-1 min-w-0 flex-1 sm:flex-none sm:w-28">
                            <label htmlFor="endTime" className="text-[10px] font-bold text-gray-400 uppercase ml-1">Đến giờ</label>
                            <input type="time" id="endTime" name="endTime"
                                className="w-full box-border bg-gray-50 border border-gray-100 rounded-xl py-2 px-2.5 outline-none focus:bg-white focus:ring-2 focus:ring-[#e63946]/20 focus:border-[#e63946] transition-all font-medium text-xs md:text-sm text-gray-700"
                                value={dateRange.endTime}
                                onChange={(e) => { setErrorMsg(''); setDateRange({ ...dateRange, endTime: e.target.value }); }} />
                        </div>
                        <div className="col-span-2 flex flex-col gap-1 min-w-0 flex-1 sm:flex-none sm:w-52">
                            <label className="text-[10px] font-bold text-gray-400 uppercase ml-1">Phương thức</label>
                            <MenuChon
                                value={paymentMethod}
                                onChange={setPaymentMethod}
                                ariaLabel="Phương thức"
                                nutClassName="flex h-[38px] w-full items-center justify-between gap-2 rounded-xl border border-gray-100 bg-gray-50 px-3 text-left text-xs font-bold text-[#1a1a2e] transition-all hover:border-gray-200 md:text-sm"
                                options={PAYMENT_METHODS.map((m) => ({ value: m.value, label: <span className="inline-flex items-center gap-2"><span className="text-gray-400">{m.icon}</span>{m.label}</span> }))}
                            />
                        </div>
                        <div className="col-span-2 flex items-center gap-2 sm:ml-auto">
                            <button type="submit" disabled={loading}
                                className="bg-[#e63946] text-white px-5 py-2 rounded-xl font-bold hover:bg-[#c1121f] transition-all flex items-center justify-center gap-2 shadow-lg shadow-[#e63946]/20 active:scale-[0.98] disabled:opacity-50 text-sm h-[38px]">
                                {loading ? 'Đang tải...' : <><Filter size={16} /> Áp dụng</>}
                            </button>
                            {(dateRange.startDate || dateRange.endDate || dateRange.startTime || dateRange.endTime || paymentMethod) && (
                                <button type="button"
                                    onClick={() => { setErrorMsg(''); setDateRange({ startDate: '', endDate: '', startTime: '', endTime: '' }); setPaymentMethod(''); }}
                                    className="px-3 py-2 text-gray-400 hover:text-red-500 font-bold text-xs transition-colors whitespace-nowrap">
                                    Đặt lại
                                </button>
                            )}
                        </div>
                    </form>
                </div>
            </div>

            {/* Doanh thu theo booth — full chiều rộng */}

            {/* Số liệu: "Hôm nay" là thẻ lớn (xem nhiều nhất), còn lại là danh sách gọn số đủ chữ số
                — 5 thẻ nhỏ cũ trên điện thoại vừa dài vừa phải bóp chữ. */}
            <div className="grid gap-3 md:gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
                <div className="flex flex-col justify-between rounded-3xl bg-gradient-to-br from-[#1a1a2e] to-[#33334f] p-5 text-white shadow-lg shadow-[#1a1a2e]/15 md:p-6">
                    <div className="flex items-center gap-2 text-xs font-semibold text-white/60">
                        <Calendar size={14} /> Hôm nay
                    </div>
                    <div className="mt-2">
                        <p className="break-words text-3xl font-black leading-tight tracking-tight md:text-4xl">{formatCurrency(periodStats.today)}</p>
                        <p className="mt-1 text-xs text-white/50">{periodStats.todayCount} lượt</p>
                    </div>
                </div>
                <div className="divide-y divide-gray-100 rounded-3xl border border-gray-100 bg-white px-4 shadow-sm md:px-5">
                    {[
                        { label: 'Tuần này', value: periodStats.week, icon: <TrendingUp size={15} />, mau: 'bg-blue-50 text-blue-600' },
                        { label: 'Tháng này', value: periodStats.month, icon: <TrendingUp size={15} />, mau: 'bg-purple-50 text-purple-600' },
                        { label: 'Tổng thu', value: realTotalRevenue, icon: <DollarSign size={15} />, mau: 'bg-amber-50 text-amber-600' },
                        { label: 'Voucher', note: `${voucherStats.count} lượt · hôm nay ${voucherStats.today.toLocaleString('vi-VN')}đ`, value: voucherStats.total, icon: <Hash size={15} />, mau: 'bg-orange-50 text-orange-600', phu: true },
                    ].map((item) => (
                        <div key={item.label} className="flex items-center gap-3 py-3">
                            <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl ${item.mau}`}>{item.icon}</span>
                            <div className="min-w-0 flex-1">
                                <p className="text-sm font-semibold text-gray-600">{item.label}</p>
                                {item.note && <p className="truncate text-[11px] text-gray-400">{item.note}</p>}
                            </div>
                            <p className={`shrink-0 text-right font-black ${item.phu ? 'text-sm text-gray-500' : 'text-base text-[#1a1a2e] md:text-lg'}`}>{formatCurrency(item.value)}</p>
                        </div>
                    ))}
                </div>
            </div>

            {/* Charts — 2 col grid */}
            {chartData.length > 0 && (() => {
                // Số gọn cho trục: 0 / 500k / 1tr / 1,5tr
                const formatK = (v) => (v === 0 ? '0' : v >= 1e6 ? `${(v / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}tr` : `${Math.round(v / 1000)}k`);
                const maxVal = Math.max(...chartData.map((d) => Math.max(d.total, d.voucher)), 1);
                // Mốc trục tròn: bước 1 / 2 / 2,5 / 5 × 10^k, chia 3 hoặc 4 bước — lấy cách nào ít thừa khoảng trống trên đầu hơn.
                const [yStep, soBuoc] = [3, 4].map((k) => {
                    const tho = maxVal / k;
                    const mag = Math.pow(10, Math.floor(Math.log10(tho)));
                    return [[1, 2, 2.5, 5, 10].map((m) => m * mag).find((b) => b >= tho), k];
                }).sort((a, b) => a[0] * a[1] - b[0] * b[1])[0];
                const yMax = yStep * soBuoc;
                const todayKey = vnDateKey(Date.now());
                const n = chartData.length;

                // --- Bar chart geometry --- (khung hẹp để chữ trục đọc được trên điện thoại; máy tính phóng to theo)
                const BW = 360, BH = 180, BP_L = 30, BP_R = 4, BP_T = 10, BP_B = 20;
                const bPlotW = BW - BP_L - BP_R, bPlotH = BH - BP_T - BP_B;
                const day = BP_T + bPlotH;
                const oW = bPlotW / n; // mỗi ngày một ô, cột nằm giữa ô (cột đầu/cuối không tràn ra ngoài)
                // Mỗi ngày 2 cột đứng cạnh nhau (doanh thu | voucher), cách nhau khe 1; phần còn lại của ô là khoảng thở.
                const KHE = 1;
                const barW = Math.max(2, Math.min(12, (oW * 0.78 - KHE) / 2));
                const bLabelStep = Math.ceil(n / 7);
                const hoverI = chartHover?.chart === 'bar' ? chartHover.i : null;

                // 2 màu: đỏ là doanh thu thật (tiền mặt + QR), hổ phách là phần voucher che trong ngày.
                // Cặp đỏ thương hiệu + hổ phách đã chạy kiểm tra màu (phân biệt được cả với người mù màu).
                const MAU_THU = '#e63946', MAU_VOUCHER = '#eda100';
                // Cột vuông góc (user thấy đầu bo tròn khó nhìn).
                const cot = (x, y, w, h) => `M${x},${y + h}V${y}H${x + w}V${y + h}Z`;
                const fmtVnd = v => `${new Intl.NumberFormat('vi-VN').format(v)}đ`;
                // Tooltip: ngày + từng phần (chấm màu nhận dạng, chữ giữ màu trung tính).
                const renderTip = (cx, anchorY, d) => {
                    const dong = [['Doanh thu', d.total, MAU_THU], ...(d.voucher > 0 ? [['Voucher', d.voucher, MAU_VOUCHER]] : [])];
                    const tw = 140, th = 22 + dong.length * 15;
                    let tx = Math.max(BP_L, Math.min(cx - tw / 2, BW - BP_R - tw));
                    let ty = anchorY - th - 8;
                    if (ty < BP_T) {
                        // Cột cao, không đủ chỗ phía trên -> đặt hộp sát bên cạnh cột (phải, hết chỗ thì trái) để không che cột.
                        ty = BP_T;
                        tx = cx + barW + 6 + tw <= BW - BP_R ? cx + barW + 6 : cx - barW - 6 - tw;
                    }
                    return (
                        <g pointerEvents="none">
                            <rect x={tx} y={ty} width={tw} height={th} rx={8} fill="#1a1a2e" opacity="0.96" />
                            <text x={tx + 10} y={ty + 15} fontSize={9} fill="#9ca3af">{d.label}</text>
                            {dong.map(([ten, v, mau], k) => (
                                <g key={ten}>
                                    <rect x={tx + 10} y={ty + 22 + k * 15} width={7} height={7} rx={1.5} fill={mau} />
                                    <text x={tx + 22} y={ty + 28.5 + k * 15} fontSize={9.5} fill="#cbd5e1">{ten}</text>
                                    <text x={tx + tw - 10} y={ty + 28.5 + k * 15} textAnchor="end" fontSize={10} fill="#ffffff" fontWeight="700">{fmtVnd(v)}</text>
                                </g>
                            ))}
                        </g>
                    );
                };

                return (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-5">

                        {/* Bar Chart */}
                        <div className="bg-white rounded-2xl md:rounded-3xl shadow-sm border border-gray-100 p-4 sm:p-5">
                            <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                                <h3 className="text-base font-black text-[#1a1a2e]">Doanh thu từng ngày</h3>
                                <div className="flex items-center gap-3 text-xs font-semibold text-gray-500">
                                    <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: MAU_THU }} />Doanh thu</span>
                                    <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: MAU_VOUCHER }} />Voucher</span>
                                </div>
                            </div>
                            <svg viewBox={`0 0 ${BW} ${BH}`} className="block w-full" style={{ aspectRatio: `${BW} / ${BH}` }} preserveAspectRatio="xMidYMid meet" onMouseLeave={() => setChartHover(null)}>
                                {/* Lưới: nét mảnh liền, nhạt — chỉ để dóng mắt, không tranh với cột */}
                                {Array.from({ length: soBuoc + 1 }, (_, k) => {
                                    const y = day - (k / soBuoc) * bPlotH;
                                    return (
                                        <g key={k}>
                                            <line x1={BP_L} y1={y} x2={BW - BP_R} y2={y} stroke={k === 0 ? '#e5e7eb' : '#f1f2f4'} strokeWidth={1} />
                                            <text x={BP_L - 6} y={y + 3} textAnchor="end" fontSize={8} fill="#9ca3af">{formatK(k * yStep)}</text>
                                        </g>
                                    );
                                })}
                                {chartData.map((d, i) => {
                                    const bx = BP_L + (i + 0.5) * oW;
                                    const thuH = d.total > 0 ? Math.max(2, (d.total / yMax) * bPlotH) : 0;
                                    const vH = d.voucher > 0 ? Math.max(2, (d.voucher / yMax) * bPlotH) : 0;
                                    const isToday = d.key === todayKey;
                                    const showLabel = isToday || (n - 1 - i) % bLabelStep === 0; // đếm lùi từ ngày cuối -> nhãn "Hôm nay" không dính nhãn bên cạnh
                                    return (
                                        <g key={d.key} opacity={hoverI === null || hoverI === i ? 1 : 0.35} style={{ transition: 'opacity 120ms' }}>
                                            {thuH > 0 && <path d={cot(bx - KHE / 2 - barW, day - thuH, barW, thuH)} fill={MAU_THU} />}
                                            {vH > 0 && <path d={cot(bx + KHE / 2, day - vH, barW, vH)} fill={MAU_VOUCHER} />}
                                            {showLabel && <text x={bx} y={BH - 5} textAnchor="middle" fontSize={8} fill={isToday ? '#1a1a2e' : '#9ca3af'} fontWeight={isToday ? '700' : '400'}>{isToday ? 'Hôm nay' : d.label}</text>}
                                        </g>
                                    );
                                })}
                                {/* Vùng bắt hover/chạm (trong suốt, phủ cả ô ngày) */}
                                {chartData.map((d, i) => (
                                    <rect key={`h${d.key}`} x={BP_L + i * oW} y={BP_T} width={oW} height={bPlotH}
                                        fill="transparent" onMouseEnter={() => setChartHover({ chart: 'bar', i })} onClick={() => setChartHover({ chart: 'bar', i })} />
                                ))}
                                {hoverI !== null && chartData[hoverI] && (() => {
                                    const d = chartData[hoverI];
                                    const bx = BP_L + (hoverI + 0.5) * oW;
                                    const cao = Math.max(d.total, d.voucher) > 0 ? (Math.max(d.total, d.voucher) / yMax) * bPlotH + 2 : 0;
                                    return renderTip(bx, day - cao, d);
                                })()}
                            </svg>
                        </div>

                        {/* So sánh lượt chụp giữa các booth (biểu đồ tròn) — chuyển lên đây thay biểu đồ đường */}
                        {(() => {
                            const items = revenueByBooth.filter((b) => b.luot > 0);
                            if (items.length === 0) return null;
                            const totalCount = items.reduce((s, b) => s + b.luot, 0);
                            const COLORS = ['#e63946', '#f4a261', '#2a9d8f', '#457b9d', '#8338ec', '#ffb703', '#84a98c', '#c1121f', '#606c38', '#bc6c25'];
                            const cx = 100, cy = 100, R = 82, r = 50;
                            let a0 = -Math.PI / 2;
                            const slices = items.map((b, i) => {
                                const frac = b.luot / totalCount;
                                const a1 = a0 + frac * Math.PI * 2;
                                const large = (a1 - a0) > Math.PI ? 1 : 0;
                                const p = (ang, rad) => `${(cx + rad * Math.cos(ang)).toFixed(2)} ${(cy + rad * Math.sin(ang)).toFixed(2)}`;
                                const path = `M ${p(a0, R)} A ${R} ${R} 0 ${large} 1 ${p(a1, R)} L ${p(a1, r)} A ${r} ${r} 0 ${large} 0 ${p(a0, r)} Z`;
                                const slice = { path, color: COLORS[i % COLORS.length], b, frac };
                                a0 = a1;
                                return slice;
                            });
                            return (
                                <div className="bg-white rounded-2xl md:rounded-3xl shadow-sm border border-gray-100 p-4 sm:p-5">
                                    <h3 className="text-base font-black text-[#1a1a2e] mb-3">Lượt chụp theo booth</h3>
                                    <div className="flex items-center gap-4 sm:gap-6">
                                        <svg viewBox="0 0 200 200" className="h-28 w-28 shrink-0 sm:h-40 sm:w-40">
                                            {items.length === 1 ? (
                                                <>
                                                    <circle cx={cx} cy={cy} r={R} fill={slices[0].color} />
                                                    <circle cx={cx} cy={cy} r={r} fill="#fff" />
                                                </>
                                            ) : (
                                                slices.map((s) => (
                                                    <path key={s.b.device_id} d={s.path} fill={s.color} stroke="#fff" strokeWidth="1.5">
                                                        <title>{`${boothName(s.b.device_id)}: ${s.b.luot} lượt (${Math.round(s.frac * 100)}%)`}</title>
                                                    </path>
                                                ))
                                            )}
                                            <text x={cx} y={cy - 2} textAnchor="middle" fontSize="20" fontWeight="800" fill="#1a1a2e">{totalCount}</text>
                                            <text x={cx} y={cy + 15} textAnchor="middle" fontSize="10" fill="#9ca3af">lượt chụp</text>
                                        </svg>
                                        <div className="grid min-w-0 flex-1 grid-cols-1 gap-x-5 gap-y-2 xl:grid-cols-2">
                                            {slices.map((s) => (
                                                <div key={s.b.device_id} className="flex items-center gap-2 text-sm">
                                                    <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: s.color }} />
                                                    <span className="truncate font-semibold text-[#1a1a2e]">{boothName(s.b.device_id)}</span>
                                                    <span className="ml-auto whitespace-nowrap font-bold text-gray-500">{s.b.luot} · {Math.round(s.frac * 100)}%</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            );
                        })()}
                    </div>
                );
            })()}


            <div className="space-y-4 md:space-y-6">
                {/* Doanh thu theo booth — full chiều rộng */}
                <div>
                    <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
                        <div className="flex items-baseline gap-2 px-4 pt-4 sm:px-6 sm:pt-5">
                            <h3 className="text-base font-black text-[#1a1a2e]">Doanh thu theo booth</h3>
                            <span className="text-xs font-semibold text-gray-400">{revenueByBooth.length}</span>
                        </div>

                        {revenueByBooth.length > 0 ? (
                            <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2 xl:grid-cols-3 md:gap-4 sm:p-6 sm:pt-4">
                                {revenueByBooth.map((b) => (
                                    <div key={b.device_id} className="rounded-2xl border border-gray-100 bg-[#FFFDF2] p-3.5">
                                        <div className="mb-2 flex items-start justify-between gap-2">
                                            <div className="min-w-0">
                                                {editingDevice === b.device_id ? (
                                                    <div className="flex items-center gap-1.5">
                                                        <input
                                                            value={editNameValue}
                                                            onChange={(e) => setEditNameValue(e.target.value)}
                                                            onKeyDown={(e) => e.key === 'Enter' && saveBoothName(b.device_id)}
                                                            autoFocus
                                                            className="w-36 rounded-lg border border-gray-200 px-2 py-1 text-sm font-bold focus:border-[#DDBF9B] focus:outline-none"
                                                        />
                                                        <button onClick={() => saveBoothName(b.device_id)} className="rounded-md bg-[#987351] p-1.5 text-white hover:bg-[#7B5E43]"><Check size={14} /></button>
                                                        <button onClick={() => setEditingDevice(null)} className="rounded-md border border-gray-200 p-1.5 text-gray-400 hover:bg-gray-50"><X size={14} /></button>
                                                    </div>
                                                ) : (
                                                    <button onClick={() => startEditBooth(b.device_id)} title="Đổi tên booth" className="group flex items-center gap-1.5 text-left">
                                                        <span className="truncate text-base font-black text-[#1a1a2e]">{boothName(b.device_id)}</span>
                                                        <Pencil size={13} className="shrink-0 text-gray-300 group-hover:text-[#987351]" />
                                                    </button>
                                                )}
                                                <p className="font-mono text-xs text-gray-400">{b.count} giao dịch</p>
                                            </div>
                                            <div className="flex shrink-0 items-center gap-2">
                                                <p className="text-lg font-black text-[#e63946]">{formatCurrency(b.total)}</p>
                                                <button
                                                    onClick={() => hideBooth(b.device_id)}
                                                    title="Ẩn booth khỏi bảng (cần mật khẩu)"
                                                    className="rounded-md border border-red-100 bg-red-50 p-1.5 text-red-500 transition-colors hover:bg-red-500 hover:text-white"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-3 gap-1.5 text-center">
                                            <div className="rounded-lg bg-white p-1.5">
                                                <p className="text-[9px] font-bold uppercase text-gray-400">Tiền mặt</p>
                                                <p className="mt-0.5 text-xs font-bold text-[#1a1a2e]">{formatCurrency(b.cash)}</p>
                                            </div>
                                            <div className="rounded-lg bg-white p-1.5">
                                                <p className="text-[9px] font-bold uppercase text-gray-400">QR</p>
                                                <p className="mt-0.5 text-xs font-bold text-[#1a1a2e]">{formatCurrency(b.qr)}</p>
                                            </div>
                                            <div className="rounded-lg bg-white p-1.5">
                                                <p className="text-[9px] font-bold uppercase text-gray-400">Voucher</p>
                                                <p className="mt-0.5 text-xs font-bold text-[#1a1a2e]">{formatCurrency(b.code)}</p>
                                            </div>
                                        </div>
                                        {boothMachines(b.device_id).length > 0 && (
                                            <div className={`mt-2.5 border-t pt-2.5 text-[11px] ${boothMachines(b.device_id).length > 1 ? 'border-red-200' : 'border-gray-100'}`}>
                                                {boothMachines(b.device_id).length > 1 && (
                                                    <p className="mb-1 rounded-lg bg-red-50 px-2 py-1 font-bold text-red-600">
                                                        ⚠ {boothMachines(b.device_id).length} máy đang dùng chung mã này — doanh thu bị gộp. Cần đổi mã ở một máy.
                                                    </p>
                                                )}
                                                {boothMachines(b.device_id).map((m) => (
                                                    <p key={m.hostname} className="truncate font-mono text-gray-500" title={`${m.hostname} · ${m.install_dir || ''} · v${m.version || '?'} · thấy lần cuối ${fmtSeen(m.last_seen)}`}>
                                                        🖥 <span className="font-bold text-[#1a1a2e]">{m.hostname}</span> · v{m.version || '?'} · {fmtSeen(m.last_seen)}
                                                        {m.install_dir ? <span className="text-gray-400"> · {m.install_dir}</span> : null}
                                                    </p>
                                                ))}
                                            </div>
                                        )}
                                        {boothReport(b.device_id) && (
                                            <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-gray-100 pt-2.5 text-[11px] font-bold text-gray-500">
                                                <span>🧻 Giấy còn: <span className="text-[#1a1a2e]">{boothReport(b.device_id).paper_remaining != null ? `${boothReport(b.device_id).paper_remaining} tấm` : '--'}</span></span>
                                                <span>💵 Tiền mặt {boothReport(b.device_id).business_date || 'hôm qua'}: <span className="text-[#1a1a2e]">{formatCurrency(boothReport(b.device_id).cash_total)}</span> ({boothReport(b.device_id).cash_count} lần)</span>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="p-8 text-center text-sm text-gray-400">Chưa có doanh thu theo booth.</div>
                        )}
                    </div>
                </div>

                {/* Transactions Section — full chiều rộng */}
                <div>
                    <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
                        <div className="px-4 py-3 sm:px-6 sm:py-4 border-b border-gray-100 flex items-center justify-between">
                            <div className="flex items-baseline gap-2">
                                <h3 className="text-base font-black text-[#1a1a2e]">Giao dịch</h3>
                                <span className="text-xs font-semibold text-gray-400">{stats.transactions?.length || 0}</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <button className="hidden md:block p-3 bg-white border border-gray-100 rounded-2xl text-gray-400 hover:text-[#e63946]">
                                    <Download size={20} />
                                </button>

                                <button
                                    onClick={() => setShowResetModal(true)}
                                    className="hidden md:block p-3 bg-red-50 border border-red-100 rounded-2xl text-red-500 hover:bg-red-500 hover:text-white transition-all"
                                    title="Reset doanh thu"
                                >
                                    <Trash2 size={20} />
                                </button>
                            </div>
                        </div>

                        {/* Mobile Cards View */}
                        <div className="md:hidden flex flex-col divide-y divide-gray-100">
                            {stats.transactions?.length > 0 ? (
                                visibleTransactions.map((tx) => (
                                    <div key={tx.id} className={`px-4 py-2.5 flex flex-col gap-1 transition-colors ${getMethodStyle(tx).row} ${getMethodStyle(tx).left}`}>
                                        {/* Hàng 1: phương thức + giá trị */}
                                        <div className="flex items-center justify-between gap-3">
                                            <div className="min-w-0 flex items-center gap-2 font-bold text-[#1a1a2e]">
                                                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${getMethodStyle(tx).dot}`} />
                                                <span className="truncate">{getMethodLabel(tx)}</span>
                                            </div>
                                            <div className="shrink-0 text-right">
                                                <span className="block font-black text-[#e63946] text-base whitespace-nowrap">{formatCurrency(tx.value)}</span>
                                                {paymentBreakdown(tx) && (
                                                    <span className="block text-[11px] font-semibold text-gray-500 whitespace-nowrap">{paymentBreakdown(tx)}</span>
                                                )}
                                            </div>
                                        </div>
                                        {/* Hàng 2: mã / NV / booth · giờ + trạng thái + nút xem (trạng thái/nút shrink-0 -> không bị cắt) */}
                                        <div className="flex items-center justify-between gap-3">
                                            <div className="min-w-0 truncate text-[11px] text-gray-500">
                                                {getMethodDetail(tx) && <span className="font-mono font-bold text-[#e63946]">{getMethodDetail(tx)} · </span>}
                                                {tx.staff_name && <span>{tx.staff_name} · </span>}
                                                {tx.device_id && <span>{boothName(tx.device_id)} · </span>}
                                                <span className="text-gray-400">
                                                    {tx.used_at ? new Date(tx.used_at).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : '-'}
                                                </span>
                                            </div>
                                            <div className="flex shrink-0 items-center gap-2">
                                                {statusInfo(tx) && <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide ${statusInfo(tx).cls}`}>{statusInfo(tx).label}</span>}
                                                <a href={`/album/${tx.id}`} target="_blank" rel="noopener noreferrer" aria-label="Xem chi tiết" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#e63946]/10 text-[#e63946] active:scale-90">
                                                    <Eye size={15} />
                                                </a>
                                            </div>
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <div className="p-8 text-center text-gray-400">Không có dữ liệu</div>
                            )}
                        </div>

                        {/* Desktop Table View */}
                        <div className="hidden md:block overflow-x-auto">
                            <table className="w-full border-collapse">
                                <thead className="bg-gray-50/50">
                                    <tr>
                                        <th className="pl-8 pr-4 py-5 text-left text-xs font-black text-gray-400 uppercase tracking-widest">Phương thức</th>
                                        <th className="px-4 py-5 text-left text-xs font-black text-gray-400 uppercase tracking-widest">Máy chụp</th>
                                        <th className="px-4 py-5 text-left text-xs font-black text-gray-400 uppercase tracking-widest">Giá trị</th>
                                        <th className="px-4 py-5 text-left text-xs font-black text-gray-400 uppercase tracking-widest">Thời gian</th>
                                        <th className="px-4 py-5 text-left text-xs font-black text-gray-400 uppercase tracking-widest">Trạng thái</th>
                                        <th className="pl-4 pr-8 py-5 text-right text-xs font-black text-gray-400 uppercase tracking-widest">Hành động</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200">
                                    {stats.transactions?.length > 0 ? (
                                        visibleTransactions.map((tx) => (
                                            <tr key={tx.id} className={`transition-colors group ${getMethodStyle(tx).row}`}>
                                                <td className="pl-8 pr-4 py-6">
                                                    {methodBadge(tx)}
                                                    {getMethodDetail(tx) && (
                                                        <span className="mt-1 block font-mono text-xs font-bold text-[#e63946]">{getMethodDetail(tx)}</span>
                                                    )}
                                                    {tx.staff_name && (
                                                        <span className="mt-0.5 block text-xs text-gray-500">NV lấy mã: {tx.staff_name}</span>
                                                    )}
                                                </td>
                                                <td className="px-4 py-6">
                                                    {tx.device_id ? (
                                                        <span className="inline-flex items-center px-2 py-1 rounded-md bg-gray-100 text-gray-600 text-xs font-bold">
                                                            {boothName(tx.device_id)}
                                                        </span>
                                                    ) : (
                                                        <span className="text-gray-400 text-xs">-</span>
                                                    )}
                                                </td>
                                                <td className="px-4 py-6 font-black text-[#e63946]">
                                                    {formatCurrency(tx.value)}
                                                    {paymentBreakdown(tx) && (
                                                        <span className="mt-0.5 block text-xs font-semibold text-gray-500">{paymentBreakdown(tx)}</span>
                                                    )}
                                                </td>
                                                <td className="px-4 py-6 text-sm text-gray-500">
                                                    {tx.used_at ? new Date(tx.used_at).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : '-'}
                                                </td>
                                                <td className="px-4 py-6">
                                                    {statusInfo(tx) && (
                                                        <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide ${statusInfo(tx).cls}`}>
                                                            {statusInfo(tx).label}
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="pl-4 pr-8 py-6 text-right">
                                                    <a
                                                        href={`/album/${tx.id}`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="inline-flex items-center justify-center p-3 bg-gray-50 text-gray-400 hover:bg-[#e63946] hover:text-white rounded-2xl transition-all active:scale-90"
                                                    >
                                                        <Eye size={20} />
                                                    </a>
                                                </td>
                                            </tr>
                                        ))
                                    ) : (
                                        <tr>
                                            <td colSpan="5" className="px-8 py-20 text-center text-gray-400">
                                                Không tìm thấy giao dịch nào.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>

                        {/* Cuộn tới đây -> tự nạp thêm 1 lô; kèm nút bấm dự phòng. Chỉ hiện khi còn dòng chưa hiển thị. */}
                        {stats.transactions?.length > visibleCount && (
                            <div ref={loadMoreRef} className="flex items-center justify-center border-t border-gray-100 py-5">
                                <button
                                    type="button"
                                    onClick={() => setVisibleCount((c) => Math.min(c + TX_PAGE_SIZE, stats.transactions.length))}
                                    className="inline-flex items-center gap-2 rounded-full bg-gray-100 px-5 py-2.5 text-sm font-bold text-gray-600 transition-colors hover:bg-gray-200"
                                >
                                    Tải thêm · đang hiện {visibleCount}/{stats.transactions.length}
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {showResetModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
                    <div className="bg-white rounded-3xl p-7 w-[380px] shadow-2xl animate-fadeIn">
                        <h3 className="text-xl font-black text-[#1a1a2e] mb-2">
                            Reset doanh thu
                        </h3>

                        <p className="text-gray-500 text-sm mb-5">
                            Nhập mật khẩu đăng nhập của bạn để <span className="font-semibold text-[#1a1a2e]">XÓA VĨNH VIỄN</span> toàn bộ dữ liệu:
                            mã thanh toán (kể cả voucher chưa dùng), session, ảnh, motion và giao dịch QR — khỏi database và storage.
                            <br />
                            <span className="text-red-500 font-semibold">
                                Hành động này không thể hoàn tác. Album đã chia sẻ cho khách sẽ ngừng hoạt động.
                            </span>
                        </p>

                        <input
                            type="password"
                            placeholder="Mật khẩu đăng nhập"
                            autoComplete="current-password"
                            value={resetPassword}
                            onChange={(e) => setResetPassword(e.target.value)}
                            className="w-full border border-gray-200 rounded-xl p-3 mb-3 outline-none focus:ring-2 focus:ring-red-200"
                        />

                        {resetError && (
                            <p className="text-red-500 text-sm mb-3">{resetError}</p>
                        )}

                        <div className="flex gap-3">
                            <button
                                onClick={() => {
                                    setShowResetModal(false);
                                    setResetPassword('');
                                    setResetError('');
                                }}
                                className="flex-1 py-3 rounded-xl bg-gray-100 font-semibold"
                            >
                                Hủy
                            </button>

                            <button
                                onClick={handleResetRevenue}
                                disabled={resetLoading}
                                className="flex-1 py-3 rounded-xl bg-red-500 text-white font-bold hover:bg-red-600"
                            >
                                {resetLoading ? 'Đang reset...' : 'Reset'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {hideTarget && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
                    <div className="bg-white rounded-3xl p-7 w-[380px] shadow-2xl animate-fadeIn">
                        <h3 className="text-xl font-black text-[#1a1a2e] mb-2">
                            Ẩn booth khỏi bảng doanh thu
                        </h3>

                        <p className="text-gray-500 text-sm mb-5">
                            Ẩn booth <span className="font-bold text-[#1a1a2e]">"{boothName(hideTarget)}"</span> khỏi bảng doanh thu.
                            <br />
                            <span className="text-gray-400">Dữ liệu vẫn được giữ trên cloud, có thể khôi phục.</span>
                        </p>

                        {hideError && (
                            <p className="text-red-500 text-sm mb-3">{hideError}</p>
                        )}

                        <div className="flex gap-3">
                            <button
                                onClick={() => { setHideTarget(null); setHideError(''); }}
                                className="flex-1 py-3 rounded-xl bg-gray-100 font-semibold"
                            >
                                Hủy
                            </button>
                            <button
                                onClick={confirmHideBooth}
                                disabled={hideLoading}
                                className="flex-1 py-3 rounded-xl bg-red-500 text-white font-bold hover:bg-red-600 disabled:opacity-50"
                            >
                                {hideLoading ? 'Đang ẩn...' : 'Ẩn booth'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default RevenueDashboard;
