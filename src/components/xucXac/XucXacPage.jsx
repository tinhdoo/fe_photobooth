// Trang Xúc xắc ưu đãi (/admin/xuc-xac, cloud). Nhân viên: lắc cho khách + xem lượt của mình. Admin: thêm bảng ưu
// đãi theo mặt (bật/tắt chương trình) và lịch sử mọi lượt. Kết quả do api/codes (dice-roll) quyết và ghi lại.
import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { Navigate } from 'react-router-dom';
import { Dices, Loader2, Save, Gift } from 'lucide-react';
import { authHeader, isStaffRole } from '../../utils/auth';
import { errorMessage } from '../../utils/errorMessage';
import XucXac3D from './XucXac3D';

const CHAM_NHO = {
    1: [[50, 50]], 2: [[28, 28], [72, 72]], 3: [[28, 28], [50, 50], [72, 72]],
    4: [[28, 28], [72, 28], [28, 72], [72, 72]], 5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]],
    6: [[28, 28], [72, 28], [28, 50], [72, 50], [28, 72], [72, 72]],
};
export const MatNho = ({ mat, size = 28 }) => (
    <svg width={size} height={size} viewBox="0 0 100 100" className="shrink-0" aria-label={`Mặt ${mat}`}>
        <rect x="4" y="4" width="92" height="92" rx="22" fill="#c3111b" />
        {CHAM_NHO[mat]?.map(([x, y], i) => <circle key={i} cx={x} cy={y} r="10" fill="#fff" />)}
    </svg>
);

const gio = (iso) => new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
const ngayGio = (iso) => new Date(iso).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

const NutChon = ({ ds, giaTri, onChon, nho = false }) => (
    <div
        className={`${nho ? 'inline-grid shrink-0 rounded-xl' : 'grid rounded-2xl'} gap-1 bg-gray-100 p-1`}
        style={{ gridTemplateColumns: `repeat(${ds.length}, minmax(0, 1fr))` }}
    >
        {ds.map(([k, ten]) => (
            <button
                key={String(k)}
                type="button"
                onClick={() => onChon(k)}
                className={`${nho ? 'rounded-lg px-4 py-1.5' : 'rounded-xl py-2.5'} text-sm font-bold transition-all ${giaTri === k ? 'bg-white text-[#e63946] shadow-sm' : 'text-gray-500'}`}
            >
                {ten}
            </button>
        ))}
    </div>
);

const DongLuot = ({ r, coTen }) => (
    <li className="flex items-center gap-3 py-2.5">
        <MatNho mat={r.face} size={30} />
        <div className="min-w-0 flex-1">
            <p className={`truncate text-sm font-bold ${r.uu_dai ? 'text-[#1a1a2e]' : 'text-gray-400'}`}>{r.uu_dai || 'Không có ưu đãi'}</p>
            <p className="truncate text-xs text-gray-400">{coTen ? `${r.staff_name || r.staff_username} · ` : ''}{coTen ? ngayGio(r.created_at) : gio(r.created_at)}</p>
        </div>
    </li>
);

