import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { DollarSign, Calendar, TrendingUp, Download, Eye, Filter, ChevronDown, ChevronUp, Clock, CheckCircle, Banknote, QrCode, Hash, Check, Trash2 } from 'lucide-react';
import { io } from "socket.io-client";

const CLOUD_API_URL = import.meta.env.VITE_CLOUD_API_URL || '';
const apiPath = (path) => `${CLOUD_API_URL}${path}`;

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
    const [resetLoading, setResetLoading] = useState(false);
    const [resetError, setResetError] = useState('');
    const [notification, setNotification] = useState(null);

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

        const today = new Date();
        const startBase = dateRange.startDate ? new Date(dateRange.startDate) : new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const endBase = dateRange.endDate ? new Date(dateRange.endDate) : new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const [startHour = 0, startMinute = 0] = (dateRange.startTime || '00:00').split(':').map(Number);
        const [endHour = 23, endMinute = 59] = (dateRange.endTime || '23:59').split(':').map(Number);

        startBase.setHours(startHour, startMinute, 0, 0);
        endBase.setHours(endHour, endMinute, 59, 999);

        return { start: startBase, end: endBase };
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
        });

        return () => socket.disconnect();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleFilter = (e) => {
        e.preventDefault();
        fetchRevenue();
    };

    const formatCurrency = (amount) => {
        return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(Number(amount || 0));
    };

    const getMethodLabel = (tx) => {
        if (tx.method_label) return tx.method_label;
        const method = String(tx.payment_method || '').toLowerCase();
        if (method === 'cash') return 'Tiền mặt';
        if (method === 'qr' || method === 'sepay') return 'Chuyển khoản QR';
        if (method === 'code') return 'Mã thanh toán';
        if (method === 'code+cash') return 'Mã + tiền mặt';
        if (method === 'code+qr') return 'Mã + QR';
        return tx.payment_method || 'Không xác định';
    };

    const getMethodDetail = (tx) => {
        if (tx.detail_label) return tx.detail_label;
        const details = [];
        if (tx.payment_code) details.push(`Mã: ${tx.payment_code}`);
        if (tx.sepay_order_code) details.push(`QR: ${tx.sepay_order_code}`);
        return details.join(' • ');
    };

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

            setNotification('Đã reset doanh thu thành công');
            setTimeout(() => setNotification(null), 3000);
        } catch {
            setResetError('Reset thất bại');
        } finally {
            setResetLoading(false);
        }
    };

    const periodStats = (() => {
        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        const startOfWeek = new Date(now);
        const day = now.getDay();
        const diff = now.getDate() - day + (day === 0 ? -6 : 1);
        startOfWeek.setDate(diff);
        startOfWeek.setHours(0, 0, 0, 0);
        const startOfWeekTime = startOfWeek.getTime();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

        let today = 0;
        let week = 0;
        let month = 0;

        stats.transactions?.forEach(tx => {
            if (!tx.used_at) return;
            const txTime = new Date(tx.used_at).getTime();
            if (txTime >= startOfDay) today += tx.value;
            if (txTime >= startOfWeekTime) week += tx.value;
            if (txTime >= startOfMonth) month += tx.value;
        });

        return { today, week, month };
    })();

    // Build chart data: group transactions by day for bar chart
    const chartData = (() => {
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

        // Generate all days in range
        const days = [];
        const cur = new Date(rangeStart);
        while (cur <= rangeEnd) {
            const key = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`;
            days.push({ key, label: `${String(cur.getDate()).padStart(2, '0')}/${String(cur.getMonth() + 1).padStart(2, '0')}`, total: 0 });
            cur.setDate(cur.getDate() + 1);
        }

        // Aggregate
        txs.forEach(tx => {
            if (!tx.used_at) return;
            const d = new Date(tx.used_at);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            const found = days.find(day => day.key === key);
            if (found) found.total += tx.value;
        });

        return days;
    })();

    return (
        <div className="space-y-6 md:space-y-8 animate-fadeIn pb-20 md:pb-0">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6 lg:mb-8">
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold text-[#2f3e46] tracking-tight">Thống kê doanh thu</h1>
                    <p className="text-[#52796f] mt-1 text-sm md:text-base">Theo dõi hiệu quả kinh doanh của bạn.</p>
                </div>
            </div>

            {notification && (
                <div className="p-4 rounded-xl mb-6 bg-green-50 text-green-700 border border-green-100 flex items-center gap-2 animate-fadeIn">
                    <CheckCircle size={20} />
                    <span className="font-bold">{notification}</span>
                </div>
            )}

            {/* Stats Cards - Đã sửa lỗi bị khuất số */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-6">
                {[
                    { label: 'Hôm nay', value: periodStats.today, icon: <Calendar size={20} />, color: 'emerald', bg: 'bg-emerald-50', text: 'text-emerald-600', border: 'border-emerald-100' },
                    { label: 'Tuần này', value: periodStats.week, icon: <TrendingUp size={20} />, color: 'blue', bg: 'bg-blue-50', text: 'text-blue-600', border: 'border-blue-100' },
                    { label: 'Tháng này', value: periodStats.month, icon: <TrendingUp size={20} />, color: 'purple', bg: 'bg-purple-50', text: 'text-purple-600', border: 'border-purple-100' },
                    { label: 'Tổng thu', value: stats.totalRevenue, icon: <DollarSign size={20} />, color: 'amber', bg: 'bg-amber-50', text: 'text-amber-600', border: 'border-amber-100' },
                ].map((item, idx) => (
                    // SỬA: p-4 -> p-3 (giảm lề) để tăng diện tích hiển thị
                    <div key={idx} className={`bg-white p-3 md:p-5 rounded-2xl md:rounded-3xl shadow-sm border ${item.border} flex flex-col gap-2 md:gap-3 hover:shadow-md transition-all h-full justify-between`}>
                        <div className="flex items-center gap-2 md:gap-3">
                            <div className={`w-8 h-8 md:w-10 md:h-10 shrink-0 ${item.bg} ${item.text} rounded-xl flex items-center justify-center`}>
                                {item.icon}
                            </div>
                            <p className="text-gray-400 text-[10px] md:text-xs uppercase tracking-wider font-bold truncate">{item.label}</p>
                        </div>

                        {/* SỬA: Bỏ 'truncate', thêm 'break-words', chỉnh font size mobile xuống text-base */}
                        <h2 className="text-base sm:text-lg md:text-2xl font-black text-[#2f3e46] break-words leading-tight">
                            {formatCurrency(item.value)}
                        </h2>
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

                // --- Line chart geometry ---
                const LW = 700, LH = 200, LP_L = 72, LP_R = 16, LP_T = 20, LP_B = 36;
                const lPlotW = LW - LP_L - LP_R, lPlotH = LH - LP_T - LP_B;
                const lPts = chartData.map((d, i) => ({
                    x: LP_L + (n === 1 ? lPlotW / 2 : (i / (n - 1)) * lPlotW),
                    y: LP_T + lPlotH - (d.total / yMax) * lPlotH,
                    ...d
                }));
                const smoothPath = lPts.length === 1
                    ? `M ${lPts[0].x},${lPts[0].y}`
                    : lPts.reduce((path, p, i) => {
                        if (i === 0) return `M ${p.x},${p.y}`;
                        const prev = lPts[i - 1];
                        const cpX = (prev.x + p.x) / 2;
                        return path + ` C ${cpX},${prev.y} ${cpX},${p.y} ${p.x},${p.y}`;
                    }, '');
                const fillPath = smoothPath +
                    ` L ${lPts[lPts.length - 1].x},${LP_T + lPlotH}` +
                    ` L ${lPts[0].x},${LP_T + lPlotH} Z`;
                const lLabelStep = Math.ceil(n / 8);

                // --- Bar chart geometry ---
                const BW = 700, BH = 200, BP_L = 72, BP_R = 16, BP_T = 20, BP_B = 36;
                const bPlotW = BW - BP_L - BP_R, bPlotH = BH - BP_T - BP_B;
                const barW = Math.max(4, Math.min(28, Math.floor(bPlotW / n) - 4));
                const bLabelStep = Math.ceil(n / 8);

                return (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

                        {/* Line Chart */}
                        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-5">
                            <div className="flex items-center justify-between mb-3">
                                <div>
                                    <h3 className="text-base font-black text-[#2f3e46]">Xu hướng Doanh thu</h3>
                                    <p className="text-gray-400 text-xs mt-0.5">
                                        {dateRange.startDate || dateRange.endDate || dateRange.startTime || dateRange.endTime ? 'Khoảng đã lọc' : '14 ngày gần nhất'}
                                    </p>
                                </div>
                                <div className="flex items-center gap-1.5 text-xs text-gray-400">
                                    <span className="w-5 h-0.5 rounded-full bg-[#52796f] inline-block" />
                                    Đường xu hướng
                                </div>
                            </div>
                            <svg viewBox={`0 0 ${LW} ${LH}`} className="w-full" style={{ display: 'block', height: LH }} preserveAspectRatio="xMidYMid meet">
                                <defs>
                                    <linearGradient id="revGrad2" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="#52796f" stopOpacity="0.28" />
                                        <stop offset="80%" stopColor="#52796f" stopOpacity="0.04" />
                                        <stop offset="100%" stopColor="#52796f" stopOpacity="0" />
                                    </linearGradient>
                                    <clipPath id="revClip2"><rect x={LP_L} y={LP_T} width={lPlotW} height={lPlotH} /></clipPath>
                                </defs>
                                {yTicks.map((r, i) => {
                                    const y = LP_T + lPlotH - r * lPlotH;
                                    return (
                                        <g key={i}>
                                            <line x1={LP_L} y1={y} x2={LW - LP_R} y2={y} stroke={r === 0 ? '#e5e7eb' : '#f3f4f6'} strokeWidth={r === 0 ? 1.5 : 1} strokeDasharray={r > 0 ? '4 3' : '0'} />
                                            <text x={LP_L - 6} y={y + 4} textAnchor="end" fontSize={9} fill="#9ca3af">{formatK(Math.round(yMax * r))}</text>
                                        </g>
                                    );
                                })}
                                <path d={fillPath} fill="url(#revGrad2)" clipPath="url(#revClip2)" />
                                <path d={smoothPath} fill="none" stroke="#52796f" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" clipPath="url(#revClip2)" />
                                {lPts.map((p, i) => {
                                    const isToday = p.key === todayKey;
                                    const showLabel = i === 0 || i === n - 1 || isToday || i % lLabelStep === 0;
                                    return (
                                        <g key={p.key}>
                                            {isToday && <line x1={p.x} y1={LP_T} x2={p.x} y2={LP_T + lPlotH} stroke="#84a98c" strokeWidth="1" strokeDasharray="3 3" opacity={0.6} />}
                                            {p.total > 0 && <circle cx={p.x} cy={p.y} r={isToday ? 7 : 5} fill="white" stroke={isToday ? '#84a98c' : '#52796f'} strokeWidth={isToday ? 2 : 1.5} />}
                                            {p.total > 0 && <circle cx={p.x} cy={p.y} r={isToday ? 3.5 : 2.5} fill={isToday ? '#84a98c' : '#52796f'} />}
                                            <title>{`${p.label}: ${new Intl.NumberFormat('vi-VN').format(p.total)}đ`}</title>
                                            {showLabel && <text x={p.x} y={LH - 6} textAnchor="middle" fontSize={9} fill={isToday ? '#52796f' : '#b0b7bf'} fontWeight={isToday ? '700' : '400'}>{p.label}</text>}
                                        </g>
                                    );
                                })}
                            </svg>
                        </div>

                        {/* Bar Chart */}
                        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-5">
                            <div className="flex items-center justify-between mb-3">
                                <div>
                                    <h3 className="text-base font-black text-[#2f3e46]">Doanh thu từng ngày</h3>
                                    <p className="text-gray-400 text-xs mt-0.5">
                                        {dateRange.startDate || dateRange.endDate || dateRange.startTime || dateRange.endTime ? 'Khoảng đã lọc' : '14 ngày gần nhất'}
                                    </p>
                                </div>
                                <div className="flex items-center gap-1.5 text-xs text-gray-400">
                                    <span className="w-3 h-3 rounded-sm bg-[#52796f] inline-block" />
                                    Biểu đồ cột
                                </div>
                            </div>
                            <svg viewBox={`0 0 ${BW} ${BH}`} className="w-full" style={{ display: 'block', height: BH }} preserveAspectRatio="xMidYMid meet">
                                <defs>
                                    <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="#52796f" stopOpacity="0.9" />
                                        <stop offset="100%" stopColor="#84a98c" stopOpacity="0.7" />
                                    </linearGradient>
                                    <linearGradient id="barGradToday" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="#2f3e46" stopOpacity="0.85" />
                                        <stop offset="100%" stopColor="#52796f" stopOpacity="0.7" />
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
                                            <title>{`${d.label}: ${new Intl.NumberFormat('vi-VN').format(d.total)}đ`}</title>
                                            {showLabel && <text x={bx} y={BH - 6} textAnchor="middle" fontSize={9} fill={isToday ? '#52796f' : '#b0b7bf'} fontWeight={isToday ? '700' : '400'}>{d.label}</text>}
                                        </g>
                                    );
                                })}
                            </svg>
                        </div>
                    </div>
                );
            })()}


            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Filter Section */}
                <div className="lg:col-span-1">
                    <button
                        onClick={() => setShowMobileFilter(!showMobileFilter)}
                        className="lg:hidden w-full flex items-center justify-between bg-white p-4 rounded-2xl border border-gray-100 shadow-sm mb-4 text-[#2f3e46] font-bold"
                    >
                        <span className="flex items-center gap-2"><Filter size={18} className="text-[#52796f]" /> Bộ lọc doanh thu</span>
                        {showMobileFilter ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                    </button>

                    <div className={`${showMobileFilter ? 'block' : 'hidden'} lg:block bg-white p-6 rounded-3xl shadow-sm border border-gray-100 lg:sticky lg:top-8`}>
                        <h3 className="hidden lg:flex text-lg font-bold text-[#2f3e46] mb-6 items-center gap-2">
                            <Filter size={20} className="text-[#52796f]" />
                            Bộ lọc doanh thu
                        </h3>
                        <form onSubmit={handleFilter} className="space-y-5">
                            <div>
                                <label htmlFor="startDate" className="block text-xs font-bold text-gray-400 uppercase mb-2 ml-1">Từ ngày</label>
                                <input
                                    type="date"
                                    id="startDate"
                                    name="startDate"
                                    className="w-full bg-gray-50 border border-gray-100 rounded-2xl p-4 outline-none focus:bg-white focus:ring-2 focus:ring-[#52796f]/20 focus:border-[#52796f] transition-all font-medium text-gray-700"
                                    value={dateRange.startDate}
                                    onChange={(e) => setDateRange({ ...dateRange, startDate: e.target.value })}
                                />
                            </div>
                            <div>
                                <label htmlFor="endDate" className="block text-xs font-bold text-gray-400 uppercase mb-2 ml-1">Đến ngày</label>
                                <input
                                    type="date"
                                    id="endDate"
                                    name="endDate"
                                    className="w-full bg-gray-50 border border-gray-100 rounded-2xl p-4 outline-none focus:bg-white focus:ring-2 focus:ring-[#52796f]/20 focus:border-[#52796f] transition-all font-medium text-gray-700"
                                    value={dateRange.endDate}
                                    onChange={(e) => setDateRange({ ...dateRange, endDate: e.target.value })}
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label htmlFor="startTime" className="block text-xs font-bold text-gray-400 uppercase mb-2 ml-1">Từ giờ</label>
                                    <input
                                        type="time"
                                        id="startTime"
                                        name="startTime"
                                        className="w-full bg-gray-50 border border-gray-100 rounded-2xl p-4 outline-none focus:bg-white focus:ring-2 focus:ring-[#52796f]/20 focus:border-[#52796f] transition-all font-medium text-gray-700"
                                        value={dateRange.startTime}
                                        onChange={(e) => setDateRange({ ...dateRange, startTime: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label htmlFor="endTime" className="block text-xs font-bold text-gray-400 uppercase mb-2 ml-1">Đến giờ</label>
                                    <input
                                        type="time"
                                        id="endTime"
                                        name="endTime"
                                        className="w-full bg-gray-50 border border-gray-100 rounded-2xl p-4 outline-none focus:bg-white focus:ring-2 focus:ring-[#52796f]/20 focus:border-[#52796f] transition-all font-medium text-gray-700"
                                        value={dateRange.endTime}
                                        onChange={(e) => setDateRange({ ...dateRange, endTime: e.target.value })}
                                    />
                                </div>
                            </div>
                            <div className="space-y-1.5" ref={dropdownRef}>
                                <label className="text-xs font-bold text-gray-400 uppercase ml-1">Phương thức</label>
                                <div className="relative">
                                    <button
                                        type="button"
                                        onClick={() => setShowPaymentDropdown(!showPaymentDropdown)}
                                        className={`w-full bg-gray-50/50 border ${showPaymentDropdown ? 'border-[#52796f] ring-4 ring-[#52796f]/10 bg-white' : 'border-gray-100/80 hover:bg-white hover:border-gray-200'} rounded-2xl py-4 pl-4 pr-4 outline-none transition-all flex items-center justify-between group`}
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className={`transition-colors ${showPaymentDropdown ? 'text-[#52796f]' : 'text-gray-400 group-hover:text-gray-500'}`}>
                                                {selectedMethod.icon}
                                            </div>
                                            <span className={`font-bold transition-colors ${showPaymentDropdown ? 'text-[#52796f]' : 'text-[#2f3e46]'}`}>
                                                {selectedMethod.label}
                                            </span>
                                        </div>
                                        <ChevronDown
                                            size={18}
                                            className={`text-gray-400 transition-transform duration-200 ${showPaymentDropdown ? 'rotate-180 text-[#52796f]' : ''}`}
                                        />
                                    </button>

                                    {/* Dropdown Menu */}
                                    {showPaymentDropdown && (
                                        <div className="absolute z-50 w-full mt-2 bg-white rounded-2xl shadow-[0_10px_40px_-10px_rgba(0,0,0,0.1)] border border-gray-100 overflow-hidden animate-in fade-in zoom-in-95 duration-100">
                                            <div className="p-1.5 space-y-0.5">
                                                {PAYMENT_METHODS.map((method) => (
                                                    <button
                                                        key={method.value}
                                                        type="button"
                                                        onClick={() => {
                                                            setPaymentMethod(method.value);
                                                            setShowPaymentDropdown(false);
                                                        }}
                                                        className={`w-full flex items-center justify-between p-3 rounded-xl transition-all ${paymentMethod === method.value
                                                            ? 'bg-[#52796f] text-white shadow-md shadow-[#52796f]/20'
                                                            : 'text-[#2f3e46] hover:bg-gray-50'
                                                            }`}
                                                    >
                                                        <div className="flex items-center gap-3">
                                                            {method.icon}
                                                            <span className="font-bold text-sm">{method.label}</span>
                                                        </div>
                                                        {paymentMethod === method.value && (
                                                            <Check size={16} />
                                                        )}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                            <div className="pt-2 space-y-3">
                                <button
                                    type="submit"
                                    disabled={loading}
                                    className="w-full bg-[#52796f] text-white py-4 rounded-2xl font-bold hover:bg-[#3f6158] transition-all flex items-center justify-center gap-2 shadow-lg shadow-[#52796f]/20 active:scale-[0.98] disabled:opacity-50"
                                >
                                    {loading ? 'Đang tải...' : <><Filter size={20} /> Áp dụng</>}
                                </button>
                                {(dateRange.startDate || dateRange.endDate || dateRange.startTime || dateRange.endTime || paymentMethod) && (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setDateRange({ startDate: '', endDate: '', startTime: '', endTime: '' });
                                            setPaymentMethod('');
                                        }}
                                        className="w-full py-3 text-gray-400 hover:text-red-500 font-bold text-sm transition-colors"
                                    >
                                        Đặt lại mặc định
                                    </button>
                                )}
                            </div>
                        </form>
                    </div>
                </div>

                {/* Transactions Section */}
                <div className="lg:col-span-2">
                    <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
                        <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-gray-50/30">
                            <div>
                                <h3 className="text-xl font-black text-[#2f3e46]">Giao dịch</h3>
                                <p className="text-gray-400 text-sm font-medium mt-1">
                                    {stats.transactions?.length || 0} giao dịch gần nhất
                                </p>
                            </div>
                            <div className="flex items-center gap-2">
                                <button className="hidden md:block p-3 bg-white border border-gray-100 rounded-2xl text-gray-400 hover:text-[#52796f]">
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
                                stats.transactions.map((tx) => (
                                    <div key={tx.id} className="p-5 flex flex-col gap-3 hover:bg-gray-50 transition-colors">
                                        <div className="flex justify-between items-start">
                                            <div>
                                                <span className="font-bold text-[#2f3e46] text-lg block">{getMethodLabel(tx)}</span>
                                                {getMethodDetail(tx) && (
                                                    <span className="font-mono text-xs font-bold text-[#52796f] block mt-0.5">{getMethodDetail(tx)}</span>
                                                )}
                                                <div className="flex items-center gap-1 text-xs text-gray-400 mt-1">
                                                    <Clock size={12} />
                                                    {tx.used_at ? new Date(tx.used_at.endsWith('Z') ? tx.used_at : tx.used_at + 'Z').toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : '-'}
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <span className="font-black text-[#52796f] text-lg block">{formatCurrency(tx.value)}</span>
                                                <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide inline-block mt-1">
                                                    {tx.status}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="pt-2 border-t border-gray-50 flex justify-end">
                                            <a href={`/album/${tx.id}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-sm font-bold text-[#52796f] bg-[#52796f]/10 px-4 py-2 rounded-xl">
                                                <Eye size={16} /> Xem chi tiết
                                            </a>
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
                                        <th className="px-4 py-5 text-left text-xs font-black text-gray-400 uppercase tracking-widest">Giá trị</th>
                                        <th className="px-4 py-5 text-left text-xs font-black text-gray-400 uppercase tracking-widest">Thời gian</th>
                                        <th className="px-4 py-5 text-left text-xs font-black text-gray-400 uppercase tracking-widest">Trạng thái</th>
                                        <th className="pl-4 pr-8 py-5 text-right text-xs font-black text-gray-400 uppercase tracking-widest">Hành động</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-50">
                                    {stats.transactions?.length > 0 ? (
                                        stats.transactions.map((tx) => (
                                            <tr key={tx.id} className="hover:bg-[#52796f]/5 transition-colors group">
                                                <td className="pl-8 pr-4 py-6">
                                                    <span className="block font-black text-sm text-[#2f3e46]">{getMethodLabel(tx)}</span>
                                                    {getMethodDetail(tx) && (
                                                        <span className="mt-1 block font-mono text-xs font-bold text-[#52796f]">{getMethodDetail(tx)}</span>
                                                    )}
                                                </td>
                                                <td className="px-4 py-6 font-black text-[#52796f]">{formatCurrency(tx.value)}</td>
                                                <td className="px-4 py-6 text-sm text-gray-500">
                                                    {tx.used_at ? new Date(tx.used_at.endsWith('Z') ? tx.used_at : tx.used_at + 'Z').toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : '-'}
                                                </td>
                                                <td className="px-4 py-6">
                                                    <span className="bg-green-100 text-green-700 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide">
                                                        {tx.status}
                                                    </span>
                                                </td>
                                                <td className="pl-4 pr-8 py-6 text-right">
                                                    <a
                                                        href={`/album/${tx.id}`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="inline-flex items-center justify-center p-3 bg-gray-50 text-gray-400 hover:bg-[#52796f] hover:text-white rounded-2xl transition-all active:scale-90"
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
                    </div>
                </div>
            </div>

            {showResetModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
                    <div className="bg-white rounded-3xl p-7 w-[380px] shadow-2xl animate-fadeIn">
                        <h3 className="text-xl font-black text-[#2f3e46] mb-2">
                            Reset doanh thu
                        </h3>

                        <p className="text-gray-500 text-sm mb-5">
                            Nhập mã xác nhận để xóa toàn bộ lịch sử doanh thu.
                            <br />
                            <span className="text-red-500 font-semibold">
                                Hành động này không thể hoàn tác.
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
        </div>
    );
};

export default RevenueDashboard;
