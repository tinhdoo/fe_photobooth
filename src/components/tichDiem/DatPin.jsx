// Đặt PIN 4 số lần đầu (nhập 2 lần). Dùng ở màn Kết quả và Thanh toán.
import { useState } from 'react';
import BanPhim, { OSo } from './BanPhim';

const DatPin = ({ sdtAn, mau, dangGui, onXong }) => {
    const [pin, setPin] = useState('');
    const [pin2, setPin2] = useState('');
    const [buoc, setBuoc] = useState(1);
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
            <button
                type="button"
                disabled={!xong || dangGui}
                onClick={() => onXong(pin)}
                className="rounded-full bg-[#A61018] px-12 py-4 text-xl font-black text-white shadow-lg active:scale-95 disabled:opacity-40"
            >
                {dangGui ? 'Đang lưu...' : 'Xác nhận'}
            </button>
        </div>
    );
};

export default DatPin;
