// Trang Tích điểm (/admin/tich-diem, cloud). Nhân viên: tra SĐT, nhập dấu từ thẻ giấy, xoá PIN khi khách quên.
// Admin: thêm công tắc bật trên booth + hoạt động gần đây. Logic ở lib/tichDiem.js (api/codes td-*).
import { useEffect, useState } from 'react';
import axios from 'axios';
import { Loader2, Search, KeyRound, Save } from 'lucide-react';
import { authHeader, isStaffRole } from '../../utils/auth';
import { errorMessage } from '../../utils/errorMessage';
import TheMeo from './TheMeo';

const NHAN_LOAI = {
    cong: 'Cộng dấu (lượt chụp)',
    doi: 'Đổi voucher',
    het_han: 'Hết hạn 6 tháng',
    nv_sua: 'Nhân viên sửa dấu',
    nv_pin: 'Nhân viên xoá PIN',
};
const ngayGio = (iso) => (iso ? new Date(iso).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '--');

const DongNhatKy = ({ r, coSdt }) => (
    <li className="flex items-center justify-between gap-3 py-2.5 text-sm">
        <div className="min-w-0">
            <p className="truncate font-bold text-[#1a1a2e]">
                {NHAN_LOAI[r.kind] || r.kind}
                {r.kind === 'doi' && r.value ? ` ${Number(r.value) / 1000}K` : ''}
            </p>
            <p className="truncate text-xs text-gray-400">
                {coSdt ? `${r.phone} · ` : ''}{ngayGio(r.created_at)}{r.actor ? ` · ${r.actor}` : ''}{r.note && r.kind.startsWith('nv') ? ` · ${r.note}` : ''}
            </p>
        </div>
        <span className="shrink-0 font-mono text-sm font-bold text-gray-600">{r.stamps_truoc ?? '–'} → {r.stamps_sau ?? '–'}</span>
    </li>
);

