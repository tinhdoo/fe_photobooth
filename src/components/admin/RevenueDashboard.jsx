import { useState, useEffect, useRef, useMemo } from 'react';
import axios from 'axios';
import { DollarSign, Calendar, TrendingUp, Download, Eye, Filter, ChevronDown, ChevronUp, Clock, CheckCircle, Banknote, QrCode, Hash, Check, Trash2, Pencil, X } from 'lucide-react';
import { io } from "socket.io-client";

import { CLOUD_API_URL } from '../../config/api';
const apiPath = (path) => `${CLOUD_API_URL}${path}`;

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
    const [stats, setStats] = useState({ totalRevenue: 0, transactions: [] });
    const [loading, setLoading] = useState(false);
    const [showMobileFilter, setShowMobileFilter] = useState(false);
    const [showPaymentDropdown, setShowPaymentDropdown] = useState(false);
    const dropdownRef = useRef(null);
    const [dateRange, setDateRange] = useState({
        startDate: '',
        endDate: '',
        startTime: '',
        endTime: ''
    });
    const [paymentMethod, setPaymentMethod] = useState('');

    const [showResetModal, setShowResetModal] = useState(false);
    const [resetCode, setResetCode] = useState('');
    const [hideTarget, setHideTarget] = useState(null);     // device_id đang chờ ẩn
    const [hidePassword, setHidePassword] = useState('');
    const [hideError, setHideError] = useState('');
    const [hideLoading, setHideLoading] = useState(false);
    const [resetLoading, setResetLoading] = useState(false);
    const [resetError, setResetError] = useState('');
    const [notification, setNotification] = useState(null);
    const [errorMsg, setErrorMsg] = useState('');
    const [chartHover, setChartHover] = useState(null); // { chart: 'line'|'bar', i }
    const [devices, setDevices] = useState([]);
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
        axios.get(apiPath('/api/devices'))
            .then((res) => setDevices(Array.isArray(res.data) ? res.data : []))
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
                await axios.put(apiPath('/api/devices'), { id: row.id, name });
            } else {
                await axios.post(apiPath('/api/devices'), { action: 'heartbeat', device_id: deviceId, name });
            }
            fetchDevices();
        } catch (e) {
            console.error('Đổi tên booth thất bại:', e);
        }
        setEditingDevice(null);
    };

    // Ẩn 1 booth khỏi bảng doanh thu (cần mật khẩu 8686). Không xóa dữ liệu — chỉ lọc khỏi
    // thống kê; có thể khôi phục bằng cách bỏ device_id khỏi hidden_booths trên cloud.
    const hideBooth = (deviceId) => {
        setHideTarget(deviceId);
        setHidePassword('');
        setHideError('');
    };

    const confirmHideBooth = async () => {
        if (!hideTarget) return;
        if (hidePassword !== '8686') { setHideError('Sai mật khẩu.'); return; }
        setHideLoading(true);
        try {
            await axios.post(apiPath('/api/revenue'), { code: hidePassword, action: 'hide_booth', device_id: hideTarget });
            setHideTarget(null);
            setHidePassword('');
            fetchRevenue();
            fetchDevices();
        } catch (e) {
            setHideError(e?.response?.status === 403 ? 'Sai mật khẩu.' : (e?.response?.data?.error || 'Ẩn booth thất bại.'));
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

    // Gộp theo từng booth. total = DOANH THU THẬT (tiền mặt + QR), voucher tách riêng KHÔNG cộng
    // vào total. Mã một phần: phần voucher vào cột voucher, phần còn lại vào tiền mặt/QR.
    const revenueByBooth = useMemo(() => {
        const map = new Map();
        (stats.transactions || []).forEach((tx) => {
            const id = tx.device_id || 'unknown';
            if (!map.has(id)) map.set(id, { device_id: id, total: 0, count: 0, cash: 0, qr: 0, code: 0 });
            const b = map.get(id);
            const m = String(tx.payment_method || '').toLowerCase();
            const applied = voucherApplied(tx);
            const real = realRevenue(tx);
            b.code += applied;                                   // voucher (không tính doanh thu)
            if (m.includes('qr') || m.includes('sepay')) b.qr += real;
            else if (!m.includes('code') || m.includes('cash')) b.cash += real; // pure 'code' -> real=0
            b.total += real;                                     // doanh thu thật = cash + qr
            b.count += 1;
        });
        return Array.from(map.values()).sort((a, b) => b.total - a.total);
    }, [stats.transactions]);

    const PAYMENT_METHODS = [
        { value: '', label: 'Tất cả phương thức', icon: <DollarSign size={18} /> },
        { value: 'cash', label: 'Tiền mặt (Cash)', icon: <Banknote size={18} /> },
        { value: 'qr', label: 'Chuyển khoản (QR)', icon: <QrCode size={18} /> },
        { value: 'code', label: 'Mã thanh toán (Code)', icon: <Hash size={18} /> },
    ];

    // Helper to find selected method for consistent display
    const selectedMethod = PAYMENT_METHODS.find(m => m.value === paymentMethod) || PAYMENT_METHODS[0];

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setShowPaymentDropdown(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

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
            const res = await axios.get(apiPath('/api/revenue'), { params });
            const data = res.data && typeof res.data === 'object' ? res.data : {};
            setStats({
                totalRevenue: Number(data.totalRevenue || 0),
                transactions: Array.isArray(data.transactions) ? data.transactions : [],
                chartData: Array.isArray(data.chartData) ? data.chartData : [],
                paymentBreakdown: data.paymentBreakdown && typeof data.paymentBreakdown === 'object' ? data.paymentBreakdown : {},
            });
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
        return tx.payment_method || 'Không xác định';
    };

    const getMethodDetail = (tx) => {
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
        if (resetCode !== '8686') {
            setResetError('Mã xác nhận không đúng');
            return;
        }

        setResetLoading(true);
        setResetError('');

        try {
            await axios.post(apiPath('/api/revenue'), { code: resetCode });

            setShowResetModal(false);
            setResetCode('');

            fetchRevenue();
            fetchDevices();

            setNotification('Đã reset doanh thu thành công');
            setTimeout(() => setNotification(null), 3000);
        } catch {
            setResetError('Reset thất bại');
        } finally {
            setResetLoading(false);
        }
    };

    const periodStats = useMemo(() => {
        const { startOfDay, startOfWeek, startOfMonth } = vnNowBounds();

        let today = 0;
        let week = 0;
        let month = 0;

        stats.transactions?.forEach(tx => {
            if (!tx.used_at) return;
            const txTime = new Date(tx.used_at).getTime();
            const val = realRevenue(tx); // voucher đã bị loại khỏi doanh thu
            if (txTime >= startOfDay) today += val;
            if (txTime >= startOfWeek) week += val;
            if (txTime >= startOfMonth) month += val;
        });

        return { today, week, month };
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
            days.push({ key, label: `${String(cd.getUTCDate()).padStart(2, '0')}/${String(cd.getUTCMonth() + 1).padStart(2, '0')}`, total: 0 });
            curU += 24 * 60 * 60 * 1000;
        }

        // Gom theo ngày VN
        txs.forEach(tx => {
            if (!tx.used_at) return;
            const key = vnDateKey(tx.used_at);
            const found = days.find(day => day.key === key);
            if (found) found.total += realRevenue(tx);
        });

        return days;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [stats.transactions, dateRange]);

    return (
        <div className="space-y-6 md:space-y-8 animate-fadeIn pb-20 md:pb-0">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6 lg:mb-8">
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold text-[#1a1a2e] tracking-tight">Thống kê doanh thu</h1>
                    <p className="text-gray-500 mt-1 text-sm md:text-base">Theo dõi hiệu quả kinh doanh của bạn.</p>
                </div>
            </div>

            {notification && (
                <div className="p-4 rounded-xl mb-6 bg-green-50 text-green-700 border border-green-100 flex items-center gap-2 animate-fadeIn">
                    <CheckCircle size={20} />
                    <span className="font-bold">{notification}</span>
                </div>
            )}

            {/* Stats Cards - Đã sửa lỗi bị khuất số */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 md:gap-6">
                {[
                    { label: 'Hôm nay', value: periodStats.today, icon: <Calendar size={20} />, color: 'emerald', bg: 'bg-emerald-50', text: 'text-emerald-600', border: 'border-emerald-100' },
                    { label: 'Tuần này', value: periodStats.week, icon: <TrendingUp size={20} />, color: 'blue', bg: 'bg-blue-50', text: 'text-blue-600', border: 'border-blue-100' },
                    { label: 'Tháng này', value: periodStats.month, icon: <TrendingUp size={20} />, color: 'purple', bg: 'bg-purple-50', text: 'text-purple-600', border: 'border-purple-100' },
                    { label: 'Tổng thu', value: realTotalRevenue, icon: <DollarSign size={20} />, color: 'amber', bg: 'bg-amber-50', text: 'text-amber-600', border: 'border-amber-100' },
                    { label: 'Voucher', value: voucherStats.total, note: `Hôm nay ${voucherStats.today.toLocaleString('vi-VN')}đ · ${voucherStats.count} lượt`, icon: <Hash size={20} />, color: 'orange', bg: 'bg-orange-50', text: 'text-orange-600', border: 'border-orange-100', span: 'col-span-2 lg:col-span-1' },
                ].map((item, idx) => (
                    // SỬA: p-4 -> p-3 (giảm lề) để tăng diện tích hiển thị
                    <div key={idx} className={`bg-white p-3 md:p-5 rounded-2xl md:rounded-3xl shadow-sm border ${item.border} ${item.span || ''} flex flex-col gap-2 md:gap-3 hover:shadow-md transition-all h-full justify-between`}>
                        <div className="flex items-center gap-2 md:gap-3">
                            <div className={`w-8 h-8 md:w-10 md:h-10 shrink-0 ${item.bg} ${item.text} rounded-xl flex items-center justify-center`}>
                                {item.icon}
                            </div>
                            <p className="text-gray-400 text-[10px] md:text-xs uppercase tracking-wider font-bold truncate">{item.label}</p>
                        </div>

                        {/* SỬA: Bỏ 'truncate', thêm 'break-words', chỉnh font size mobile xuống text-base */}
                        <div>
                            <h2 className="text-base sm:text-lg md:text-2xl font-black text-[#1a1a2e] break-words leading-tight">
                                {formatCurrency(item.value)}
                            </h2>
                            {item.note && (
                                <p className="text-[9px] md:text-[10px] font-bold uppercase tracking-wide text-gray-400 mt-1 truncate">
                                    {item.note}
                                </p>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            {/* Charts — 2 col grid */}
            {chartData.length > 0 && (() => {
                const formatK = v => v === 0 ? '0' : v >= 1000000 ? `${(v / 1000000).toFixed(1)}tr` : v >= 1000 ? `${Math.round(v / 1000)}k` : v;
                const maxVal = Math.max(...chartData.map(d => d.total), 1);
                const yMax = (() => {
                    const mag = Math.pow(10, Math.floor(Math.log10(maxVal)));
                    return Math.ceil(maxVal / mag) * mag;
                })();
                const todayKey = new Date().toISOString().slice(0, 10);
                const n = chartData.length;
                const yTicks = [0, 0.25, 0.5, 0.75, 1];

                // --- Bar chart geometry ---
                const BW = 700, BH = 200, BP_L = 72, BP_R = 16, BP_T = 20, BP_B = 36;
                const bPlotW = BW - BP_L - BP_R, bPlotH = BH - BP_T - BP_B;
                const barW = Math.max(4, Math.min(28, Math.floor(bPlotW / n) - 4));
                const bLabelStep = Math.ceil(n / 8);

                // Tooltip dùng chung cho 2 chart: hộp nổi hiển thị ngày + doanh thu.
                const fmtVnd = v => `${new Intl.NumberFormat('vi-VN').format(v)}đ`;
                const renderTip = (cx, anchorY, label, total, leftBound, rightBound, plotTop) => {
                    const tw = 104, th = 40;
                    let tx = Math.max(leftBound, Math.min(cx - tw / 2, rightBound - tw));
                    let ty = anchorY - th - 10;
                    if (ty < plotTop) ty = anchorY + 12; // không đủ chỗ phía trên -> lật xuống dưới
                    return (
                        <g pointerEvents="none">
                            <rect x={tx} y={ty} width={tw} height={th} rx={7} fill="#1a1a2e" opacity="0.95" />
                            <text x={tx + tw / 2} y={ty + 16} textAnchor="middle" fontSize={10} fill="#cbd5e1">{label}</text>
                            <text x={tx + tw / 2} y={ty + 31} textAnchor="middle" fontSize={11.5} fill="#ffffff" fontWeight="700">{fmtVnd(total)}</text>
                        </g>
                    );
                };

                return (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-5">

                        {/* Bar Chart */}
                        <div className="bg-white rounded-2xl md:rounded-3xl shadow-sm border border-gray-100 p-4 sm:p-5">
                            <div className="flex items-center justify-between mb-3">
                                <div>
                                    <h3 className="text-base font-black text-[#1a1a2e]">Doanh thu từng ngày</h3>
                                    <p className="text-gray-400 text-xs mt-0.5">
                                        {dateRange.startDate || dateRange.endDate || dateRange.startTime || dateRange.endTime ? 'Khoảng đã lọc' : '14 ngày gần nhất'}
                                    </p>
                                </div>
                                <div className="flex items-center gap-1.5 text-xs text-gray-400">
                                    <span className="w-3 h-3 rounded-sm bg-[#e63946] inline-block" />
                                    Biểu đồ cột
                                </div>
                            </div>
                            <svg viewBox={`0 0 ${BW} ${BH}`} className="block w-full" style={{ aspectRatio: `${BW} / ${BH}` }} preserveAspectRatio="xMidYMid meet" onMouseLeave={() => setChartHover(null)}>
                                <defs>
                                    <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="#e63946" stopOpacity="0.9" />
                                        <stop offset="100%" stopColor="#84a98c" stopOpacity="0.7" />
                                    </linearGradient>
                                    <linearGradient id="barGradToday" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="#1a1a2e" stopOpacity="0.85" />
                                        <stop offset="100%" stopColor="#e63946" stopOpacity="0.7" />
                                    </linearGradient>
                                </defs>
                                {yTicks.map((r, i) => {
                                    const y = BP_T + bPlotH - r * bPlotH;
                                    return (
                                        <g key={i}>
                                            <line x1={BP_L} y1={y} x2={BW - BP_R} y2={y} stroke={r === 0 ? '#e5e7eb' : '#f3f4f6'} strokeWidth={r === 0 ? 1.5 : 1} strokeDasharray={r > 0 ? '4 3' : '0'} />
                                            <text x={BP_L - 6} y={y + 4} textAnchor="end" fontSize={9} fill="#9ca3af">{formatK(Math.round(yMax * r))}</text>
                                        </g>
                                    );
                                })}
                                {chartData.map((d, i) => {
                                    const bx = BP_L + (n === 1 ? bPlotW / 2 : (i / (n - 1)) * bPlotW);
                                    const barH = Math.max(d.total > 0 ? 3 : 0, (d.total / yMax) * bPlotH);
                                    const by = BP_T + bPlotH - barH;
                                    const isToday = d.key === todayKey;
                                    const showLabel = i === 0 || i === n - 1 || isToday || i % bLabelStep === 0;
                                    return (
                                        <g key={d.key}>
                                            <rect
                                                x={bx - barW / 2} y={by}
                                                width={barW} height={barH}
                                                rx={3}
                                                fill={isToday ? 'url(#barGradToday)' : (d.total > 0 ? 'url(#barGrad)' : '#f3f4f6')}
                                            />
                                            {showLabel && <text x={bx} y={BH - 6} textAnchor="middle" fontSize={9} fill={isToday ? '#e63946' : '#b0b7bf'} fontWeight={isToday ? '700' : '400'}>{d.label}</text>}
                                        </g>
                                    );
                                })}
                                {/* Vùng bắt hover (trong suốt, phủ cả chiều cao) cho từng cột */}
                                {chartData.map((d, i) => {
                                    const bx = BP_L + (n === 1 ? bPlotW / 2 : (i / (n - 1)) * bPlotW);
                                    const colW = n === 1 ? bPlotW : bPlotW / (n - 1);
                                    return (
                                        <rect key={`h${d.key}`} x={bx - colW / 2} y={BP_T} width={colW} height={bPlotH}
                                            fill="transparent" onMouseEnter={() => setChartHover({ chart: 'bar', i })} />
                                    );
                                })}
                                {/* Tooltip */}
                                {chartHover?.chart === 'bar' && chartData[chartHover.i] && (() => {
                                    const d = chartData[chartHover.i];
                                    const bx = BP_L + (n === 1 ? bPlotW / 2 : (chartHover.i / (n - 1)) * bPlotW);
                                    const barH = Math.max(d.total > 0 ? 3 : 0, (d.total / yMax) * bPlotH);
                                    const by = BP_T + bPlotH - barH;
                                    return (
                                        <g pointerEvents="none">
                                            <rect x={bx - barW / 2} y={by} width={barW} height={barH} rx={3} fill="#1a1a2e" opacity={0.18} />
                                            {renderTip(bx, by, d.label, d.total, BP_L, BW - BP_R, BP_T)}
                                        </g>
                                    );
                                })()}
                            </svg>
                        </div>

                        {/* So sánh lượt chụp giữa các booth (biểu đồ tròn) — chuyển lên đây thay biểu đồ đường */}
                        {(() => {
                            const items = revenueByBooth.filter((b) => b.count > 0);
                            if (items.length === 0) return null;
                            const totalCount = items.reduce((s, b) => s + b.count, 0);
                            const COLORS = ['#e63946', '#f4a261', '#2a9d8f', '#457b9d', '#8338ec', '#ffb703', '#84a98c', '#c1121f', '#606c38', '#bc6c25'];
                            const cx = 100, cy = 100, R = 82, r = 50;
                            let a0 = -Math.PI / 2;
                            const slices = items.map((b, i) => {
                                const frac = b.count / totalCount;
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
                                    <h3 className="text-base font-black text-[#1a1a2e] mb-4">So sánh lượt chụp giữa các booth</h3>
                                    <div className="flex flex-col items-center gap-5 sm:flex-row sm:gap-6">
                                        <svg viewBox="0 0 200 200" className="h-40 w-40 shrink-0">
                                            {items.length === 1 ? (
                                                <>
                                                    <circle cx={cx} cy={cy} r={R} fill={slices[0].color} />
                                                    <circle cx={cx} cy={cy} r={r} fill="#fff" />
                                                </>
                                            ) : (
                                                slices.map((s) => (
                                                    <path key={s.b.device_id} d={s.path} fill={s.color} stroke="#fff" strokeWidth="1.5">
                                                        <title>{`${boothName(s.b.device_id)}: ${s.b.count} lượt (${Math.round(s.frac * 100)}%)`}</title>
                                                    </path>
                                                ))
                                            )}
                                            <text x={cx} y={cy - 2} textAnchor="middle" fontSize="20" fontWeight="800" fill="#1a1a2e">{totalCount}</text>
                                            <text x={cx} y={cy + 15} textAnchor="middle" fontSize="10" fill="#9ca3af">lượt chụp</text>
                                        </svg>
                                        <div className="grid w-full flex-1 grid-cols-1 gap-x-5 gap-y-2 sm:grid-cols-2">
                                            {slices.map((s) => (
                                                <div key={s.b.device_id} className="flex items-center gap-2 text-sm">
                                                    <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: s.color }} />
                                                    <span className="truncate font-semibold text-[#1a1a2e]">{boothName(s.b.device_id)}</span>
                                                    <span className="ml-auto whitespace-nowrap font-bold text-gray-500">{s.b.count} · {Math.round(s.frac * 100)}%</span>
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


            <div className="space-y-6 md:space-y-8">
                {/* Bộ lọc — THANH NGANG gọn (áp cho biểu đồ + booth + giao dịch bên dưới) */}
                <div className="bg-white rounded-3xl shadow-sm border border-gray-100">
                    <button
                        onClick={() => setShowMobileFilter(!showMobileFilter)}
                        className="lg:hidden w-full flex items-center justify-between p-4 text-[#1a1a2e] font-bold"
                    >
                        <span className="flex items-center gap-2"><Filter size={18} className="text-[#e63946]" /> Bộ lọc doanh thu</span>
                        {showMobileFilter ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                    </button>

                    <div className={`${showMobileFilter ? 'block' : 'hidden'} lg:block p-4 md:p-5`}>
                        {errorMsg && (
                            <div className="p-3 mb-3 rounded-xl bg-red-50 text-red-600 border border-red-100 text-xs font-bold animate-fadeIn">
                                {errorMsg}
                            </div>
                        )}
                        <form onSubmit={handleFilter} className="flex flex-col sm:flex-row sm:flex-wrap sm:items-end gap-3">
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
                            <div className="flex flex-col gap-1 min-w-0 flex-1 sm:flex-none sm:w-52">
                                <label className="text-[10px] font-bold text-gray-400 uppercase ml-1">Phương thức</label>
                                <div className="relative" ref={dropdownRef}>
                                    <button type="button" onClick={() => setShowPaymentDropdown(!showPaymentDropdown)}
                                        className={`w-full bg-gray-50/50 border ${showPaymentDropdown ? 'border-[#e63946] ring-4 ring-[#e63946]/10 bg-white' : 'border-gray-100/80 hover:bg-white hover:border-gray-200'} rounded-xl py-2 pl-3 pr-3 outline-none transition-all flex items-center justify-between group`}>
                                        <div className="flex items-center gap-2 min-w-0">
                                            <div className={`shrink-0 transition-colors ${showPaymentDropdown ? 'text-[#e63946]' : 'text-gray-400 group-hover:text-gray-500'}`}>{selectedMethod.icon}</div>
                                            <span className={`truncate font-bold text-xs md:text-sm transition-colors ${showPaymentDropdown ? 'text-[#e63946]' : 'text-[#1a1a2e]'}`}>{selectedMethod.label}</span>
                                        </div>
                                        <ChevronDown size={16} className={`shrink-0 text-gray-400 transition-transform duration-200 ${showPaymentDropdown ? 'rotate-180 text-[#e63946]' : ''}`} />
                                    </button>
                                    {showPaymentDropdown && (
                                        <div className="absolute z-50 w-full mt-2 bg-white rounded-2xl shadow-[0_10px_40px_-10px_rgba(0,0,0,0.1)] border border-gray-100 overflow-hidden animate-in fade-in zoom-in-95 duration-100">
                                            <div className="p-1.5 space-y-0.5">
                                                {PAYMENT_METHODS.map((method) => (
                                                    <button key={method.value} type="button"
                                                        onClick={() => { setPaymentMethod(method.value); setShowPaymentDropdown(false); }}
                                                        className={`w-full flex items-center justify-between p-3 rounded-xl transition-all ${paymentMethod === method.value ? 'bg-[#e63946] text-white shadow-md shadow-[#e63946]/20' : 'text-[#1a1a2e] hover:bg-gray-50'}`}>
                                                        <div className="flex items-center gap-3">{method.icon}<span className="font-bold text-sm">{method.label}</span></div>
                                                        {paymentMethod === method.value && (<Check size={16} />)}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                            <div className="flex items-center gap-2 sm:ml-auto">
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
                <div>
                    <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
                        <div className="p-4 sm:p-6 border-b border-gray-100 bg-gray-50/30">
                            <h3 className="text-xl font-black text-[#1a1a2e]">Doanh thu theo booth</h3>
                            <p className="text-gray-400 text-sm font-medium mt-1">
                                {revenueByBooth.length} booth · tách theo tiền mặt / QR / voucher
                            </p>
                        </div>

                        {revenueByBooth.length > 0 ? (
                            <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2 xl:grid-cols-3 md:gap-4 md:p-6">
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
                        <div className="p-4 sm:p-6 border-b border-gray-100 flex items-center justify-between bg-gray-50/30">
                            <div>
                                <h3 className="text-xl font-black text-[#1a1a2e]">Giao dịch</h3>
                                <p className="text-gray-400 text-sm font-medium mt-1">
                                    {stats.transactions?.length || 0} giao dịch gần nhất
                                </p>
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
                                    <div key={tx.id} className={`px-4 py-3 flex flex-col gap-1.5 transition-colors ${getMethodStyle(tx).row} ${getMethodStyle(tx).left}`}>
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
                                        {/* Hàng 2: mã · phòng + trạng thái + nút xem (status/nút luôn shrink-0 -> không bị cắt) */}
                                        <div className="flex items-center justify-between gap-3">
                                            <div className="flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap text-[11px] text-gray-400">
                                                {getMethodDetail(tx) && <span className="font-mono font-bold text-[#e63946] truncate">{getMethodDetail(tx)}</span>}
                                                {tx.staff_name && <span className="shrink-0 text-gray-500">· {tx.staff_name}</span>}
                                                {tx.device_id && <span className="shrink-0">{boothName(tx.device_id)}</span>}
                                            </div>
                                            <div className="flex shrink-0 items-center gap-2">
                                                {statusInfo(tx) && <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide ${statusInfo(tx).cls}`}>{statusInfo(tx).label}</span>}
                                                <a href={`/album/${tx.id}`} target="_blank" rel="noopener noreferrer" aria-label="Xem chi tiết" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#e63946]/10 text-[#e63946] active:scale-90">
                                                    <Eye size={15} />
                                                </a>
                                            </div>
                                        </div>
                                        {/* Hàng 3: ngày giờ (dòng riêng để không đẩy cắt trạng thái) */}
                                        <div className="flex items-center gap-0.5 text-[11px] text-gray-400">
                                            <Clock size={11} />
                                            {tx.used_at ? new Date(tx.used_at).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : '-'}
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
                            Nhập mã xác nhận để <span className="font-semibold text-[#1a1a2e]">XÓA VĨNH VIỄN</span> toàn bộ dữ liệu:
                            mã thanh toán (kể cả voucher chưa dùng), session, ảnh, motion và giao dịch QR — khỏi database và storage.
                            <br />
                            <span className="text-red-500 font-semibold">
                                Hành động này không thể hoàn tác. Album đã chia sẻ cho khách sẽ ngừng hoạt động.
                            </span>
                        </p>

                        <input
                            type="password"
                            placeholder="Nhập mã xác nhận"
                            value={resetCode}
                            onChange={(e) => setResetCode(e.target.value)}
                            className="w-full border border-gray-200 rounded-xl p-3 mb-3 outline-none focus:ring-2 focus:ring-red-200"
                        />

                        {resetError && (
                            <p className="text-red-500 text-sm mb-3">{resetError}</p>
                        )}

                        <div className="flex gap-3">
                            <button
                                onClick={() => {
                                    setShowResetModal(false);
                                    setResetCode('');
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
                            <br />
                            Nhập mật khẩu để xác nhận.
                        </p>

                        <input
                            type="password"
                            placeholder="Nhập mật khẩu"
                            value={hidePassword}
                            autoFocus
                            onChange={(e) => setHidePassword(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && confirmHideBooth()}
                            className="w-full border border-gray-200 rounded-xl p-3 mb-3 outline-none focus:ring-2 focus:ring-red-200"
                        />

                        {hideError && (
                            <p className="text-red-500 text-sm mb-3">{hideError}</p>
                        )}

                        <div className="flex gap-3">
                            <button
                                onClick={() => { setHideTarget(null); setHidePassword(''); setHideError(''); }}
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
