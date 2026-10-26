import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import * as XLSX from 'xlsx';
import { RefreshCw, Clock, Hash, DollarSign, Copy, CheckCircle, XCircle, Calendar, ArrowRight, Plus, Trash2, FileSpreadsheet, User, Check, Ticket, Search, Pencil, ChevronDown } from 'lucide-react';
import { authHeader, isStaffRole, getUsername } from '../../utils/auth';
import { errorMessage } from '../../utils/errorMessage';

const formatCurrency = (value) => `${Number(value || 0).toLocaleString('vi-VN')} ₫`;
const normalizeCode = (code = {}) => ({
    ...code,
    value: Number(code.value ?? code.amount ?? 0),
    is_used: Boolean(code.is_used),
    created_at: code.created_at || new Date().toISOString(),
    created_by: code.created_by || '',
    claimed_by: code.claimed_by || '',
    claimed_by_name: code.claimed_by_name || '',
    claimed_at: code.claimed_at || '',
    note: code.note || '',
    used_session_id: code.used_session_id || '',
});

// Hiển thị mệnh giá gọn: 70000 -> "70k", 100000 -> "100k".
const denomLabel = (value) => {
    const n = Number(value) || 0;
    return n % 1000 === 0 ? `${n / 1000}k` : n.toLocaleString('vi-VN');
};

// Ô ghi chú sửa trực tiếp: gõ xong bấm ✓ (hoặc Enter/rời ô) để lưu. Chỉ lưu khi có thay đổi.
// Định nghĩa ở MODULE SCOPE (không lồng trong CodeManager) để không bị remount -> mất focus.
// canEdit=false -> chỉ hiển thị ghi chú (mã của nhân viên khác), không cho sửa.
const NoteCell = ({ code, onSave, canEdit = true, autoFocus = false }) => {
    const [value, setValue] = useState(code.note || '');
    const [saving, setSaving] = useState(false);
    const dirty = value !== (code.note || '');

    if (!canEdit) {
        return code.note
            ? <span className="text-sm text-gray-600">{code.note}</span>
            : <span className="text-sm text-gray-300 italic">—</span>;
    }

    const commit = async () => {
        if (!dirty || saving) return;
        setSaving(true);
        await onSave(code.id, value.trim());
        setSaving(false);
    };

    return (
        <div className="flex items-center gap-1">
            <input
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
                onBlur={commit}
                autoFocus={autoFocus}
                placeholder="Ghi chú…"
                maxLength={500}
                className="w-full min-w-0 rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5 text-sm outline-none transition-all focus:border-[#e63946] focus:bg-white focus:ring-1 focus:ring-[#e63946]/20"
            />
            {dirty && (
                <button
                    type="button"
                    onClick={commit}
                    disabled={saving}
                    className="shrink-0 rounded-lg bg-emerald-500 p-1.5 text-white transition-all hover:bg-emerald-600 disabled:opacity-60"
                    title="Lưu ghi chú"
                >
                    {saving ? <RefreshCw size={14} className="animate-spin" /> : <Check size={14} />}
                </button>
            )}
        </div>
    );
};