const XucXacPage = () => {
    const laAdmin = !isStaffRole();
    const [tab, setTab] = useState('lac');
    const [cauHinh, setCauHinh] = useState(null);
    const [dangLac, setDangLac] = useState(false);
    const [ketQua, setKetQua] = useState(null);
    const [loi, setLoi] = useState('');
    const [luotCuaToi, setLuotCuaToi] = useState([]);
    const xxRef = useRef(null);

    const taiCauHinh = async () => {
        try {
            const res = await axios.get('/api/codes', { params: { action: 'dice-config' }, headers: authHeader() });
            setCauHinh(res.data);
        } catch (e) {
            setLoi(errorMessage(e, 'Không tải được bảng ưu đãi.'));
        }
    };
    const taiLuotHomNay = async () => {
        try {
            const res = await axios.get('/api/codes', { params: { action: 'dice-list', ngay: 1, cua_toi: 1 }, headers: authHeader() });
            // cua_toi: admin cũng chỉ xem lượt của mình ở tab Lắc (lịch sử chung ở tab Lịch sử).
            setLuotCuaToi(res.data?.rolls || []);
        } catch { /* danh sách phụ, lỗi thì để trống */ }
    };
    useEffect(() => {
        taiCauHinh();
        taiLuotHomNay();
    }, []);

    const lac = async () => {
        if (dangLac || cauHinh?.bat === false) return;
        setDangLac(true);
        setLoi('');
        setKetQua(null);
        xxRef.current?.batDauLac();
        const batDau = performance.now();
        let roll = null;
        try {
            const res = await axios.post('/api/codes', { action: 'dice-roll' }, { headers: authHeader(), timeout: 15000 });
            roll = res.data?.roll || null;
        } catch (e) {
            setLoi(errorMessage(e, 'Không lắc được, thử lại.'));
        }
        // Lắc ít nhất 0,6 s cho ra dáng, dù API trả nhanh.
        const conLai = 600 - (performance.now() - batDau);
        if (conLai > 0) await new Promise((r) => setTimeout(r, conLai));
        if (roll) {
            await xxRef.current?.roi(roll.face);
            try { navigator.vibrate?.(40); } catch { /* không hỗ trợ */ }
            setKetQua(roll);
            setLuotCuaToi((ds) => [roll, ...ds]);
        } else {
            await xxRef.current?.roi(ketQua?.face || 6);
        }
        setDangLac(false);
    };

    const tat = cauHinh?.bat === false;
    // Admin đang ẩn mục này với nhân viên (vào bằng link cũ) -> về Mã thanh toán.
    if (!laAdmin && cauHinh?.hien_nv === false) return <Navigate to="/admin/codes" replace />;

    return (
        <div className="animate-fadeIn mx-auto w-full max-w-xl">
            <h1 className="mb-3 text-2xl font-bold tracking-tight text-[#1a1a2e]">Xúc xắc ưu đãi</h1>

            {laAdmin && (
                <div className="mb-4">
                    <NutChon ds={[['lac', 'Lắc'], ['uu_dai', 'Ưu đãi'], ['lich_su', 'Lịch sử']]} giaTri={tab} onChon={setTab} />
                </div>
            )}

            {/* Giữ viên xúc xắc sống khi đổi tab (không dựng lại cảnh 3D). */}
            <div className={tab === 'lac' ? 'space-y-4' : 'hidden'}>
                <div className="relative overflow-hidden rounded-3xl bg-gradient-to-b from-white to-gray-100 shadow-sm ring-1 ring-gray-100">
                    <div className="mx-auto aspect-square w-full max-w-[380px]">
                        <XucXac3D ref={xxRef} onCham={lac} />
                    </div>
                    {tat && (
                        <div className="absolute inset-0 flex items-center justify-center bg-white/70 text-sm font-bold text-gray-500 backdrop-blur-[2px]">
                            Chương trình đang tắt
                        </div>
                    )}
                </div>

                <div className="min-h-[76px]">
                    {ketQua ? (
                        <div className="flex items-center gap-3 rounded-2xl border-2 border-[#e63946]/20 bg-[#e63946]/5 p-3.5">
                            <MatNho mat={ketQua.face} size={44} />
                            <div className="min-w-0 flex-1">
                                <p className="text-xs font-semibold text-gray-500">Mặt {ketQua.face}</p>
                                <p className={`text-lg font-black leading-tight ${ketQua.uu_dai ? 'text-[#e63946]' : 'text-gray-400'}`}>
                                    {ketQua.uu_dai || 'Không có ưu đãi'}
                                </p>
                            </div>
                            {ketQua.uu_dai && <Gift size={26} className="shrink-0 text-[#e63946]" />}
                        </div>
                    ) : loi ? (
                        <div className="rounded-2xl border border-red-200 bg-red-50 p-3.5 text-sm font-semibold text-red-700">{loi}</div>
                    ) : null}
                </div>

                <button
                    type="button"
                    onClick={lac}
                    disabled={dangLac || tat || !cauHinh}
                    className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#e63946] py-4 text-base font-bold text-white shadow-lg shadow-[#e63946]/20 transition-all active:scale-[0.98] disabled:opacity-60"
                >
                    {dangLac ? <Loader2 size={20} className="animate-spin" /> : <Dices size={22} />}
                    {dangLac ? 'Đang lắc…' : 'Lắc'}
                </button>

                {luotCuaToi.length > 0 && (
                    <div className="rounded-2xl border border-gray-100 bg-white px-4 py-2">
                        <p className="pt-1.5 text-xs font-bold text-gray-400">Hôm nay · {luotCuaToi.length} lượt</p>
                        <ul className="divide-y divide-gray-50">
                            {luotCuaToi.slice(0, 20).map((r) => <DongLuot key={r.id} r={r} />)}
                        </ul>
                    </div>
                )}
            </div>

            {laAdmin && tab === 'uu_dai' && cauHinh && <BangUuDai cauHinh={cauHinh} onLuu={setCauHinh} />}
            {laAdmin && tab === 'lich_su' && <LichSu tyLe={cauHinh?.ty_le} />}
        </div>
    );
};

// Ô tỉ lệ để trống hết = đều 1/6. Điền thì ô trống tính 0%, tổng phải đúng 100%.
const soTyLe = (v) => Number(String(v ?? '').replace(',', '.'));
const hienSo = (n) => (Math.round(n * 10) / 10).toLocaleString('vi-VN');

