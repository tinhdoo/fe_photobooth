import { useRef, useState } from 'react';
import { Lock, X } from 'lucide-react';
import { useWorkflow } from '../../context/WorkflowContext';
import ManagementPanel from './ManagementPanel';

// Cổng thoát cho NHÂN VIÊN khả dụng ở MỌI bước (kể cả lúc đang Chụp/Review/Edit) — dùng khi
// phiên bị kẹt/lỗi giữa chừng. Gắn ở MainLayout nên phủ toàn bộ luồng booth.
// Cách mở: NHẤN GIỮ 3 giây ở GÓC PHẢI PHÍA TRÊN màn hình -> nhập PIN -> mở "Quản lý máy"
// (có nút Về màn chủ / Thoát kiosk). Vùng hotspot trong suốt, khách không thấy & không bấm nhầm.
const StaffEscape = () => {
    const { configs } = useWorkflow();
    const staffPin = String(configs?.staff_pin || '8888');

    const [showPinCard, setShowPinCard] = useState(false);
    const [showPanel, setShowPanel] = useState(false);
    const [pinInput, setPinInput] = useState('');
    const [pinError, setPinError] = useState('');
    const longPressTimer = useRef(null);

    const clearLongPress = () => {
        if (longPressTimer.current) {
            window.clearTimeout(longPressTimer.current);
            longPressTimer.current = null;
        }
    };

    const startLongPress = (e) => {
        if (e && e.preventDefault && e.type !== 'pointerdown') e.preventDefault();
        clearLongPress();
        longPressTimer.current = window.setTimeout(() => {
            setPinInput('');
            setPinError('');
            setShowPinCard(true);
        }, 3000); // giữ 3s mới mở -> tránh chạm nhầm
    };

    const closePinCard = () => {
        setShowPinCard(false);
        setPinInput('');
        setPinError('');
    };

    const submitPin = (value = pinInput) => {
        if (String(value) === staffPin) {
            closePinCard();
            setShowPanel(true);
            return;
        }
        setPinError('PIN không đúng.');
        setPinInput('');
    };

    const appendPin = (digit) => {
        setPinError('');
        const nextPin = `${pinInput}${digit}`.slice(0, 8);
        setPinInput(nextPin);
        if (nextPin.length >= staffPin.length) {
            window.setTimeout(() => submitPin(nextPin), 80);
        }
    };

    return (
        <>
            {/* Hotspot trong suốt góc phải trên. z cao hơn đồng hồ phiên (z-50) để bắt được chạm
                kể cả khi đè lên đồng hồ; thấp hơn các panel (z-100+). */}
            <div
                className="fixed top-0 right-0 z-[60] h-20 w-20"
                style={{ touchAction: 'none' }}
                onPointerDown={startLongPress}
                onPointerUp={clearLongPress}
                onPointerCancel={clearLongPress}
                onPointerLeave={clearLongPress}
                onContextMenu={(e) => e.preventDefault()}
                aria-hidden="true"
            />

            {showPanel && <ManagementPanel onClose={() => setShowPanel(false)} />}

            {showPinCard && (
                <div
                    className="fixed inset-0 z-[110] flex items-center justify-center bg-black/45 p-6 font-sans"
                    onClick={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                    onPointerUp={(event) => event.stopPropagation()}
                >
                    <div className="w-full max-w-sm rounded-3xl border border-[#E7D3B7] bg-white p-6 shadow-2xl">
                        <div className="mb-5 flex items-start justify-between gap-4">
                            <div className="flex items-center gap-3">
                                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#FFF8E7] text-[#8E6B4D]">
                                    <Lock size={24} />
                                </div>
                                <div>
                                    <h2 className="text-2xl font-black text-[#3F3127]">Nhân viên</h2>
                                    <p className="text-sm font-bold text-[#7B5E43]">Nhập PIN để mở Quản lý máy</p>
                                </div>
                            </div>
                            <button
                                onClick={closePinCard}
                                className="rounded-full bg-[#8E6B4D] p-2 text-white"
                                aria-label="Đóng"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        <div className="mb-3 flex h-14 items-center justify-center rounded-2xl border border-[#E7D3B7] bg-[#FFF8E7] text-3xl font-black tracking-[0.35em] text-[#3F3127]">
                            {pinInput ? '•'.repeat(pinInput.length) : <span className="text-base tracking-normal text-[#C8A47A]">PIN</span>}
                        </div>
                        {pinError && (
                            <div className="mb-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-2 text-center text-sm font-bold text-red-600">
                                {pinError}
                            </div>
                        )}

                        <div className="grid grid-cols-3 gap-3">
                            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
                                <button
                                    key={digit}
                                    onClick={() => appendPin(digit)}
                                    className="h-14 rounded-2xl bg-[#FFF8E7] text-2xl font-black text-[#7B5E43] active:scale-95"
                                >
                                    {digit}
                                </button>
                            ))}
                            <button
                                onClick={() => {
                                    setPinError('');
                                    setPinInput('');
                                }}
                                className="h-14 rounded-2xl bg-[#F3E4CF] text-sm font-black text-[#7B5E43] active:scale-95"
                            >
                                Xóa
                            </button>
                            <button
                                onClick={() => appendPin('0')}
                                className="h-14 rounded-2xl bg-[#FFF8E7] text-2xl font-black text-[#7B5E43] active:scale-95"
                            >
                                0
                            </button>
                            <button
                                onClick={() => submitPin()}
                                className="h-14 rounded-2xl bg-[#8E6B4D] text-sm font-black text-white active:scale-95"
                            >
                                Mở
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

export default StaffEscape;
