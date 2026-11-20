// Tích điểm ở màn Kết quả: khách nhập SĐT -> cloud cộng 1 dấu cho lượt vừa chụp (api/codes td-cong).
// SĐT mới -> đặt PIN + đồng ý rồi gửi lại. Hiện thẻ mèo với số dấu sau khi cộng.
import { useState } from 'react';
import axios from 'axios';
import { Loader2, X } from 'lucide-react';
import { CLOUD_API_URL } from '../../config/api';
import { errorMessage } from '../../utils/errorMessage';
import TheMeo, { MAU_THE } from './TheMeo';
import BanPhim, { hienSdt } from './BanPhim';
import DatPin from './DatPin';

const ngu = (ms) => new Promise((r) => setTimeout(r, ms));

const TichDiemKetQua = ({ maLuot, mau, onDong, onDaTich }) => {
    const [sdt, setSdt] = useState('');
    const [buoc, setBuoc] = useState('sdt'); // sdt | pin | xong
    const [dangGui, setDangGui] = useState(false);
    const [loi, setLoi] = useState('');
    const [kq, setKq] = useState(null);

    const gui = async (them = {}) => {
        setDangGui(true);
        setLoi('');
        try {
            let res = null;
            // Lượt chụp vừa lưu lên cloud có thể chưa kịp -> thử lại vài lần.
            for (let lan = 0; lan < 4; lan += 1) {
                try {
                    res = await axios.post(`${CLOUD_API_URL}/api/codes`, { action: 'td-cong', phone: sdt, session_id: maLuot, ...them }, { timeout: 15000 });
                    break;
                } catch (e) {
                    if (e.response?.data?.thu_lai && lan < 3) { await ngu(2500); continue; }
                    throw e;
                }
            }
            const d = res.data;
            if (d.can_pin) { setKq(d); setBuoc('pin'); return; }
            setKq(d);
            setBuoc('xong');
            onDaTich?.();
        } catch (e) {
            const d = e.response?.data;
            // Quá giới hạn trong ngày vẫn kèm số dấu -> hiện thẻ.
            if (d && typeof d.dau === 'number' && e.response.status === 429) {
                setKq({ ...d, thong_bao: d.message });
                setBuoc('xong');
                return;
            }
            setLoi(errorMessage(e, 'Chưa tích điểm được, vui lòng thử lại.'));
        } finally {
            setDangGui(false);
        }
    };

    const loiNhan = () => {
        if (!kq) return '';
        if (kq.thong_bao) return kq.thong_bao;
        if (kq.da_cong_truoc) return 'Lượt này đã được tích điểm rồi.';
        if (kq.the_day) return 'Thẻ đã đủ 10 dấu — lần sau đổi voucher 100K nhé!';
        return 'Đã cộng 1 dấu!';
    };
    const goiY = () => {
        const muc = kq?.muc_doi || [];
        if (!muc.length) {
            const con = 5 - (kq?.dau || 0);
            return `Còn ${con} dấu nữa là đổi được voucher 50K.`;
        }
        const cao = muc[muc.length - 1];
        return `Lần sau ở bước Thanh toán, bấm "Dùng điểm" để đổi voucher ${cao.giaTri / 1000}K (hoặc tích tiếp lên mốc cao hơn).`;
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm">
            <div className="relative flex max-h-full w-full max-w-2xl flex-col items-center gap-5 overflow-y-auto rounded-3xl bg-white p-10 shadow-2xl">
                <button type="button" onClick={onDong} className="absolute right-5 top-5 rounded-full bg-gray-100 p-3 active:scale-95" aria-label="Đóng">
                    <X size={26} />
                </button>

                {buoc === 'sdt' && (
                    <>
                        <h3 className="text-3xl font-bold" style={{ color: MAU_THE.vien }}>Tích điểm thẻ mèo</h3>
                        <p className="text-center text-lg" style={{ color: mau }}>Nhập số điện thoại để được 1 dấu cho lượt chụp này.</p>
                        <p className="min-h-[2.5rem] text-4xl font-bold tracking-wider" style={{ color: MAU_THE.vien }}>{hienSdt(sdt) || ' '}</p>
                        {loi && <p className="text-center text-lg font-bold text-red-600">{loi}</p>}
                        <BanPhim giaTri={sdt} doDai={10} onDoi={(v) => { setLoi(''); setSdt(v); }} mau={mau} />
                        <button
                            type="button"
                            disabled={sdt.length !== 10 || dangGui}
                            onClick={() => gui()}
                            className="flex items-center gap-2 rounded-full bg-[#B32025] px-12 py-4 text-xl font-black text-white shadow-lg active:scale-95 disabled:opacity-40"
                        >
                            {dangGui && <Loader2 className="animate-spin" size={22} />} Tích điểm
                        </button>
                    </>
                )}

                {buoc === 'pin' && (
                    <>
                        {loi && <p className="text-center text-lg font-bold text-red-600">{loi}</p>}
                        <DatPin
                            sdtAn={kq?.sdt}
                            mau={mau}
                            dangGui={dangGui}
                            onXong={(pin) => gui({ pin_moi: pin, dong_y: true })}
                        />
                    </>
                )}

                {buoc === 'xong' && (
                    <>
                        <h3 className="text-3xl font-bold" style={{ color: MAU_THE.vien }}>{loiNhan()}</h3>
                        <p className="text-lg" style={{ color: mau }}>Số {kq?.sdt} đang có <strong>{kq?.dau || 0}/10</strong> dấu</p>
                        <TheMeo dau={kq?.dau || 0} />
                        <p className="max-w-lg text-center text-lg font-semibold" style={{ color: mau }}>{goiY()}</p>
                        <p className="text-sm opacity-70" style={{ color: mau }}>Dấu hết hạn nếu 6 tháng không quay lại.</p>
                        <button type="button" onClick={onDong} className="rounded-full bg-[#D5B895] px-12 py-4 text-xl font-bold text-white shadow-lg active:scale-95">
                            Xong
                        </button>
                    </>
                )}
            </div>
        </div>
    );
};

export default TichDiemKetQua;
