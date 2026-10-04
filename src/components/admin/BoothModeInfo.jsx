import { DollarSign, Zap } from 'lucide-react';
import { getDeviceId } from '../../utils/deviceId';

// Chế độ tính tiền (Trả phí <-> Sự kiện) KHÔNG đổi được trên booth nữa (2026-10-04): booth gửi lệnh đổi
// lên cloud không có đăng nhập, nên cloud đã khoá lệnh đó (trước đây ai biết mã booth cũng bật được
// Sự kiện = chụp miễn phí). Nhịp tim mỗi phút luôn kéo booth về chế độ đặt trên cloud -> chỉ đổi ở
// trang Cài đặt trên cloud (admin đăng nhập). Modal này chỉ báo chế độ hiện tại + chỉ đường.
const BoothModeInfo = ({ isEventMode, onClose }) => (
    <div
        className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-6 font-sans"
        onClick={onClose}
    >
        <div
            className="w-full max-w-md rounded-3xl border border-[#E7D3B7] bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
        >
            <div className="mb-4 flex items-center gap-3">
                <div className={`flex h-12 w-12 items-center justify-center rounded-2xl ${isEventMode ? 'bg-red-50 text-[#e63946]' : 'bg-emerald-50 text-emerald-600'}`}>
                    {isEventMode ? <Zap size={24} /> : <DollarSign size={24} />}
                </div>
                <div>
                    <h2 className="text-xl font-black text-[#3F3127]">Chế độ tính tiền</h2>
                    <p className="text-sm font-bold text-[#7B5E43]">
                        Đang ở: {isEventMode ? 'Sự kiện (miễn phí)' : 'Trả phí'}
                    </p>
                </div>
            </div>
            <div className="space-y-2 rounded-2xl bg-[#FFF8E7] p-4 text-sm font-semibold text-[#5E4B3C]">
                <p>Chế độ chỉ đổi được trên trang quản trị cloud:</p>
                <p className="font-black text-[#3F3127]">tomatophotobooth.vercel.app/admin → đăng nhập admin → Cài đặt</p>
                <p>Bấm chế độ của booth này trong danh sách. Booth tự nhận trong vòng 1 phút.</p>
                <p className="pt-1 text-xs text-[#8a7d6d]">Mã máy này: <span className="font-mono font-bold">{getDeviceId()}</span></p>
            </div>
            <button
                type="button"
                onClick={onClose}
                className="mt-5 h-12 w-full rounded-2xl bg-[#8E6B4D] text-sm font-black text-white active:scale-95"
            >
                Đã hiểu
            </button>
        </div>
    </div>
);

export default BoothModeInfo;
