// Đặt PIN 4 số lần đầu (nhập 2 lần) + đồng ý lưu SĐT (Nghị định 13/2023). Dùng ở màn Kết quả và Thanh toán.
import { useState } from 'react';
import BanPhim, { OSo } from './BanPhim';

const DatPin = ({ sdtAn, mau, dangGui, onXong }) => {
    const [pin, setPin] = useState('');
    const [pin2, setPin2] = useState('');
    const [buoc, setBuoc] = useState(1);
    const [dongY, setDongY] = useState(false);
    const [loi, setLoi] = useState('');

    const doiPin = (v) => {
        setLoi('');
        if (buoc === 1) {
            setPin(v);
            if (v.length === 4) setBuoc(2);
        } else {
            setPin2(v);
            if (v.length === 4 && v !== pin) {
                setLoi('Hai lần nhập PIN không khớp, nhập lại nhé.');
                setPin(''); setPin2(''); setBuoc(1);
            }
        }
    };
    const xong = buoc === 2 && pin2.length === 4 && pin2 === pin;

    return (
        <div className="flex w-full flex-col items-center gap-5">
            <div className="text-center">
                <h3 className="text-3xl font-bold" style={{ color: mau }}>
                    {buoc === 1 ? 'Đặt mã PIN 4 số' : 'Nhập lại mã PIN'}
                </h3>
                <p className="mt-2 text-lg" style={{ color: mau }}>
                    Dùng khi đổi voucher cho số {sdtAn}. Nhớ kỹ nhé!
                </p>
            </div>
            <OSo giaTri={buoc === 1 ? pin : pin2} doDai={4} an />
            {loi && <p className="text-lg font-bold text-red-600">{loi}</p>}
            <BanPhim giaTri={buoc === 1 ? pin : pin2} doDai={4} onDoi={doiPin} mau={mau} />
            <label className="flex max-w-md items-start gap-3 rounded-2xl bg-[#F6E6C9]/50 p-4 text-left text-base" style={{ color: mau }}>
                <input
                    type="checkbox"
                    checked={dongY}
                    onChange={(e) => setDongY(e.target.checked)}
                    className="mt-1 h-6 w-6 shrink-0 accent-[#B32025]"
                />
                <span>Tôi đồng ý cho Tomato Photobooth lưu số điện thoại này để tích điểm và gửi ưu đãi.</span>
            </label>
            <button
                type="button"
                disabled={!xong || !dongY || dangGui}
                onClick={() => onXong(pin)}
                className="rounded-full bg-[#B32025] px-12 py-4 text-xl font-black text-white shadow-lg active:scale-95 disabled:opacity-40"
            >
                {dangGui ? 'Đang lưu...' : 'Xác nhận'}
            </button>
        </div>
    );
};

export default DatPin;
