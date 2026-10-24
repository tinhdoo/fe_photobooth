// ModeSelection.jsx — BƯỚC 1.5, trang chọn chế độ chụp.
// Đặt thành BƯỚC RIÊNG chứ không phải hộp thoại đè lên màn chờ: đây là ngã ba của cả phiên,
// khách cần nhìn rõ và bấm chắc tay trên màn cảm ứng.
//
//   "Photobooth" (ảnh chơi) -> đường cũ: 2 (chọn bố cục) -> 2.5 -> 3 -> ...
//   "Ảnh thẻ"  -> nhảy thẳng 2.5 (số lượng), bỏ qua chọn bố cục vì tờ ảnh thẻ đã cố định.

import { useWorkflow } from '../../context/WorkflowContext';
import { LAYOUTS } from '../../data/layouts';
import { Camera, IdCard, ArrowLeft } from 'lucide-react';
import { napTruocTachNen } from '../../idPhoto/tachNenBackend';

const ID_LAYOUT = LAYOUTS.find((l) => l.idPhoto);

const ModeSelection = () => {
    const { nextStep, prevStep, goToStep, updateSessionData, isEventMode, configs } = useWorkflow();

    const chonAnhChoi = () => {
        updateSessionData('captureMode', 'normal');
        nextStep(); // 1.5 -> 2
    };

    // Dùng goToStep chứ KHÔNG dùng nextStep: nextStep đọc captureMode từ closure của lần render
    // hiện tại, mà cờ vừa đặt ngay trên nên ở đó vẫn còn là giá trị cũ.
    const chonAnhThe = () => {
        updateSessionData('captureMode', 'id');
        // Backend nạp model tách nền ngay từ bây giờ (BiRefNet nạp mất vài giây, ~2 GB RAM khi chạy) -> tới
        // bước 8 khỏi chờ nạp. Khách bỏ ngang thì backend tự nhả model sau 10 phút rảnh.
        napTruocTachNen();
        if (ID_LAYOUT) updateSessionData('layout', ID_LAYOUT);
        // Chế độ sự kiện (miễn phí) không có Số lượng + Thanh toán -> vào thẳng màn Chuẩn bị như ảnh chơi.
        goToStep(isEventMode ? 3.5 : 2.5);
    };

    return (
        <div
            className="flex h-full w-full flex-col bg-[#FFF8E7] bg-cover bg-center px-6 py-8 md:px-12"
            style={{ backgroundImage: configs?.['bg_mode-selection'] ? `url('${configs['bg_mode-selection']}')` : 'none' }}
        >
            <button
                onClick={prevStep}
                className="mb-2 flex w-fit items-center gap-2 rounded-2xl border border-[#E7D3B7] bg-white px-4 py-2 text-sm font-bold text-[#7B5E43] active:scale-95"
            >
                <ArrowLeft size={18} /> Quay lại
            </button>

            <div className="flex flex-1 flex-col items-center justify-center">
                <h1 className="text-center text-4xl font-black text-[#3F3127] md:text-6xl">
                    Bạn muốn chụp gì?
                </h1>
                <p className="mt-3 text-center text-base font-bold text-[#7B5E43] md:text-xl">
                    Chạm vào một ô để bắt đầu
                </p>

                <div className="mt-10 grid w-full max-w-4xl gap-6 md:grid-cols-2">
                    <button
                        onClick={chonAnhChoi}
                        className="flex flex-col items-center gap-4 rounded-[2rem] border-4 border-[#E7D3B7] bg-white p-8 text-center shadow-sm transition-transform active:scale-95 md:p-10"
                    >
                        <div className="flex h-24 w-24 items-center justify-center rounded-3xl bg-[#8E6B4D] text-white md:h-28 md:w-28">
                            <Camera size={52} />
                        </div>
                        <span className="text-3xl font-black text-[#3F3127] md:text-4xl">Photobooth</span>
                        <span className="text-base font-semibold leading-relaxed text-[#7B5E43]">
                            Nhiều bố cục, khung viền,<br />sticker và bộ lọc làm đẹp
                        </span>
                    </button>

                    <button
                        onClick={chonAnhThe}
                        className="flex flex-col items-center gap-4 rounded-[2rem] border-4 border-[#e63946] bg-white p-8 text-center shadow-sm transition-transform active:scale-95 md:p-10"
                    >
                        <div className="flex h-24 w-24 items-center justify-center rounded-3xl bg-[#e63946] text-white md:h-28 md:w-28">
                            <IdCard size={52} />
                        </div>
                        <span className="text-3xl font-black text-[#3F3127] md:text-4xl">Ảnh thẻ</span>
                        <span className="text-base font-semibold leading-relaxed text-[#7B5E43]">
                            Nền trắng hoặc xanh,<br />tự động cắt đúng khuôn
                        </span>
                    </button>
                </div>

                {/* Ghi rõ phạm vi để khỏi bị bắt đền. Ba loại giấy tờ nhà nước đều yêu cầu nền TRẮNG
                    và cấm chỉnh sửa: hộ chiếu, GPLX (nền trắng từ 1/7/2026), còn ảnh CCCD thì công an
                    chụp tại chỗ. Ảnh có ghép nền/vest chỉ dùng cho hồ sơ thường. */}
                <p className="mt-10 max-w-2xl rounded-3xl bg-amber-50 px-6 py-4 text-center text-sm font-semibold leading-relaxed text-amber-800 md:text-base">
                    Ảnh thẻ ở đây dùng cho hồ sơ xin việc, thẻ sinh viên, CV…
                    <br />
                    Không dùng để làm hộ chiếu, CCCD hay giấy phép lái xe.
                </p>
            </div>
        </div>
    );
};

export default ModeSelection;
