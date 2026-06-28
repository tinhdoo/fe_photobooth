import { useState, useEffect } from 'react';
import axios from 'axios';
import * as XLSX from 'xlsx';
import { RefreshCw, Clock, Hash, DollarSign, Copy, CheckCircle, XCircle, Calendar, ArrowRight, Plus, Trash2, FileSpreadsheet } from 'lucide-react';

const formatCurrency = (value) => `${Number(value || 0).toLocaleString('vi-VN')} ₫`;
const normalizeCode = (code = {}) => ({
    ...code,
    value: Number(code.value ?? code.amount ?? 0),
    is_used: Boolean(code.is_used),
    created_at: code.created_at || new Date().toISOString(),
});

const statusLabel = (code) => {
    if (code.is_used) return 'Đã dùng';
    if (code.expires_at && new Date(code.expires_at) < new Date()) return 'Hết hạn';
    return 'Hoạt động';
};

// Xuất danh sách mã ra file Excel. Mã được ép kiểu chuỗi để không mất số 0 ở đầu.
const exportCodesToExcel = (list, fileName) => {
    if (!Array.isArray(list) || list.length === 0) return;

    const header = ['STT', 'Mã code', 'Mệnh giá (VND)', 'Trạng thái', 'Ngày tạo', 'Hết hạn'];
    const rows = list.map((code, idx) => [
        idx + 1,
        String(code.code),
        Number(code.value || 0),
        statusLabel(code),
        code.created_at ? new Date(code.created_at).toLocaleString('vi-VN') : '',
        code.expires_at ? new Date(code.expires_at).toLocaleString('vi-VN') : 'Vĩnh viễn',
    ]);

    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    ws['!cols'] = [{ wch: 6 }, { wch: 14 }, { wch: 16 }, { wch: 12 }, { wch: 20 }, { wch: 20 }];
    // Ép cột "Mã code" về dạng text để giữ số 0 đứng đầu khi mở bằng Excel.
    for (let r = 1; r <= list.length; r += 1) {
        const cell = ws[XLSX.utils.encode_cell({ r, c: 1 })];
        if (cell) cell.t = 's';
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Mã thanh toán');
    XLSX.writeFile(wb, fileName);
};

const CodeManager = () => {
    const [codes, setCodes] = useState([]);
    const [loading, setLoading] = useState(false);
    const [rows, setRows] = useState([{ value: 70000, quantity: 1 }]);
    const [expiresAt, setExpiresAt] = useState('');
    const [notification, setNotification] = useState({ show: false, message: '', type: 'success' });
    const [exportPrompt, setExportPrompt] = useState({ show: false, codes: [] });

    const totalQuantity = rows.reduce((sum, r) => sum + (Number(r.quantity) || 0), 0);

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
    }, []);

    const fetchCodes = async () => {
        try {
            const res = await axios.get('/api/codes');
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
            const res = await axios.post('/api/codes', payload);
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
            const msg = error?.response?.data?.error || "Tạo mã thất bại";
            setNotification({ show: true, message: msg, type: 'error' });
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

    // Helper component hiển thị trạng thái
    const StatusBadge = ({ code }) => {
        const isExpired = code.expires_at && new Date(code.expires_at) < new Date();
        if (code.is_used) return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">Đã dùng</span>;
        if (isExpired) return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-600">Hết hạn</span>;
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-600">Hoạt động</span>;
    };

    return (
        <div className="animate-fadeIn">
            <div className="mb-4 lg:mb-8">
                <h1 className="text-2xl md:text-3xl font-bold text-[#1a1a2e] tracking-tight">Mã thanh toán</h1>
                <p className="text-sm md:text-base text-gray-500 mt-1">Tạo và quản lý các mã kích hoạt.</p>
            </div>

            <div className="flex flex-col xl:flex-row gap-6">
                {/* --- 1. GENERATION FORM --- */}
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
                                        <button
                                            type="button"
                                            onClick={() => removeRow(index)}
                                            disabled={rows.length === 1}
                                            className="p-2.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
                                            title="Xóa dòng"
                                        >
                                            <Trash2 size={18} />
                                        </button>
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

                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-2">Ngày hết hạn</label>
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
                            <p className="text-xs text-gray-400 mt-1 ml-1">Áp dụng cho tất cả mã. Để trống nếu mã có hiệu lực vĩnh viễn</p>
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

                {/* --- 2. CODES LIST --- */}
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 flex-1 w-full overflow-hidden flex flex-col">
                    <div className="p-5 md:p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                        <div>
                            <h3 className="text-lg md:text-xl font-bold text-[#1a1a2e]">Danh sách mã</h3>
                            <p className="text-xs text-gray-500 mt-0.5 md:hidden">Vuốt để xem thêm</p>
                        </div>
                        <button
                            onClick={fetchCodes}
                            className="p-2.5 bg-white border border-gray-200 hover:bg-gray-50 hover:border-gray-300 rounded-xl text-gray-600 transition-all shadow-sm active:scale-95"
                            title="Làm mới"
                        >
                            <RefreshCw size={18} />
                        </button>
                    </div>

                    {/* --- MOBILE VIEW: CARDS --- */}
                    <div className="md:hidden flex flex-col divide-y divide-gray-100">
                        {codes.length === 0 ? (
                            <div className="p-8 text-center text-gray-400 italic">Chưa có dữ liệu.</div>
                        ) : (
                            codes.map((code) => (
                                <div key={code.id} className="p-4 hover:bg-gray-50 transition-colors">
                                    <div className="flex justify-between items-start mb-3">
                                        <div>
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="font-mono text-lg font-bold text-[#1a1a2e] tracking-wide">{code.code}</span>
                                            </div>
                                            <div className="text-emerald-600 font-bold text-base">
                                                {formatCurrency(code.value)}
                                            </div>
                                        </div>
                                        <div className="flex flex-col items-end gap-2">
                                            <StatusBadge code={code} />
                                            <button
                                                onClick={() => copyToClipboard(code.code)}
                                                className="p-2 bg-blue-50 text-blue-600 rounded-lg active:bg-blue-100"
                                            >
                                                <Copy size={18} />
                                            </button>
                                        </div>
                                    </div>

                                    <div className="flex flex-wrap items-center gap-2 sm:gap-4 text-xs text-gray-500 bg-gray-50 p-2.5 rounded-lg border border-gray-100">
                                        <div className="flex items-center gap-1.5 min-w-fit">
                                            <Calendar size={12} />
                                            <span>Tạo: {new Date(code.created_at).toLocaleDateString('vi-VN')}</span>
                                        </div>
                                        {code.expires_at && (
                                            <div className="flex items-center gap-1.5 text-orange-600/80 min-w-fit">
                                                <Clock size={12} />
                                                <span>Hết hạn: {new Date(code.expires_at).toLocaleDateString('vi-VN')}</span>
                                            </div>
                                        )}
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
                                    <th className="py-4">Thời hạn</th>
                                    <th className="py-4">Ngày tạo</th>
                                    <th className="py-4 text-right pr-6">Thao tác</th>
                                </tr>
                            </thead>
                            <tbody className="text-sm divide-y divide-gray-100">
                                {codes.length === 0 ? (
                                    <tr>
                                        <td colSpan="6" className="py-10 text-center text-gray-400 italic">Chưa có mã nào được tạo.</td>
                                    </tr>
                                ) : (
                                    codes.map((code) => (
                                        <tr key={code.id} className="hover:bg-gray-50/80 transition-colors group">
                                            <td className="py-4 pl-6">
                                                <span className="font-mono font-bold text-[#1a1a2e] text-lg bg-gray-100/50 px-2 py-1 rounded">{code.code}</span>
                                            </td>
                                            <td className="py-4 font-bold text-emerald-600">{formatCurrency(code.value)}</td>
                                            <td className="py-4 text-center">
                                                <StatusBadge code={code} />
                                            </td>
                                            <td className="py-4 text-gray-500 text-xs">
                                                {code.expires_at ? (
                                                    <div className="flex flex-col">
                                                        <span>{new Date(code.expires_at).toLocaleDateString('vi-VN')}</span>
                                                        <span className="text-gray-400">{new Date(code.expires_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</span>
                                                    </div>
                                                ) : <span className="text-gray-400 italic">Vĩnh viễn</span>}
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
                                {notification.message}
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
        </div>
    );
};

export default CodeManager;
