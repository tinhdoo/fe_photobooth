import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { Monitor, Zap, DollarSign, RefreshCw, Edit2, Check, X, Trash2, AlertTriangle, IdCard, Gauge, ChevronDown } from 'lucide-react';
import { isSupabaseBrowserConfigured, supabase } from '../../services/supabaseClient';
import { authHeader } from '../../utils/auth';

// Máy im lặng quá lâu (máy cũ đã cài lại, mã ngẫu nhiên lúc thử) gom vào nút "Hiện N máy cũ" thay vì xoá: trang
// Doanh thu lấy tên phòng từ danh sách này, xoá đi thì doanh thu cũ của máy đó chỉ còn hiện mã.
const NGAY_MAY_CU = 14;

// Độ mượt (booth >= 0.0.32): GET /api/devices?resource=do-muot gộp meta_data.do_muot các lượt gần đây.
const TEN_CHANG = {
    chao: 'Chào', che_do: 'Chọn chế độ', bo_cuc: 'Bố cục', so_to: 'Số tờ', thanh_toan: 'Thanh toán', chuan_bi: 'Chuẩn bị',
    chup: 'Chụp', chon_anh: 'Chọn ảnh', chinh_anh: 'Chỉnh ảnh', khung_in: 'Khung & in', ket_qua: 'Kết quả', anh_the: 'Ảnh thẻ',
};
const THU_TU_CHANG = Object.keys(TEN_CHANG);
const TEN_CHO = [
    ['chup', 'Chụp → hiện ảnh'], ['tao_qr', 'Tạo mã QR'], ['ghep', 'Ghép ảnh'], ['gui_in', 'Gửi lệnh in'],
    ['den_qr', 'Bấm In → lưu lượt'], ['luu', 'Lưu lượt'], ['tai_nen', 'Tải ảnh gốc'], ['tach_nen', 'Tách nền ảnh thẻ'],
    ['mat_hinh', 'Máy ảnh mất hình'],
];
const TEN_LOI = {
    chup_loi: 'Chụp lỗi', mat_hinh_lau: 'Máy ảnh mất hình > 20 s', qr_loi: 'Tạo QR lỗi', in_loi: 'In lỗi',
    luu_loi: 'Lưu album lỗi', ghep_loi: 'Ghép ảnh lỗi', tach_nen_loi: 'Tách nền lỗi', xu_ly_loi: 'Xử lý ảnh lỗi',
    sap_giao_dien: 'Giao diện sập', tai_chunk: 'Tải trang lỗi', js: 'Lỗi JavaScript',
};
// Độ trễ chạm là ngưỡng trên của ô biểu đồ; > 2000 = ô cuối (lâu hơn 2 s).
const mili = (ms) => (ms == null ? '—' : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} s`);
const treCham = (ms) => (ms == null ? '—' : ms > 2000 ? '> 2 s' : `≤ ${mili(ms)}`);
const mauTre = (ms) => (ms == null ? 'text-gray-400' : ms <= 200 ? 'text-emerald-600' : ms <= 500 ? 'text-amber-600' : 'text-red-600');

const TheDoMuot = ({ d }) => {
    const [mo, setMo] = useState(false);
    if (!d) {
        return (
            <div className="flex items-center gap-1.5 rounded-xl bg-gray-50 px-3 py-2.5 text-xs font-semibold text-gray-400">
                <Gauge size={14} /> Độ mượt: chưa có số liệu
            </div>
        );
    }
    const pctLoi = d.luot ? Math.round((100 * d.luot_loi) / d.luot) : 0;
    const dongLoi = Object.entries(d.dem || {})
        .filter(([k, v]) => k.startsWith('loi_') && v > 0)
        .map(([k, v]) => [k.slice(4), v])
        .sort((a, b) => b[1] - a[1]);
    const chang = THU_TU_CHANG.filter((b) => d.buoc?.[b]?.n || d.buoc?.[b]?.dung);
    const cho = TEN_CHO.filter(([k]) => d.tg?.[k]);
    return (
        <div className="rounded-xl bg-gray-50 px-3 py-2.5 text-xs">
            <button type="button" onClick={() => setMo((v) => !v)} className="flex w-full items-center gap-1.5 font-bold text-[#1a1a2e]">
                <Gauge size={14} className="text-gray-500" /> Độ mượt
                <span className="font-semibold text-gray-400">{d.luot} lượt</span>
                <ChevronDown size={14} className={`ml-auto text-gray-400 transition-transform ${mo ? 'rotate-180' : ''}`} />
            </button>
            <div className="mt-2 grid grid-cols-3 gap-2">
                <div>
                    <p className="text-[11px] text-gray-400">Chạm p95</p>
                    <p className={`text-sm font-black ${mauTre(d.cham?.p95)}`}>{treCham(d.cham?.p95)}</p>
                </div>
                <div>
                    <p className="text-[11px] text-gray-400">Lượt có lỗi</p>
                    <p className={`text-sm font-black ${pctLoi > 5 ? 'text-red-600' : pctLoi > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                        {pctLoi}% <span className="text-[11px] font-semibold text-gray-400">{d.luot_loi}/{d.luot}</span>
                    </p>
                </div>
                <div>
                    <p className="text-[11px] text-gray-400">Bỏ dở · Đơ</p>
                    <p className="text-sm font-black text-[#1a1a2e]">{d.bo_do} <span className="text-gray-300">·</span> {d.dung}</p>
                </div>
            </div>
            {mo && (
                <div className="mt-3 space-y-3 border-t border-gray-200 pt-3">
                    {chang.length > 0 && (
                        <table className="w-full text-left">
                            <thead className="text-[11px] text-gray-400">
                                <tr>
                                    <th className="font-semibold">Màn</th>
                                    <th className="text-right font-semibold">Chạm</th>
                                    <th className="text-right font-semibold">p95</th>
                                    <th className="text-right font-semibold">Chậm nhất</th>
                                    <th className="text-right font-semibold">Đơ</th>
                                </tr>
                            </thead>
                            <tbody className="font-semibold text-[#1a1a2e]">
                                {chang.map((b) => {
                                    const o = d.buoc[b];
                                    return (
                                        <tr key={b}>
                                            <td className="py-0.5">{TEN_CHANG[b]}</td>
                                            <td className="text-right text-gray-500">{o.n}</td>
                                            <td className={`text-right ${mauTre(o.p95)}`}>{treCham(o.p95)}</td>
                                            <td className={`text-right ${mauTre(o.max)}`}>{mili(o.max || null)}</td>
                                            <td className={`text-right ${o.dung ? 'text-amber-600' : 'text-gray-300'}`}>{o.dung || 0}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                    {cho.length > 0 && (
                        <table className="w-full text-left">
                            <thead className="text-[11px] text-gray-400">
                                <tr>
                                    <th className="font-semibold">Chờ</th>
                                    <th className="text-right font-semibold">Lần</th>
                                    <th className="text-right font-semibold">p50</th>
                                    <th className="text-right font-semibold">p95</th>
                                    <th className="text-right font-semibold">Lâu nhất</th>
                                </tr>
                            </thead>
                            <tbody className="font-semibold text-[#1a1a2e]">
                                {cho.map(([k, ten]) => (
                                    <tr key={k}>
                                        <td className="py-0.5">{ten}</td>
                                        <td className="text-right text-gray-500">{d.tg[k].n}</td>
                                        <td className="text-right">{mili(d.tg[k].p50)}</td>
                                        <td className="text-right">{mili(d.tg[k].p95)}</td>
                                        <td className="text-right text-gray-500">{mili(d.tg[k].max)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                    {dongLoi.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                            {dongLoi.map(([k, v]) => (
                                <span key={k} className="rounded-lg bg-red-50 px-2 py-1 font-bold text-red-700">{TEN_LOI[k] || k} · {v}</span>
                            ))}
                        </div>
                    )}
                    {d.loi_gan?.length > 0 && (
                        <ul className="space-y-1.5">
                            {d.loi_gan.slice(0, 8).map((l, i) => (
                                <li key={i} className="leading-snug">
                                    <span className="font-bold text-[#1a1a2e]">{TEN_LOI[l.m] || l.m}</span>
                                    <span className="text-gray-400"> · {TEN_CHANG[l.b] || l.b} · {new Date(l.luc).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                                    {l.t && <span className="block truncate text-gray-500" title={l.t}>{l.t}</span>}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}
        </div>
    );
};

const DeviceManager = () => {
    const [devices, setDevices] = useState([]);
    const [hienMayCu, setHienMayCu] = useState(false);
    const [mocMayCu, setMocMayCu] = useState(() => Date.now() - NGAY_MAY_CU * 86400000);
    const [loading, setLoading] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [editName, setEditName] = useState('');
    const [deleteTarget, setDeleteTarget] = useState(null); // device to confirm delete
    const [ngayDo, setNgayDo] = useState(7);
    const ngayDoRef = useRef(7); // nhịp làm mới 60 s giữ closure cũ -> đọc số ngày đang chọn qua ref
    const [doMuot, setDoMuot] = useState({});

    const fetchDoMuot = async (ngay = ngayDoRef.current) => {
        try {
            const res = await axios.get('/api/devices', { params: { resource: 'do-muot', ngay }, headers: authHeader() });
            setDoMuot(res.data?.may || {});
        } catch (error) {
            console.error('Failed to fetch do-muot:', error);
        }
    };

    const fetchDevices = async () => {
        setLoading(true);
        try {
            const [res] = await Promise.all([axios.get('/api/devices', { headers: authHeader() }), fetchDoMuot()]);
            setDevices(Array.isArray(res.data) ? res.data : []);
            setMocMayCu(Date.now() - NGAY_MAY_CU * 86400000);
        } catch (error) {
            console.error("Failed to fetch devices:", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchDevices();
        let realtimeReady = false;
        let channel = null;

        if (isSupabaseBrowserConfigured && supabase) {
            channel = supabase
                .channel('admin-devices-realtime')
                .on(
                    'postgres_changes',
                    { event: '*', schema: 'public', table: 'devices' },
                    (payload) => {
                        setDevices((prev) => {
                            if (payload.eventType === 'DELETE') {
                                return prev.filter((device) => device.id !== payload.old?.id);
                            }

                            const nextDevice = payload.new;
                            if (!nextDevice?.id) return prev;

                            const exists = prev.some((device) => device.id === nextDevice.id);
                            // Gộp, không thay: id_photo / report / machines không nằm trong bảng devices (API đính kèm),
                            // thay nguyên bản ghi thì nhịp tim nào cũng xoá mất chúng khỏi màn hình.
                            const next = exists
                                ? prev.map((device) => device.id === nextDevice.id ? { ...device, ...nextDevice } : device)
                                : [nextDevice, ...prev];

                            return next.sort((a, b) => new Date(b.last_active || 0) - new Date(a.last_active || 0));
                        });
                    }
                )
                .subscribe((status) => {
                    realtimeReady = status === 'SUBSCRIBED';
                });
        }

        const interval = setInterval(() => {
            if (realtimeReady || document.visibilityState !== 'visible') return;
            fetchDevices();
        }, 60000);

        return () => {
            clearInterval(interval);
            if (channel && supabase) supabase.removeChannel(channel);
        };
    }, []);

    const toggleMode = async (device) => {
        const newMode = device.mode === 'event' ? 'payment' : 'event';
        try {
            await axios.put('/api/devices', { id: device.id, mode: newMode }, { headers: authHeader() });
            fetchDevices();
        } catch (error) {
            console.error("Failed to update mode:", error);
        }
    };

    // Ảnh thẻ bật riêng từng máy (máy có máy không). Máy nhận trong <= 60 s, hoặc ngay nếu đang nghe realtime.
    const [savingIdPhoto, setSavingIdPhoto] = useState(null);
    const toggleIdPhoto = async (device) => {
        setSavingIdPhoto(device.id);
        try {
            const res = await axios.put('/api/devices', { id: device.id, id_photo: !device.id_photo }, { headers: authHeader() });
            setDevices((prev) => prev.map((d) => (d.id === device.id ? { ...d, id_photo: res.data?.id_photo === true } : d)));
        } catch (error) {
            console.error("Failed to update id_photo:", error);
        } finally {
            setSavingIdPhoto(null);
        }
    };

    const startEdit = (device) => {
        setEditingId(device.id);
        setEditName(device.name);
    };

    const saveName = async (id) => {
        try {
            await axios.put('/api/devices', { id, name: editName }, { headers: authHeader() });
            setEditingId(null);
            fetchDevices();
        } catch (error) {
            console.error("Failed to update name:", error);
        }
    };

    const confirmDelete = async () => {
        if (!deleteTarget) return;
        try {
            await axios.delete('/api/devices', { data: { id: deleteTarget.id }, headers: authHeader() });
            setDeleteTarget(null);
            fetchDevices();
        } catch (error) {
            console.error("Failed to delete device:", error);
        }
    };

    const laMayCu = (d) => !(new Date(d.last_active).getTime() >= mocMayCu);
    const soMayCu = devices.filter(laMayCu).length;
    const dsHien = hienMayCu ? devices : devices.filter((d) => !laMayCu(d));

    return (
        <div className="space-y-8 animate-fadeIn">
            {/* Delete Confirmation Modal */}
            {deleteTarget && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-sm mx-4 flex flex-col items-center gap-5">
                        <div className="p-4 bg-red-50 rounded-full">
                            <AlertTriangle size={32} className="text-red-500" />
                        </div>
                        <div className="text-center">
                            <h3 className="text-lg font-bold text-[#1a1a2e] mb-1">Xóa thiết bị?</h3>
                            <p className="text-sm text-gray-500">
                                Thiết bị <span className="font-semibold text-[#1a1a2e]">"{deleteTarget.name}"</span> sẽ bị xóa khỏi hệ thống.
                                Khi mở lại, máy đó sẽ tự đăng ký lại.
                            </p>
                        </div>
                        <div className="flex gap-3 w-full">
                            <button
                                onClick={() => setDeleteTarget(null)}
                                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-600 font-semibold hover:bg-gray-50 transition-colors"
                            >
                                Hủy
                            </button>
                            <button
                                onClick={confirmDelete}
                                className="flex-1 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white font-semibold transition-colors"
                            >
                                Xóa
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className="flex items-center justify-end gap-2">
                <div className="grid grid-cols-2 gap-1 rounded-xl bg-gray-100 p-1 text-xs font-bold">
                    {[7, 30].map((n) => (
                        <button
                            key={n}
                            type="button"
                            onClick={() => { setNgayDo(n); ngayDoRef.current = n; fetchDoMuot(n); }}
                            className={`rounded-lg px-3 py-1.5 transition-all ${ngayDo === n ? 'bg-white text-[#e63946] shadow-sm' : 'text-gray-500'}`}
                        >
                            {n} ngày
                        </button>
                    ))}
                </div>
                <button
                    onClick={fetchDevices}
                    className="p-2 text-gray-500 hover:text-[#e63946] transition-colors"
                >
                    <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {dsHien.map((device) => (
                    <div key={device.id} className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col gap-4">
                        <div className="flex justify-between items-start">
                            <div className="p-3 bg-gray-100 rounded-xl text-gray-600">
                                <Monitor size={24} />
                            </div>
                            <div className="flex items-center gap-2">
                                <div className={`px-3 py-1 rounded-full text-xs font-bold uppercase ${device.mode === 'event' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
                                    }`}>
                                    {device.mode === 'event' ? 'Chế độ Sự kiện' : 'Chế độ Thanh toán'}
                                </div>
                                <button
                                    onClick={() => setDeleteTarget(device)}
                                    className="p-1 text-gray-300 hover:text-red-500 transition-colors"
                                    title="Xóa thiết bị"
                                >
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        </div>

                        <div>
                            {editingId === device.id ? (
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={editName}
                                        onChange={(e) => setEditName(e.target.value)}
                                        className="border border-gray-300 rounded px-2 py-1 text-sm w-full"
                                        autoFocus
                                    />
                                    <button onClick={() => saveName(device.id)} className="text-green-600"><Check size={18} /></button>
                                    <button onClick={() => setEditingId(null)} className="text-red-500"><X size={18} /></button>
                                </div>
                            ) : (
                                <h3 className="text-xl font-bold text-[#1a1a2e] flex items-center gap-2 group">
                                    {device.name}
                                    <button onClick={() => startEdit(device)} className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-gray-600 transition-opacity">
                                        <Edit2 size={14} />
                                    </button>
                                </h3>
                            )}
                            <p className="text-xs text-gray-400 font-mono mt-1">ID: {device.device_id}</p>
                            <p className="text-xs text-gray-400 mt-1">
                                Hoạt động gần nhất: {device.last_active ? new Date(device.last_active).toLocaleString() : 'Chưa bao giờ'}
                            </p>
                        </div>

                        <TheDoMuot d={doMuot[device.device_id]} />

                        <div className="mt-auto pt-4 border-t border-gray-50 flex flex-col gap-2">
                            <button
                                onClick={() => toggleIdPhoto(device)}
                                disabled={savingIdPhoto === device.id}
                                className={`w-full py-2 rounded-lg font-bold text-sm transition-colors flex items-center justify-center gap-2 border disabled:opacity-50 ${device.id_photo
                                    ? 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
                                    : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
                                    }`}
                            >
                                <IdCard size={16} /> Ảnh thẻ: {device.id_photo ? 'Đang bật' : 'Đang tắt'}
                            </button>
                            <button
                                onClick={() => toggleMode(device)}
                                className={`w-full py-2 rounded-lg font-bold text-sm transition-colors flex items-center justify-center gap-2 ${device.mode === 'event'
                                    ? 'bg-white border border-blue-200 text-blue-600 hover:bg-blue-50'
                                    : 'bg-white border border-purple-200 text-purple-600 hover:bg-purple-50'
                                    }`}
                            >
                                {device.mode === 'event' ? (
                                    <>Chuyển sang Trả phí <DollarSign size={16} /></>
                                ) : (
                                    <>Chuyển sang Sự kiện <Zap size={16} /></>
                                )}
                            </button>
                        </div>
                    </div>
                ))}

                {devices.length === 0 && (
                    <div className="col-span-full text-center py-12 text-gray-400">
                        Chưa có thiết bị nào kết nối. Mở photobooth trên thiết bị để đăng ký.
                    </div>
                )}
            </div>

            {soMayCu > 0 && (
                <div className="flex justify-center">
                    <button
                        onClick={() => setHienMayCu((v) => !v)}
                        className="px-5 py-2.5 rounded-xl border border-gray-200 bg-white text-sm font-bold text-gray-500 hover:text-[#e63946] hover:border-red-100 transition-colors"
                    >
                        {hienMayCu
                            ? `Ẩn ${soMayCu} máy cũ`
                            : `Hiện ${soMayCu} máy cũ (không hoạt động hơn ${NGAY_MAY_CU} ngày)`}
                    </button>
                </div>
            )}
        </div>
    );
};

export default DeviceManager;