const TichDiemPage = () => {
    const laAdmin = !isStaffRole();
    const [sdt, setSdt] = useState('');
    const [the, setThe] = useState(null);
    const [dangTai, setDangTai] = useState(false);
    const [loi, setLoi] = useState('');
    const [dauMoi, setDauMoi] = useState(null);
    const [ghiChu, setGhiChu] = useState('');
    const [bat, setBat] = useState(null);
    const [tongQuan, setTongQuan] = useState(null);

    useEffect(() => {
        if (!laAdmin) return;
        axios.get('/api/config').then((res) => setBat(String(res.data?.tich_diem_bat) === 'true')).catch(() => setBat(false));
        axios.post('/api/codes', { action: 'td-tong' }, { headers: authHeader() })
            .then((res) => setTongQuan(res.data))
            .catch((e) => setTongQuan({ loi: errorMessage(e, 'Không tải được.') }));
    }, [laAdmin]);

    const goi = async (body) => {
        setDangTai(true);
        setLoi('');
        try {
            const res = await axios.post('/api/codes', body, { headers: authHeader() });
            setThe(res.data);
            setDauMoi(res.data.dau);
            return true;
        } catch (e) {
            setLoi(errorMessage(e, 'Có lỗi, thử lại.'));
            return false;
        } finally {
            setDangTai(false);
        }
    };

    const tra = (e) => {
        e?.preventDefault();
        if (sdt.replace(/\D/g, '').length < 10) { setLoi('Nhập đủ 10 số.'); return; }
        goi({ action: 'td-nv-xem', phone: sdt });
    };
    const luuDau = async () => {
        if (await goi({ action: 'td-nv-sua', phone: the.sdt, dau: dauMoi, ghi_chu: ghiChu })) setGhiChu('');
    };
    const xoaPin = () => {
        if (!window.confirm(`Xoá PIN của ${the.sdt}? Khách sẽ đặt PIN mới ở lần dùng booth tiếp theo.`)) return;
        goi({ action: 'td-nv-pin', phone: the.sdt });
    };
    const doiBat = async () => {
        const moi = !bat;
        try {
            await axios.post('/api/config', { tich_diem_bat: moi ? 'true' : 'false' }, { headers: authHeader() });
            setBat(moi);
        } catch (e) {
            setLoi(errorMessage(e, 'Không lưu được.'));
        }
    };

    return (
        <div className="animate-fadeIn mx-auto w-full max-w-xl">
            <h1 className="mb-4 text-2xl font-bold tracking-tight text-[#1a1a2e]">Tích điểm</h1>

            {laAdmin && (
                <div className="mb-4 flex items-center justify-between rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-100">
                    <div>
                        <p className="font-bold text-[#1a1a2e]">Bật trên booth</p>
                        {tongQuan?.so_the != null && <p className="text-xs text-gray-400">{tongQuan.so_the} thẻ</p>}
                    </div>
                    <button
                        type="button"
                        disabled={bat == null}
                        onClick={doiBat}
                        className={`relative h-8 w-14 rounded-full transition-colors ${bat ? 'bg-[#e63946]' : 'bg-gray-300'}`}
                        aria-label="Bật tích điểm trên booth"
                    >
                        <span className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all ${bat ? 'left-7' : 'left-1'}`} />
                    </button>
                </div>
            )}

            <form onSubmit={tra} className="mb-4 flex gap-2">
                <input
                    type="tel"
                    inputMode="numeric"
                    value={sdt}
                    onChange={(e) => setSdt(e.target.value)}
                    placeholder="Số điện thoại"
                    className="min-w-0 flex-1 rounded-2xl border border-gray-200 bg-white px-4 py-3 text-lg font-semibold outline-none focus:border-[#e63946]"
                />
                <button type="submit" disabled={dangTai} className="flex items-center gap-2 rounded-2xl bg-[#1a1a2e] px-5 font-bold text-white disabled:opacity-50">
                    {dangTai ? <Loader2 size={18} className="animate-spin" /> : <Search size={18} />} Tra
                </button>
            </form>
            {loi && <p className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-600">{loi}</p>}

            {the && (
                <div className="mb-6 space-y-4 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-gray-100">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-lg font-bold text-[#1a1a2e]">{the.sdt}</p>
                            <p className="text-xs text-gray-400">
                                {the.co_the ? `${the.dau}/10 dấu · PIN ${the.co_pin ? 'đã đặt' : 'chưa đặt'} · dấu cuối ${ngayGio(the.dau_cuoi_luc)}` : 'Chưa có thẻ'}
                            </p>
                        </div>
                        {the.co_pin && (
                            <button type="button" onClick={xoaPin} className="flex items-center gap-1.5 rounded-xl bg-gray-100 px-3 py-2 text-sm font-bold text-gray-600">
                                <KeyRound size={16} /> Xoá PIN
                            </button>
                        )}
                    </div>
                    <div className="flex justify-center"><TheMeo dau={the.dau} nho /></div>

                    <div className="space-y-2">
                        <div className="grid grid-cols-11 gap-1">
                            {Array.from({ length: 11 }, (_, i) => (
                                <button
                                    key={i}
                                    type="button"
                                    onClick={() => setDauMoi(i)}
                                    className={`rounded-lg py-2 text-sm font-bold ${dauMoi === i ? 'bg-[#e63946] text-white' : 'bg-gray-100 text-gray-600'}`}
                                >
                                    {i}
                                </button>
                            ))}
                        </div>
                        <div className="flex gap-2">
                            <input
                                value={ghiChu}
                                onChange={(e) => setGhiChu(e.target.value)}
                                placeholder="Ghi chú (vd: thẻ giấy)"
                                className="min-w-0 flex-1 rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#e63946]"
                            />
                            <button
                                type="button"
                                disabled={dangTai || dauMoi === the.dau}
                                onClick={luuDau}
                                className="flex items-center gap-1.5 rounded-xl bg-[#e63946] px-4 text-sm font-bold text-white disabled:opacity-40"
                            >
                                <Save size={16} /> Lưu {dauMoi} dấu
                            </button>
                        </div>
                    </div>

                    {the.nhat_ky?.length > 0 && (
                        <ul className="divide-y divide-gray-100 border-t border-gray-100">
                            {the.nhat_ky.map((r) => <DongNhatKy key={r.id} r={r} />)}
                        </ul>
                    )}
                </div>
            )}

            {laAdmin && tongQuan && (
                <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-gray-100">
                    <p className="mb-2 font-bold text-[#1a1a2e]">Gần đây</p>
                    {tongQuan.loi ? (
                        <p className="text-sm text-red-600">{tongQuan.loi}</p>
                    ) : tongQuan.nhat_ky?.length ? (
                        <ul className="divide-y divide-gray-100">
                            {tongQuan.nhat_ky.map((r) => <DongNhatKy key={r.id} r={r} coSdt />)}
                        </ul>
                    ) : (
                        <p className="text-sm text-gray-400">Chưa có hoạt động.</p>
                    )}
                </div>
            )}
        </div>
    );
};

export default TichDiemPage;