const BangUuDai = ({ cauHinh, onLuu }) => {
    const [ban, setBan] = useState(() => ({ bat: cauHinh.bat !== false, hien_nv: cauHinh.hien_nv !== false, uu_dai: { ...cauHinh.uu_dai } }));
    const [tyLe, setTyLe] = useState(() => {
        const t = {};
        for (let m = 1; m <= 6; m += 1) t[m] = cauHinh.ty_le ? String(cauHinh.ty_le[m]).replace('.', ',') : '';
        return t;
    });
    const [dangLuu, setDangLuu] = useState(false);
    const [tb, setTb] = useState(null);
    const deuHet = [1, 2, 3, 4, 5, 6].every((m) => String(tyLe[m]).trim() === '');
    const loiO = [1, 2, 3, 4, 5, 6].some((m) => String(tyLe[m]).trim() !== '' && !(soTyLe(tyLe[m]) >= 0 && soTyLe(tyLe[m]) <= 100));
    const tong = [1, 2, 3, 4, 5, 6].reduce((a, m) => a + (String(tyLe[m]).trim() === '' ? 0 : soTyLe(tyLe[m]) || 0), 0);
    const hopLe = deuHet || (!loiO && Math.abs(tong - 100) < 0.05);
    const luu = async () => {
        if (!hopLe) return;
        setDangLuu(true);
        setTb(null);
        const guiTyLe = deuHet ? null : Object.fromEntries([1, 2, 3, 4, 5, 6].map((m) => [m, String(tyLe[m]).trim() === '' ? 0 : soTyLe(tyLe[m])]));
        try {
            const res = await axios.post('/api/codes', { action: 'dice-config', ...ban, ty_le: guiTyLe }, { headers: authHeader() });
            onLuu({ bat: res.data.bat, hien_nv: res.data.hien_nv, uu_dai: res.data.uu_dai, ty_le: res.data.ty_le });
            try { localStorage.setItem('ptb_xuc_xac_hien', res.data.hien_nv === false ? '0' : '1'); } catch { /* bỏ qua */ }
            setTb({ ok: true, text: 'Đã lưu' });
        } catch (e) {
            setTb({ ok: false, text: errorMessage(e, 'Lưu thất bại.') });
        } finally {
            setDangLuu(false);
        }
    };
    return (
        <div className="space-y-3">
            <div className="divide-y divide-gray-50 rounded-2xl border border-gray-100 bg-white px-4">
                <div className="flex items-center justify-between py-3">
                    <span className="text-sm font-bold text-[#1a1a2e]">Chương trình</span>
                    <NutChon nho ds={[[true, 'Bật'], [false, 'Tắt']]} giaTri={ban.bat} onChon={(v) => setBan((b) => ({ ...b, bat: v }))} />
                </div>
                <div className="flex items-center justify-between py-3">
                    <span className="text-sm font-bold text-[#1a1a2e]">Hiện cho nhân viên</span>
                    <NutChon nho ds={[[true, 'Hiện'], [false, 'Ẩn']]} giaTri={ban.hien_nv} onChon={(v) => setBan((b) => ({ ...b, hien_nv: v }))} />
                </div>
            </div>
            <div className="divide-y divide-gray-50 rounded-2xl border border-gray-100 bg-white px-4">
                {[1, 2, 3, 4, 5, 6].map((m) => (
                    <label key={m} className="flex items-center gap-3 py-2.5">
                        <MatNho mat={m} size={32} />
                        <input
                            value={ban.uu_dai[m] || ''}
                            onChange={(e) => setBan((b) => ({ ...b, uu_dai: { ...b.uu_dai, [m]: e.target.value } }))}
                            maxLength={80}
                            placeholder="Không có ưu đãi"
                            className="h-11 min-w-0 flex-1 rounded-xl border border-gray-200 px-3 text-sm font-semibold text-[#1a1a2e] outline-none focus:border-[#e63946]/50"
                        />
                        <div className="relative w-[76px] shrink-0">
                            <input
                                value={tyLe[m]}
                                onChange={(e) => setTyLe((t) => ({ ...t, [m]: e.target.value.replace(/[^0-9.,]/g, '').slice(0, 5) }))}
                                inputMode="decimal"
                                placeholder={hienSo(100 / 6)}
                                aria-label={`Tỉ lệ mặt ${m}`}
                                className="h-11 w-full rounded-xl border border-gray-200 pl-2.5 pr-6 text-right text-sm font-bold text-[#1a1a2e] outline-none placeholder:font-semibold placeholder:text-gray-300 focus:border-[#e63946]/50"
                            />
                            <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-bold text-gray-400">%</span>
                        </div>
                    </label>
                ))}
                <div className="flex items-center gap-2 py-3 text-sm">
                    <span className="font-bold text-[#1a1a2e]">Tỉ lệ</span>
                    <span className={`font-black ${hopLe ? 'text-emerald-600' : 'text-red-600'}`}>
                        {deuHet ? 'Đều 6 mặt' : `${hienSo(tong)}%`}
                    </span>
                    {!hopLe && <span className="text-xs font-semibold text-red-500">{loiO ? 'Số không hợp lệ' : `cần đủ 100%`}</span>}
                    {!deuHet && (
                        <button
                            type="button"
                            onClick={() => setTyLe({ 1: '', 2: '', 3: '', 4: '', 5: '', 6: '' })}
                            className="ml-auto rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-bold text-gray-500"
                        >
                            Chia đều
                        </button>
                    )}
                </div>
            </div>
            <button
                type="button"
                onClick={luu}
                disabled={dangLuu || !hopLe}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#1a1a2e] py-3.5 text-sm font-bold text-white disabled:opacity-60"
            >
                {dangLuu ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />} Lưu
            </button>
            {tb && <p className={`text-center text-sm font-semibold ${tb.ok ? 'text-emerald-600' : 'text-red-600'}`}>{tb.text}</p>}
        </div>
    );
};