// Xuất danh sách mã ra Excel theo dạng 2 cột voucher song song, nhóm theo
// mệnh giá, kèm cột NOTE trống — tiện in & cắt.
const exportCodesToExcel = (list, fileName) => {
    if (!Array.isArray(list) || list.length === 0) return;

    // Nhóm theo mệnh giá, sắp xếp mệnh giá tăng dần.
    const groups = {};
    list.forEach((c) => {
        const key = Number(c.value) || 0;
        (groups[key] = groups[key] || []).push(c);
    });
    const sortedValues = Object.keys(groups).map(Number).sort((a, b) => a - b);

    const header = ['Voucher', 'Mệnh giá', 'NOTE', 'Voucher', 'Mệnh giá', 'NOTE'];
    const aoa = [header];

    // Mỗi mệnh giá bắt đầu trên một dòng mới, xếp 2 voucher mỗi dòng.
    sortedValues.forEach((value) => {
        const codes = groups[value];
        const denom = denomLabel(value);
        for (let i = 0; i < codes.length; i += 2) {
            const right = codes[i + 1];
            aoa.push([
                String(codes[i].code), denom, '',
                right ? String(right.code) : '', right ? denom : '', '',
            ]);
        }
    });

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [
        { wch: 12 }, { wch: 10 }, { wch: 20 },
        { wch: 12 }, { wch: 10 }, { wch: 20 },
    ];
    // Ép cột Voucher (A=0, D=3) về text để giữ số 0 đứng đầu.
    for (let r = 1; r < aoa.length; r += 1) {
        [0, 3].forEach((c) => {
            const cell = ws[XLSX.utils.encode_cell({ r, c })];
            if (cell && cell.v !== '') cell.t = 's';
        });
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Voucher');
    XLSX.writeFile(wb, fileName);
};

// Menu lọc mệnh giá tự vẽ: <select> gốc mở ra danh sách hệ điều hành, chữ to viền vuông, lạc tông hẳn.
const MenuGia = ({ value, options, onChange }) => {
    const [mo, setMo] = useState(false);
    const ref = useRef(null);
    useEffect(() => {
        if (!mo) return undefined;
        const dong = (e) => { if (ref.current && !ref.current.contains(e.target)) setMo(false); };
        document.addEventListener('pointerdown', dong);
        return () => document.removeEventListener('pointerdown', dong);
    }, [mo]);
    return (
        <div ref={ref} className="relative shrink-0">
            <button
                type="button"
                onClick={() => setMo((m) => !m)}
                aria-haspopup="listbox"
                aria-expanded={mo}
                className={`flex h-[42px] items-center gap-1 rounded-xl border bg-white px-3 text-sm font-semibold transition-all ${value !== 'all' ? 'border-[#e63946] text-[#e63946]' : 'border-gray-200 text-gray-700 hover:border-gray-300'}`}
            >
                {value === 'all' ? 'Mọi giá' : denomLabel(value)}
                <ChevronDown size={14} className={`transition-transform ${mo ? 'rotate-180' : ''}`} />
            </button>
            {mo && (
                <div role="listbox" className="absolute right-0 top-full z-20 mt-1.5 w-32 overflow-hidden rounded-2xl border border-gray-100 bg-white p-1 shadow-xl shadow-black/10">
                    {['all', ...options.map(String)].map((v) => {
                        const on = String(value) === v;
                        return (
                            <button
                                key={v}
                                type="button"
                                role="option"
                                aria-selected={on}
                                onClick={() => { onChange(v); setMo(false); }}
                                className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm font-semibold ${on ? 'bg-[#e63946]/10 text-[#e63946]' : 'text-gray-700 hover:bg-gray-50 active:bg-gray-50'}`}
                            >
                                {v === 'all' ? 'Mọi giá' : denomLabel(v)}
                                {on && <Check size={14} />}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

const CodeManager = () => {
    const staffOnly = isStaffRole(); // nhân viên: chỉ "Lấy mã" từ kho, không tạo mã
    const myUsername = getUsername();
    // Admin sửa mọi ghi chú; nhân viên chỉ sửa mã DO MÌNH lấy.
    const canEditNote = (code) => !staffOnly || (!!code.claimed_by && code.claimed_by === myUsername);
    const [codes, setCodes] = useState([]);
    const [loading, setLoading] = useState(false);
    const [rows, setRows] = useState([{ value: 70000, quantity: 1 }]);
    const [expiresAt, setExpiresAt] = useState('');
    const [showExpiry, setShowExpiry] = useState(false); // hạn dùng: mặc định ẩn, bấm mới mở
    const [notification, setNotification] = useState({ show: false, message: '', type: 'success' });
    const [exportPrompt, setExportPrompt] = useState({ show: false, codes: [] });
    // Trạng thái luồng "Lấy mã" của nhân viên
    const [claimValue, setClaimValue] = useState(0); // 0 = bất kỳ mệnh giá
    const [claiming, setClaiming] = useState(false);
    const [claimedCode, setClaimedCode] = useState(null); // mã vừa lấy để đọc cho khách
    // Số lượng mã còn trong kho theo mệnh giá — lấy từ API (KHÔNG lộ chuỗi mã cho nhân viên).
    const [stock, setStock] = useState([]); // [{ value, count }]
    // Màn nhân viên chia 2 tab: 'lay' (lấy mã đưa khách) | 'cua_toi' (mã mình đã lấy + ghi chú).
    const [tab, setTab] = useState('lay');
    const [khoDaTai, setKhoDaTai] = useState(false); // chưa tải xong kho thì đừng báo "hết mã"
    const [moGhiChu, setMoGhiChu] = useState(null); // id mã đang mở ô ghi chú (màn nhân viên)

    const totalQuantity = rows.reduce((sum, r) => sum + (Number(r.quantity) || 0), 0);
    const stockTotal = stock.reduce((s, d) => s + d.count, 0);

    // Lọc + tìm kiếm danh sách mã (tiện tra "mã nào đã lấy" mà không phải cuộn).
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('all'); // all | stock | claimed | used | expired
    const [valueFilter, setValueFilter] = useState('all'); // 'all' | mệnh giá cụ thể
    // Chỉ liệt kê mệnh giá THẬT SỰ có trong danh sách -> không hiện lựa chọn rỗng.
    const denomOptions = [...new Set(codes.map((c) => Number(c.value) || 0))].sort((a, b) => a - b);
    const codeStatus = (c) => {
        if (c.is_used) return 'used';
        if (c.expires_at && new Date(c.expires_at) < new Date()) return 'expired';
        if (c.claimed_by) return 'claimed';
        return 'stock';
    };
    const tuKhoa = search.trim().toLowerCase();
    const khopGiaVaTim = codes.filter((c) => {
        if (valueFilter !== 'all' && (Number(c.value) || 0) !== Number(valueFilter)) return false;
        if (!tuKhoa) return true;
        return String(c.code).toLowerCase().includes(tuKhoa)
            || String(c.claimed_by_name || c.claimed_by || '').toLowerCase().includes(tuKhoa)
            || String(c.note || '').toLowerCase().includes(tuKhoa);
    });
    const filteredCodes = statusFilter === 'all' ? khopGiaVaTim : khopGiaVaTim.filter((c) => codeStatus(c) === statusFilter);
    // Số mã mỗi trạng thái trong phạm vi giá + từ khoá đang chọn (hiện ngay trên ô lọc của admin).
    const demTrangThai = khopGiaVaTim.reduce((m, c) => { const k = codeStatus(c); m[k] = (m[k] || 0) + 1; return m; }, { all: khopGiaVaTim.length });

    const fetchStock = async () => {
        try {
            const res = await axios.get('/api/codes?action=stock', { headers: authHeader() });
            // Chỉ nhận đúng dạng [{value, count}] — tránh nhầm khi backend cũ trả về mảng mã.
            const data = Array.isArray(res.data)
                ? res.data.filter((d) => d && typeof d.value !== 'undefined' && typeof d.count === 'number')
                : [];
            setStock(data);
        } catch (error) {
            setStock([]);
            // Lộ lỗi thật (vd cột claimed_by chưa có / chưa chạy SQL) thay vì âm thầm báo "hết mã".
            setNotification({ show: true, message: errorMessage(error, 'Không tải được kho mã.'), type: 'error' });
        } finally {
            setKhoDaTai(true);
        }
    };

    const handleClaim = async () => {
        setClaiming(true);
        setClaimedCode(null);
        try {
            const res = await axios.post('/api/codes', { action: 'claim', value: Number(claimValue) || 0 }, { headers: authHeader() });
            const code = res.data?.code ? normalizeCode(res.data.code) : null;
            if (code) {
                setClaimedCode(code);
                fetchCodes();
                fetchStock();
            } else {
                setNotification({ show: true, message: 'Không lấy được mã.', type: 'error' });
            }
        } catch (error) {
            setNotification({ show: true, message: errorMessage(error, 'Lấy mã thất bại.'), type: 'error' });
        } finally {
            setClaiming(false);
        }
    };

    const updateRow = (index, patch) => {
        setRows(prev => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
    };
    const addRow = () => setRows(prev => [...prev, { value: 70000, quantity: 1 }]);
    const removeRow = (index) => setRows(prev => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));

    const getMinDateTime = () => {
        const now = new Date();
        now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
        return now.toISOString().slice(0, 16);
    };

    useEffect(() => {
        fetchCodes();
        if (staffOnly) fetchStock();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Bỏ lựa chọn "Bất kỳ" -> luôn tự chọn 1 mệnh giá còn hàng (mệnh giá đầu tiên) khi kho đổi.
    useEffect(() => {
        if (staffOnly && stock.length && !stock.some((d) => d.value === claimValue)) {
            setClaimValue(stock[0].value);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [stock]);

    const fetchCodes = async () => {
        try {
            const res = await axios.get('/api/codes', { headers: authHeader() });
            const now = new Date();
            const list = Array.isArray(res.data) ? res.data.map(normalizeCode) : [];
            const sortedCodes = list.sort((a, b) => {
                const getPriority = (code) => {
                    const isExpired = code.expires_at && new Date(code.expires_at) < now;
                    if (code.is_used) return 3;
                    if (isExpired) return 2;
                    return 1;
                };

                const priorityA = getPriority(a);
                const priorityB = getPriority(b);

                if (priorityA !== priorityB) {
                    return priorityA - priorityB;
                }

                return new Date(b.created_at) - new Date(a.created_at);
            });
            setCodes(sortedCodes);
        } catch (error) {
            console.error("Error fetching codes:", error);
        }
    };

    const handleGenerate = async () => {
        const batches = rows
            .map(r => ({ value: Number(r.value) || 0, quantity: Math.max(1, Math.min(100, Number(r.quantity) || 1)) }))
            .filter(b => b.value > 0 && b.quantity > 0);

        if (batches.length === 0) {
            setNotification({ show: true, message: "Vui lòng nhập ít nhất một mệnh giá hợp lệ.", type: 'error' });
            return;
        }
        if (batches.reduce((s, b) => s + b.quantity, 0) > 500) {
            setNotification({ show: true, message: "Tổng số mã không được vượt quá 500.", type: 'error' });
            return;
        }

        setLoading(true);
        try {
            const payload = { batches, action: 'generate' };
            if (expiresAt) {
                const selectedDate = new Date(expiresAt);
                if (selectedDate < new Date()) {
                    setNotification({ show: true, message: "Thời gian hết hạn không được ở quá khứ!", type: 'error' });
                    setLoading(false);
                    return;
                }
                payload.expires_at = selectedDate.toISOString();
            }
            const res = await axios.post('/api/codes', payload, { headers: authHeader() });
            const createdRaw = Array.isArray(res.data) ? res.data : [];
            const created = createdRaw.map(normalizeCode);

            fetchCodes();
            // Hỏi xác nhận trước khi xuất Excel cho đúng lô vừa tạo.
            if (created.length > 0) {
                setExportPrompt({ show: true, codes: created });
            } else {
                setNotification({ show: true, message: 'Không có mã nào được tạo.', type: 'error' });
            }
        } catch (error) {
            console.error("Error generating codes:", error);
            setNotification({ show: true, message: errorMessage(error, 'Tạo mã thất bại'), type: 'error' });
        } finally {
            setLoading(false);
        }
    };

    const confirmExport = () => {
        const list = exportPrompt.codes;
        const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
        exportCodesToExcel(list, `ma-thanh-toan-${stamp}.xlsx`);
        setExportPrompt({ show: false, codes: [] });
        setNotification({ show: true, message: `Đã tạo ${list.length} mã và xuất file Excel!`, type: 'success' });
    };

    const skipExport = () => {
        const count = exportPrompt.codes.length;
        setExportPrompt({ show: false, codes: [] });
        setNotification({ show: true, message: `Đã tạo ${count} mã.`, type: 'success' });
    };

    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text);
        setNotification({ show: true, message: "Đã sao chép mã!", type: 'success' });
        setTimeout(() => setNotification({ show: false, message: '', type: 'success' }), 2000);
    };

    // Lưu ghi chú "mã dùng làm gì" (nhân viên tự điền, thường SAU khi dùng). Cần token.
    const saveNote = async (id, note) => {
        try {
            await axios.post('/api/codes', { action: 'set-note', id, note }, { headers: authHeader() });
            setCodes(prev => prev.map(c => (c.id === id ? { ...c, note } : c)));
            return true;
        } catch (error) {
            setNotification({ show: true, message: errorMessage(error, 'Lưu ghi chú thất bại'), type: 'error' });
            return false;
        }
    };

    // Helper component hiển thị trạng thái
    const StatusBadge = ({ code }) => {
        const isExpired = code.expires_at && new Date(code.expires_at) < new Date();
        if (code.is_used) return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">Đã dùng</span>;
        if (isExpired) return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-600">Hết hạn</span>;
        if (code.claimed_by) return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">Đã lấy</span>;
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-600">Trong kho</span>;
    };

    const hopThoai = (
        <>
            {/* Export Confirmation Modal */}
            {exportPrompt.show && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6 transform scale-100 animate-in zoom-in-95 duration-200">
                        <div className="flex flex-col items-center text-center">
                            <div className="mb-4 p-4 rounded-full bg-emerald-50 text-emerald-500">
                                <FileSpreadsheet size={40} strokeWidth={2.5} />
                            </div>

                            <h3 className="text-xl font-bold text-gray-800 mb-2">
                                Đã tạo {exportPrompt.codes.length} mã
                            </h3>
                            <p className="text-gray-500 mb-5 font-medium">
                                Bạn có muốn xuất file Excel cho lô mã vừa tạo không?
                            </p>

                            {/* Tóm tắt theo mệnh giá */}
                            <div className="w-full mb-6 max-h-40 overflow-y-auto rounded-xl border border-gray-100 divide-y divide-gray-100 text-sm">
                                {Object.entries(
                                    exportPrompt.codes.reduce((acc, c) => {
                                        acc[c.value] = (acc[c.value] || 0) + 1;
                                        return acc;
                                    }, {})
                                )
                                    .sort((a, b) => Number(a[0]) - Number(b[0]))
                                    .map(([value, count]) => (
                                        <div key={value} className="flex justify-between items-center px-4 py-2">
                                            <span className="font-semibold text-emerald-600">{formatCurrency(value)}</span>
                                            <span className="text-gray-500">x{count}</span>
                                        </div>
                                    ))}
                            </div>

                            <div className="w-full flex gap-3">
                                <button
                                    onClick={skipExport}
                                    className="flex-1 py-3.5 rounded-xl font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 transition-all active:scale-[0.98]"
                                >
                                    Để sau
                                </button>
                                <button
                                    onClick={confirmExport}
                                    className="flex-1 py-3.5 rounded-xl font-bold text-white bg-[#e63946] hover:bg-[#c1121f] shadow-lg shadow-[#e63946]/30 transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                                >
                                    <FileSpreadsheet size={18} /> Xuất Excel
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Notification Modal */}
            {notification.show && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6 transform scale-100 animate-in zoom-in-95 duration-200">
                        <div className="flex flex-col items-center text-center">
                            <div className={`mb-4 p-4 rounded-full ${notification.type === 'success' ? 'bg-green-50 text-emerald-500' : 'bg-red-50 text-red-500'}`}>
                                {notification.type === 'success' ? <CheckCircle size={40} strokeWidth={2.5} /> : <XCircle size={40} strokeWidth={2.5} />}
                            </div>

                            <h3 className="text-xl font-bold text-gray-800 mb-2">
                                {notification.type === 'success' ? 'Thành công' : 'Đã xảy ra lỗi'}
                            </h3>

                            <p className="text-gray-500 mb-6 font-medium">
                                {String(notification.message ?? '')}
                            </p>

                            <button
                                onClick={() => setNotification({ ...notification, show: false })}
                                className={`w-full py-3.5 rounded-xl font-bold text-white transition-all active:scale-[0.98] ${notification.type === 'success'
                                    ? 'bg-[#e63946] hover:bg-[#c1121f] shadow-lg shadow-[#e63946]/30'
                                    : 'bg-red-500 hover:bg-red-600 shadow-lg shadow-red-500/30'
                                    }`}
                            >
                                Đã hiểu
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );

    // ---------------- MÀN NHÂN VIÊN (điện thoại) ----------------
    // Hai tab thay cho một trang dài: "Lấy mã" chiếm cả màn để thao tác nhanh trước mặt khách; "Mã của tôi"
    // là danh sách gọn mỗi mã một khối nhỏ, ghi chú chỉ mở khi bấm. Nhân viên chỉ thấy mã DO MÌNH lấy
    // (api/codes lọc claimed_by) nên không có lọc "Trong kho".
    if (staffOnly) {
        const chuaDung = codes.filter((c) => codeStatus(c) === 'claimed').length;
        const dangChon = stock.find((d) => d.value === claimValue);
        const TRANG_THAI = {
            claimed: { ten: 'Chưa dùng', cham: 'bg-amber-400', chu: 'text-amber-700' },
            used: { ten: 'Đã dùng', cham: 'bg-gray-300', chu: 'text-gray-500' },
            expired: { ten: 'Hết hạn', cham: 'bg-red-400', chu: 'text-red-600' },
            stock: { ten: 'Trong kho', cham: 'bg-emerald-400', chu: 'text-emerald-600' },
        };
        return (
            <div className="animate-fadeIn mx-auto w-full max-w-xl">
                <h1 className="mb-3 text-2xl font-bold tracking-tight text-[#1a1a2e]">Mã thanh toán</h1>

                <div className="mb-4 grid grid-cols-2 gap-1 rounded-2xl bg-gray-100 p-1">
                    {[['lay', 'Lấy mã'], ['cua_toi', 'Mã của tôi']].map(([k, ten]) => (
                        <button
                            key={k}
                            type="button"
                            onClick={() => setTab(k)}
                            className={`flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-bold transition-all ${tab === k ? 'bg-white text-[#e63946] shadow-sm' : 'text-gray-500'}`}
                        >
                            {ten}
                            {k === 'cua_toi' && chuaDung > 0 && (
                                <span className="min-w-[20px] rounded-full bg-[#e63946] px-1.5 py-0.5 text-[11px] leading-none text-white">{chuaDung}</span>
                            )}
                        </button>
                    ))}
                </div>

                {tab === 'lay' ? (
                    <div className="space-y-4">
                        <div className="flex items-baseline justify-between">
                            <span className="text-sm font-semibold text-gray-700">Chọn mệnh giá</span>
                            <span className="text-xs text-gray-400">{khoDaTai ? `Kho còn ${stockTotal} mã` : 'Đang tải kho…'}</span>
                        </div>

                        {!khoDaTai ? (
                            <div className="grid grid-cols-3 gap-2.5">
                                {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="h-[74px] animate-pulse rounded-2xl bg-gray-100" />)}
                            </div>
                        ) : stockTotal === 0 ? (
                            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-700">
                                Kho hết mã. Báo quản lý tạo thêm.
                            </div>
                        ) : (
                            <div className="grid grid-cols-3 gap-2.5">
                                {stock.map((d) => {
                                    const on = claimValue === d.value;
                                    return (
                                        <button
                                            key={d.value}
                                            type="button"
                                            onClick={() => setClaimValue(d.value)}
                                            className={`rounded-2xl border-2 py-3.5 text-center transition-all active:scale-95 ${on ? 'border-[#e63946] bg-[#e63946] text-white shadow-lg shadow-[#e63946]/25' : 'border-gray-100 bg-white text-[#1a1a2e]'}`}
                                        >
                                            <div className="text-2xl font-black leading-none">{denomLabel(d.value)}</div>
                                            <div className={`mt-1.5 text-xs font-medium ${on ? 'text-white/80' : 'text-gray-400'}`}>còn {d.count}</div>
                                        </button>
                                    );
                                })}
                            </div>
                        )}

                        <button
                            onClick={handleClaim}
                            disabled={claiming || stockTotal === 0}
                            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#e63946] py-4 text-lg font-bold text-white shadow-lg shadow-[#e63946]/20 transition-all hover:bg-[#c1121f] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {claiming
                                ? <><RefreshCw className="animate-spin" size={20} /> Đang lấy...</>
                                : <><Ticket size={20} /> Lấy mã {dangChon ? denomLabel(dangChon.value) : ''}</>}
                        </button>

                        {claimedCode && (
                            <div className="rounded-3xl border-2 border-emerald-300 bg-emerald-50 p-5 text-center">
                                <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">Mã cho khách · {formatCurrency(claimedCode.value)}</p>
                                <p className="my-3 font-mono text-5xl font-black tracking-[0.18em] text-[#1a1a2e]">{String(claimedCode.code ?? '')}</p>
                                <div className="grid grid-cols-2 gap-2">
                                    <button
                                        type="button"
                                        onClick={() => copyToClipboard(String(claimedCode.code ?? ''))}
                                        className="flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white py-3 font-bold text-blue-600 active:scale-95"
                                    >
                                        <Copy size={18} /> Chép mã
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => { setTab('cua_toi'); setStatusFilter('all'); setValueFilter('all'); setSearch(''); setMoGhiChu(claimedCode.id); }}
                                        className="flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white py-3 font-bold text-gray-700 active:scale-95"
                                    >
                                        <Pencil size={18} /> Ghi chú
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="space-y-3">
                        <div className="flex gap-2">
                            <div className="relative min-w-0 flex-1">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                                <input
                                    type="text"
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    placeholder="Tìm mã hoặc ghi chú…"
                                    className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#e63946]"
                                />
                            </div>
                            {denomOptions.length > 1 && (
                                <MenuGia value={valueFilter} options={denomOptions} onChange={setValueFilter} />
                            )}
                            <button
                                type="button"
                                onClick={() => { fetchCodes(); fetchStock(); }}
                                className="grid h-[42px] w-[42px] shrink-0 place-items-center rounded-xl border border-gray-200 bg-white text-gray-600 active:scale-95"
                                title="Làm mới"
                            >
                                <RefreshCw size={16} />
                            </button>
                        </div>

                        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1">
                            {[['all', 'Tất cả'], ['claimed', 'Chưa dùng'], ['used', 'Đã dùng'], ['expired', 'Hết hạn']].map(([k, ten]) => (
                                <button
                                    key={k}
                                    type="button"
                                    onClick={() => setStatusFilter(k)}
                                    className={`shrink-0 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-xs font-bold transition-all active:scale-95 ${statusFilter === k ? 'border-[#1a1a2e] bg-[#1a1a2e] text-white' : 'border-gray-200 bg-white text-gray-600'}`}
                                >
                                    {ten}
                                </button>
                            ))}
                        </div>

                        <div className="divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-100 bg-white">
                            {filteredCodes.length === 0 ? (
                                <div className="p-8 text-center text-sm italic text-gray-400">{codes.length === 0 ? 'Bạn chưa lấy mã nào.' : 'Không có mã khớp bộ lọc.'}</div>
                            ) : filteredCodes.map((code) => {
                                const tt = TRANG_THAI[codeStatus(code)];
                                return (
                                    <div key={code.id} className="px-4 py-3">
                                        <div className="flex items-center gap-3">
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-baseline gap-2">
                                                    <span className={`font-mono text-xl font-bold tracking-widest ${codeStatus(code) === 'claimed' ? 'text-[#1a1a2e]' : 'text-gray-400'}`}>{code.code}</span>
                                                    <span className="text-sm font-bold text-emerald-600">{denomLabel(code.value)}</span>
                                                </div>
                                                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
                                                    <span className={`inline-flex items-center gap-1.5 font-semibold ${tt.chu}`}>
                                                        <span className={`h-2 w-2 rounded-full ${tt.cham}`} />{tt.ten}
                                                    </span>
                                                    <span>· {new Date(code.claimed_at || code.created_at).toLocaleDateString('vi-VN')}</span>
                                                </div>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => copyToClipboard(code.code)}
                                                aria-label={`Chép mã ${code.code}`}
                                                className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-600 transition-all active:scale-95 active:bg-blue-100"
                                            >
                                                <Copy size={18} />
                                            </button>
                                        </div>
                                        {moGhiChu === code.id ? (
                                            <div className="mt-2">
                                                <NoteCell
                                                    code={code}
                                                    autoFocus
                                                    onSave={async (id, note) => { const ok = await saveNote(id, note); if (ok) setMoGhiChu(null); return ok; }}
                                                    canEdit={canEditNote(code)}
                                                />
                                            </div>
                                        ) : (
                                            <button
                                                type="button"
                                                onClick={() => canEditNote(code) && setMoGhiChu(code.id)}
                                                className="mt-1.5 flex w-full items-center gap-1.5 text-left text-sm"
                                            >
                                                {code.note
                                                    ? <span className="min-w-0 truncate text-gray-700"><Pencil size={12} className="mr-1 inline text-gray-400" />{code.note}</span>
                                                    : <span className="text-gray-400">+ Ghi chú dùng làm gì</span>}
                                            </button>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {hopThoai}
            </div>
        );
    }

    return (
        <div className="animate-fadeIn">
            <div className="mb-4 lg:mb-8">
                <h1 className="text-2xl md:text-3xl font-bold text-[#1a1a2e] tracking-tight">Mã thanh toán</h1>
                <p className="text-sm md:text-base text-gray-500 mt-1">Tạo và quản lý các mã kích hoạt.</p>
            </div>

            <div className="flex flex-col xl:flex-row gap-6">
                {/* --- 1a. LẤY MÃ (nhân viên) --- */}
                {staffOnly ? (
                <div className="bg-white p-4 md:p-6 rounded-2xl shadow-sm border border-gray-100 w-full xl:w-1/3 h-fit min-w-0 max-w-full overflow-hidden">
                    <h3 className="text-lg md:text-xl font-bold text-[#1a1a2e] mb-4 flex items-center gap-2 pb-3 border-b border-gray-100">
                        <Ticket className="bg-[#e63946] text-white rounded-full p-1" size={24} />
                        Lấy mã cho khách
                    </h3>
                    <div className="space-y-4">
                        <div>
                            <div className="flex items-center justify-between mb-2">
                                <label className="block text-sm font-semibold text-gray-700">Chọn mệnh giá</label>
                                <span className="text-xs text-gray-400">Kho còn {stockTotal} mã</span>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {stock.map((d) => (
                                    <button
                                        key={d.value}
                                        type="button"
                                        onClick={() => setClaimValue(d.value)}
                                        className={`px-3 py-2 rounded-xl text-sm font-bold border transition-all active:scale-95 ${claimValue === d.value ? 'bg-[#e63946] text-white border-[#e63946] shadow' : 'bg-gray-50 text-gray-700 border-gray-200 hover:border-[#e63946]/40'}`}
                                    >
                                        {denomLabel(d.value)}
                                        <span className={`ml-1 text-xs font-medium ${claimValue === d.value ? 'text-white/80' : 'text-gray-400'}`}>· {d.count}</span>
                                    </button>
                                ))}
                            </div>
                            {stockTotal === 0 && (
                                <p className="text-sm text-amber-600 mt-2 font-medium">Kho hết mã. Báo quản lý tạo thêm.</p>
                            )}
                        </div>

                        <button
                            onClick={handleClaim}
                            disabled={claiming || stockTotal === 0}
                            className="w-full py-3.5 bg-[#e63946] text-white rounded-xl font-bold hover:bg-[#c1121f] transition-all disabled:opacity-60 disabled:cursor-not-allowed shadow-lg shadow-[#e63946]/20 active:scale-[0.98] text-base flex items-center justify-center gap-2"
                        >
                            {claiming ? <><RefreshCw className="animate-spin" size={20} /> Đang lấy...</> : <><Ticket size={20} /> Lấy mã</>}
                        </button>

                        {claimedCode && (
                            <div className="rounded-2xl border-2 border-emerald-300 bg-emerald-50 p-4 text-center">
                                <p className="text-xs font-bold uppercase tracking-wide text-emerald-700 mb-2">Mã cho khách · {formatCurrency(claimedCode.value)}</p>
                                <div className="flex items-center justify-center gap-2">
                                    <span className="font-mono text-4xl font-black tracking-[0.15em] text-[#1a1a2e]">{String(claimedCode.code ?? '')}</span>
                                    <button
                                        onClick={() => copyToClipboard(String(claimedCode.code ?? ''))}
                                        className="rounded-lg bg-white p-2 text-blue-600 border border-gray-200 active:scale-95"
                                        title="Sao chép"
                                    >
                                        <Copy size={18} />
                                    </button>
                                </div>
                                <p className="text-xs text-gray-500 mt-2">Đọc/đưa mã cho khách. Ghi chú "dùng làm gì" ở danh sách bên phải sau khi khách dùng.</p>
                            </div>
                        )}
                    </div>
                </div>
                ) : (
                <div className="bg-white p-4 md:p-6 rounded-2xl shadow-sm border border-gray-100 w-full xl:w-1/3 h-fit min-w-0 max-w-full overflow-hidden">
                    <h3 className="text-lg md:text-xl font-bold text-[#1a1a2e] mb-4 flex items-center gap-2 pb-3 border-b border-gray-100">
                        <ArrowRight className="bg-[#e63946] text-white rounded-full p-1" size={24} />
                        Tạo mã mới
                    </h3>

                    <div className="space-y-4">
                        <div>
                            <div className="flex items-center justify-between mb-2">
                                <label className="block text-sm font-semibold text-gray-700">Mệnh giá &amp; số lượng</label>
                                <span className="text-xs text-gray-400">Tổng: {totalQuantity} mã</span>
                            </div>
                            <div className="space-y-2">
                                {rows.map((row, index) => (
                                    <div key={index} className="flex items-center gap-2">
                                        <div className="relative flex-1 min-w-0">
                                            <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                                            <input
                                                type="number"
                                                placeholder="Mệnh giá"
                                                className="w-full pl-9 pr-2 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#e63946] bg-gray-50 focus:bg-white transition-all font-medium text-sm"
                                                value={row.value}
                                                onChange={e => updateRow(index, { value: parseInt(e.target.value) || 0 })}
                                                step="1000"
                                            />
                                        </div>
                                        <div className="relative w-24 shrink-0">
                                            <Hash className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                                            <input
                                                type="number"
                                                placeholder="SL"
                                                className="w-full pl-9 pr-2 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#e63946] bg-gray-50 focus:bg-white transition-all font-medium text-sm"
                                                value={row.quantity}
                                                onChange={e => updateRow(index, { quantity: Math.max(1, Math.min(100, parseInt(e.target.value) || 1)) })}
                                                min="1" max="100"
                                            />
                                        </div>
                                        {/* Chỉ hiện khi có từ 2 dòng. Một dòng thì nút này luôn mờ,
                                            bấm không được, mà vẫn ăn mất chỗ của ô mệnh giá. */}
                                        {rows.length > 1 && (
                                            <button
                                                type="button"
                                                onClick={() => removeRow(index)}
                                                className="p-2.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all shrink-0"
                                                title="Xóa dòng"
                                            >
                                                <Trash2 size={18} />
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>
                            <button
                                type="button"
                                onClick={addRow}
                                className="mt-2 w-full py-2 flex items-center justify-center gap-1.5 text-sm font-semibold text-[#e63946] border border-dashed border-[#e63946]/40 rounded-xl hover:bg-[#e63946]/5 transition-all"
                            >
                                <Plus size={16} /> Thêm mệnh giá
                            </button>
                        </div>

                        {/* Hạn dùng: mặc định ẨN. Chú thích cũ ghi "để trống nếu vĩnh viễn"
                            -> bỏ trống mới là thường lệ, nên bày sẵn ô datetime chỉ tổ chật chỗ. */}
                        <div>
                            {!showExpiry ? (
                                <button
                                    type="button"
                                    onClick={() => setShowExpiry(true)}
                                    className="flex items-center gap-1.5 py-1 text-sm font-semibold text-gray-500 hover:text-[#e63946] transition-colors"
                                >
                                    <Clock size={16} /> Đặt hạn dùng
                                    <span className="text-xs font-normal text-gray-400">· mặc định vĩnh viễn</span>
                                </button>
                            ) : (
                            <>
                            <div className="flex items-center justify-between mb-2">
                                <label className="block text-sm font-semibold text-gray-700">Ngày hết hạn</label>
                                <button
                                    type="button"
                                    onClick={() => { setShowExpiry(false); setExpiresAt(''); }}
                                    className="text-xs font-semibold text-gray-400 hover:text-[#e63946]"
                                >
                                    Bỏ hạn
                                </button>
                            </div>
                            <div className="relative w-full max-w-full overflow-hidden">
                                <Clock className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                                <input
                                    type="datetime-local"
                                    className="w-full max-w-full min-w-0 box-border pl-11 pr-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#e63946] bg-gray-50 focus:bg-white transition-all text-xs md:text-sm text-[#1a1a2e]"
                                    value={expiresAt}
                                    onChange={e => setExpiresAt(e.target.value)}
                                    min={getMinDateTime()}
                                />
                            </div>
                            <p className="text-xs text-gray-400 mt-1 ml-1">Áp dụng cho tất cả mã trong lần tạo này.</p>
                            </>
                            )}
                        </div>

                        <button
                            onClick={handleGenerate}
                            disabled={loading}
                            className="w-full py-3 bg-[#e63946] text-white rounded-xl font-bold hover:bg-[#c1121f] transition-all disabled:opacity-70 disabled:cursor-not-allowed shadow-lg shadow-[#e63946]/20 active:scale-[0.98] mt-1 text-base flex items-center justify-center gap-2"
                        >
                            {loading ? (
                                <span className="flex items-center justify-center gap-2">
                                    <RefreshCw className="animate-spin" size={20} /> Đang xử lý...
                                </span>
                            ) : (
                                <><FileSpreadsheet size={20} /> Tạo mã &amp; xuất Excel</>
                            )}
                        </button>
                    </div>
                </div>
                )}

                {/* --- 2. CODES LIST --- */}
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 flex-1 w-full overflow-hidden flex flex-col">
                    <div className="p-4 md:p-6 border-b border-gray-100 bg-gray-50/50 space-y-3">
                        <h3 className="text-lg md:text-xl font-bold text-[#1a1a2e]">
                            Danh sách mã
                            <span className="ml-2 text-sm font-semibold text-gray-400">
                                {filteredCodes.length === codes.length ? codes.length : `${filteredCodes.length}/${codes.length}`}
                            </span>
                        </h3>

                        <div className="flex gap-2">
                            <div className="relative flex-1 min-w-0">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                                <input
                                    type="text"
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    placeholder="Tìm mã, ghi chú…"
                                    className="w-full pl-9 pr-3 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#e63946] bg-white text-sm"
                                />
                            </div>
                            {denomOptions.length > 1 && (
                                <MenuGia value={valueFilter} options={denomOptions} onChange={setValueFilter} />
                            )}
                            <button
                                type="button"
                                onClick={fetchCodes}
                                className="grid h-[42px] w-[42px] shrink-0 place-items-center rounded-xl border border-gray-200 bg-white text-gray-600 transition-all hover:border-gray-300 active:scale-95"
                                title="Làm mới"
                            >
                                <RefreshCw size={16} />
                            </button>
                        </div>

                        {/* Trạng thái: một dải 5 ô kèm số đếm (thay 2 hàng chip) — nhìn là biết kho còn bao nhiêu,
                            đã phát bao nhiêu mà không phải bấm từng chip. Số tô màu theo trạng thái. */}
                        <div className="grid grid-cols-5 gap-1 rounded-2xl bg-gray-100 p-1">
                            {[
                                { key: 'all', label: 'Tất cả', mau: 'text-[#1a1a2e]' },
                                { key: 'stock', label: 'Trong kho', mau: 'text-emerald-600' },
                                { key: 'claimed', label: 'Đã lấy', mau: 'text-amber-600' },
                                { key: 'used', label: 'Đã dùng', mau: 'text-gray-500' },
                                { key: 'expired', label: 'Hết hạn', mau: 'text-red-500' },
                            ].map((f) => {
                                const on = statusFilter === f.key;
                                return (
                                    <button
                                        key={f.key}
                                        type="button"
                                        onClick={() => setStatusFilter(f.key)}
                                        aria-pressed={on}
                                        className={`min-w-0 rounded-xl px-1 py-1.5 text-center transition-all active:scale-95 ${on ? 'bg-white shadow-sm ring-1 ring-[#e63946]/30' : 'hover:bg-white/60'}`}
                                    >
                                        <div className={`text-base md:text-lg font-black leading-tight ${f.mau}`}>{demTrangThai[f.key] || 0}</div>
                                        <div className={`truncate text-[11px] md:text-xs font-semibold ${on ? 'text-[#e63946]' : 'text-gray-500'}`}>{f.label}</div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* --- MOBILE VIEW: CARDS --- */}
                    <div className="md:hidden flex flex-col divide-y divide-gray-100">
                        {filteredCodes.length === 0 ? (
                            <div className="p-8 text-center text-gray-400 italic">{codes.length === 0 ? (staffOnly ? 'Bạn chưa lấy mã nào.' : 'Chưa có dữ liệu.') : 'Không có mã khớp bộ lọc.'}</div>
                        ) : (
                            filteredCodes.map((code) => (
                                <div key={code.id} className="p-4 transition-colors">
                                    {/* Dòng 1: mã + trạng thái. Mã là thứ phải đọc để đọc cho khách
                                        nên cho to hẳn (text-2xl) và giãn chữ để không nhầm 0/O, 1/l. */}
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="font-mono text-2xl font-bold text-[#1a1a2e] tracking-widest leading-none">{code.code}</span>
                                        <StatusBadge code={code} />
                                    </div>

                                    {/* Dòng 2: mệnh giá + nút chép. Chỉ icon, nhưng ô bấm vuông
                                        44x44 (h-11 w-11) — bản cũ 38x40 là dưới ngưỡng ngón tay. */}
                                    <div className="mt-2 flex items-center justify-between gap-3">
                                        <span className="text-emerald-600 font-bold text-lg leading-none">{formatCurrency(code.value)}</span>
                                        <button
                                            onClick={() => copyToClipboard(code.code)}
                                            aria-label={`Chép mã ${code.code}`}
                                            title="Chép mã"
                                            className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-600 active:bg-blue-100 active:scale-95 transition-all"
                                        >
                                            <Copy size={20} />
                                        </button>
                                    </div>

                                    {/* Dòng 3: thông tin phụ. Bỏ khung xám + viền của bản cũ — nó
                                        làm thẻ nặng mắt mà chẳng thêm thông tin gì. */}
                                    <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-gray-500">
                                        <span className="inline-flex items-center gap-1.5">
                                            <Calendar size={13} />
                                            {new Date(code.created_at).toLocaleDateString('vi-VN')}
                                        </span>
                                        {code.claimed_by && (
                                            <span className="inline-flex items-center gap-1.5">
                                                <User size={13} />
                                                {code.claimed_by_name || code.claimed_by}
                                            </span>
                                        )}
                                        {code.used_session_id && (
                                            <a
                                                href={`/album/${code.used_session_id}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="inline-flex items-center gap-1.5 -my-1.5 py-1.5 font-semibold text-blue-600"
                                            >
                                                <Hash size={13} />
                                                <span className="font-mono">{String(code.used_session_id).slice(0, 8)}…</span>
                                            </a>
                                        )}
                                    </div>

                                    {/* Ghi chú "dùng làm gì" — nhân viên tự điền sau khi dùng */}
                                    <div className="mt-2.5">
                                        <NoteCell code={code} onSave={saveNote} canEdit={canEditNote(code)} />
                                    </div>
                                </div>
                            ))
                        )}
                    </div>

                    {/* --- DESKTOP VIEW: TABLE --- */}
                    <div className="hidden md:block overflow-x-auto">
                        <table className="w-full text-left">
                            <thead className="bg-gray-50/80 sticky top-0">
                                <tr className="text-gray-500 text-sm font-semibold uppercase tracking-wider">
                                    <th className="py-4 pl-6">Mã Code</th>
                                    <th className="py-4">Giá trị</th>
                                    <th className="py-4 text-center">Trạng thái</th>
                                    <th className="py-4">NV lấy mã</th>
                                    <th className="py-4 min-w-[180px]">Ghi chú</th>
                                    <th className="py-4">Phiên</th>
                                    <th className="py-4">Ngày tạo</th>
                                    <th className="py-4 text-right pr-6">Thao tác</th>
                                </tr>
                            </thead>
                            <tbody className="text-sm divide-y divide-gray-100">
                                {filteredCodes.length === 0 ? (
                                    <tr>
                                        <td colSpan="8" className="py-10 text-center text-gray-400 italic">{codes.length === 0 ? (staffOnly ? 'Bạn chưa lấy mã nào.' : 'Chưa có mã nào được tạo.') : 'Không có mã khớp bộ lọc.'}</td>
                                    </tr>
                                ) : (
                                    filteredCodes.map((code) => (
                                        <tr key={code.id} className="hover:bg-gray-50/80 transition-colors group">
                                            <td className="py-4 pl-6">
                                                <span className="font-mono font-bold text-[#1a1a2e] text-lg bg-gray-100/50 px-2 py-1 rounded">{code.code}</span>
                                            </td>
                                            <td className="py-4 font-bold text-emerald-600">{formatCurrency(code.value)}</td>
                                            <td className="py-4 text-center">
                                                <StatusBadge code={code} />
                                            </td>
                                            <td className="py-4 text-gray-600 text-sm">
                                                {code.claimed_by
                                                    ? <span className="inline-flex items-center gap-1"><User size={13} className="text-gray-400" />{code.claimed_by_name || code.claimed_by}</span>
                                                    : <span className="text-gray-300 italic">—</span>}
                                            </td>
                                            <td className="py-4 pr-3">
                                                <NoteCell code={code} onSave={saveNote} canEdit={canEditNote(code)} />
                                            </td>
                                            <td className="py-4 text-xs">
                                                {code.used_session_id
                                                    ? <a href={`/album/${code.used_session_id}`} target="_blank" rel="noopener noreferrer" className="font-mono text-blue-600 hover:underline" title={code.used_session_id}>{String(code.used_session_id).slice(0, 8)}…</a>
                                                    : <span className="text-gray-300 italic">—</span>}
                                            </td>
                                            <td className="py-4 text-gray-500 text-xs">
                                                {new Date(code.created_at).toLocaleDateString('vi-VN')}
                                            </td>
                                            <td className="py-4 text-right pr-6">
                                                <button
                                                    onClick={() => copyToClipboard(code.code)}
                                                    className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all opacity-0 group-hover:opacity-100 focus:opacity-100"
                                                    title="Sao chép"
                                                >
                                                    <Copy size={18} />
                                                </button>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {hopThoai}
        </div>
    );
};

export default CodeManager;
