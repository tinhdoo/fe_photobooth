// Đổi dấu tích điểm lấy voucher ở màn Thanh toán: SĐT -> PIN -> chọn mốc 5/7/10 (thẻ về 0). Cloud (td-doi) trả về
// một MÃ THANH TOÁN dùng một lần; Payment áp mã đó y như khách tự nhập mã. Dấu chỉ bị trừ khi mã được dùng.
import { useState } from 'react';
import axios from 'axios';
import { Loader2 } from 'lucide-react';
import { CLOUD_API_URL } from '../../config/api';
import { errorMessage } from '../../utils/errorMessage';
import TheMeo, { MAU_THE } from './TheMeo';
import BanPhim, { OSo, hienSdt } from './BanPhim';
import DatPin from './DatPin';

const MUC = [{ dau: 5, giaTri: 50000 }, { dau: 7, giaTri: 70000 }, { dau: 10, giaTri: 100000 }];

const DoiDiem = ({ gia, mau, onApDung }) => {
    const [buoc, setBuoc] = useState('sdt'); // sdt | pin | dat_pin | chon
    const [sdt, setSdt] = useState('');
    const [pin, setPin] = useState('');
    const [the, setThe] = useState(null);
    const [dangGui, setDangGui] = useState(false);
    const [loi, setLoi] = useState('');

    const goi = async (them) => {
        setDangGui(true);
        setLoi('');
        try {
            const res = await axios.post(`${CLOUD_API_URL}/api/codes`, { action: 'td-doi', phone: sdt, ...them }, { timeout: 15000 });
            return res.data;
        } catch (e) {
            if (e.response?.data?.sai_pin) setPin('');
            setLoi(errorMessage(e, 'Chưa đổi được, vui lòng thử lại.'));
            return null;
        } finally {
            setDangGui(false);
        }
    };

    const kiemPin = async (p) => {
        const d = await goi({ pin: p });
        if (!d) return;
        if (d.can_pin) { setThe(d); setBuoc('dat_pin'); return; }
        setThe(d);
        setBuoc('chon');
    };

    const datPin = async (p) => {
        const d = await goi({ pin_moi: p });
        if (!d) return;
        setPin(p);
        setThe(d);
        setBuoc('chon');
    };

    const doi = async (muc) => {
        const d = await goi({ pin, muc: muc.dau });
        if (d?.code) onApDung({ id: d.id, code: d.code, value: Number(d.value), used: false, tichDiem: true, muc: muc.dau });
    };

    return (
        <div className="flex w-full flex-col items-center gap-5">
            <h3 className="text-3xl font-bold" style={{ color: MAU_THE.vien }}>Đổi điểm thẻ tích điểm</h3>

            {buoc === 'sdt' && (
                <>
                    <p className="text-lg" style={{ color: mau }}>Nhập số điện thoại đã tích điểm</p>
                    <p className="min-h-[2.5rem] text-4xl font-bold tracking-wider" style={{ color: MAU_THE.vien }}>{hienSdt(sdt) || ' '}</p>
                    {loi && <p className="text-center text-lg font-bold text-red-600">{loi}</p>}
                    <BanPhim giaTri={sdt} doDai={10} onDoi={(v) => { setLoi(''); setSdt(v); }} mau={mau} />
                    <button
                        type="button"
                        disabled={sdt.length !== 10}
                        onClick={() => { setLoi(''); setBuoc('pin'); }}
                        className="rounded-full bg-[#A61018] px-12 py-4 text-xl font-black text-white shadow-lg active:scale-95 disabled:opacity-40"
                    >
                        Tiếp tục
                    </button>
                </>
            )}

            {buoc === 'pin' && (
                <>
                    <p className="text-lg" style={{ color: mau }}>Nhập mã PIN của số {hienSdt(sdt)}</p>
                    <OSo giaTri={pin} doDai={4} an />
                    {loi && <p className="max-w-md text-center text-lg font-bold text-red-600">{loi}</p>}
                    {dangGui && <Loader2 className="animate-spin" size={28} style={{ color: mau }} />}
                    <BanPhim
                        giaTri={pin}
                        doDai={4}
                        mau={mau}
                        onDoi={(v) => { setLoi(''); setPin(v); if (v.length === 4) kiemPin(v); }}
                    />
                    <p className="max-w-md text-center text-sm opacity-70" style={{ color: mau }}>Quên PIN? Nhờ nhân viên đặt lại.</p>
                </>
            )}

            {buoc === 'dat_pin' && (
                <>
                    {loi && <p className="text-center text-lg font-bold text-red-600">{loi}</p>}
                    <DatPin sdtAn={the?.sdt} mau={mau} dangGui={dangGui} onXong={datPin} />
                </>
            )}

            {buoc === 'chon' && the && (
                <>
                    <p className="text-lg" style={{ color: mau }}>Số {the.sdt} đang có <strong>{the.dau}/10</strong> dấu</p>
                    <TheMeo dau={the.dau} />
                    {loi && <p className="text-center text-lg font-bold text-red-600">{loi}</p>}
                    {(the.muc_doi || []).length === 0 ? (
                        <p className="text-center text-xl font-bold" style={{ color: mau }}>
                            Cần ít nhất 5 dấu để đổi voucher. Còn {5 - the.dau} dấu nữa nhé!
                        </p>
                    ) : (
                        <>
                            <div className="grid w-full max-w-xl grid-cols-3 gap-4">
                                {MUC.map((m) => {
                                    const duoc = the.dau >= m.dau;
                                    return (
                                        <button
                                            type="button"
                                            key={m.dau}
                                            disabled={!duoc || dangGui}
                                            onClick={() => doi(m)}
                                            className="flex flex-col items-center rounded-3xl border-4 bg-white px-3 py-5 shadow-md active:scale-95 disabled:opacity-35"
                                            style={{ borderColor: MAU_THE.vien, color: MAU_THE.vien }}
                                        >
                                            <span className="text-3xl font-black">{m.giaTri / 1000}K</span>
                                            <span className="mt-1 text-sm font-bold">{m.dau} dấu</span>
                                        </button>
                                    );
                                })}
                            </div>
                            <p className="max-w-lg text-center text-base font-semibold" style={{ color: mau }}>
                                Đổi xong thẻ về 0 dấu. Lượt dùng voucher không được cộng dấu.
                                {gia < 100000 ? ` Voucher lớn hơn giá lượt (${gia.toLocaleString('vi-VN')}đ) thì phần dư không được hoàn lại.` : ''}
                            </p>
                        </>
                    )}
                </>
            )}
        </div>
    );
};

export default DoiDiem;