const LichSu = ({ tyLe }) => {
    const [ngay, setNgay] = useState(1);
    const [ds, setDs] = useState(null);
    const [thieuBang, setThieuBang] = useState(false);
    useEffect(() => {
        let huy = false;
        setDs(null);
        axios.get('/api/codes', { params: { action: 'dice-list', ngay }, headers: authHeader() })
            .then((res) => { if (!huy) { setDs(res.data?.rolls || []); setThieuBang(!!res.data?.thieu_bang); } })
            .catch(() => { if (!huy) setDs([]); });
        return () => { huy = true; };
    }, [ngay]);

    const dem = [1, 2, 3, 4, 5, 6].map((m) => (ds || []).filter((r) => r.face === m).length);
    const theoNv = Object.values((ds || []).reduce((acc, r) => {
        const k = r.staff_username;
        acc[k] = acc[k] || { ten: r.staff_name || k, n: 0 };
        acc[k].n += 1;
        return acc;
    }, {})).sort((a, b) => b.n - a.n);

    return (
        <div className="space-y-3">
            <NutChon ds={[[1, 'Hôm nay'], [7, '7 ngày'], [30, '30 ngày']]} giaTri={ngay} onChon={setNgay} />
            {ds === null ? (
                <div className="flex justify-center py-10 text-gray-400"><Loader2 className="animate-spin" /></div>
            ) : thieuBang ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-700">Chưa tạo bảng dice_rolls trên Supabase.</div>
            ) : (
                <>
                    <div className="rounded-2xl border border-gray-100 bg-white p-4">
                        <div className="flex items-baseline justify-between">
                            <span className="text-3xl font-black text-[#1a1a2e]">{ds.length}</span>
                            <span className="text-xs font-semibold text-gray-400">lượt</span>
                        </div>
                        <div className="mt-3 grid grid-cols-6 gap-1.5">
                            {dem.map((n, i) => (
                                <div key={i} className="flex flex-col items-center gap-0.5 rounded-xl bg-gray-50 py-2">
                                    <MatNho mat={i + 1} size={24} />
                                    <span className="mt-0.5 text-sm font-black text-[#1a1a2e]">{n}</span>
                                    <span className="text-[10px] font-bold text-gray-500">{ds.length ? `${hienSo((100 * n) / ds.length)}%` : '—'}</span>
                                    <span className="text-[10px] font-semibold text-gray-300">đặt {hienSo(tyLe ? tyLe[i + 1] : 100 / 6)}%</span>
                                </div>
                            ))}
                        </div>
                        {theoNv.length > 0 && (
                            <div className="mt-3 flex flex-wrap gap-1.5">
                                {theoNv.map((x) => (
                                    <span key={x.ten} className="rounded-lg bg-gray-100 px-2 py-1 text-xs font-bold text-gray-600">{x.ten} · {x.n}</span>
                                ))}
                            </div>
                        )}
                    </div>
                    {ds.length > 0 && (
                        <ul className="divide-y divide-gray-50 rounded-2xl border border-gray-100 bg-white px-4">
                            {ds.slice(0, 300).map((r) => <DongLuot key={r.id} r={r} coTen />)}
                        </ul>
                    )}
                </>
            )}
        </div>
    );
};

export default XucXacPage;
