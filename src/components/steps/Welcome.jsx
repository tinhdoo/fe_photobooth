import { useRef, useState } from 'react';
import { useWorkflow } from '../../context/WorkflowContext';
import StaffPanel from '../staff/StaffPanel';
import { Lock, X } from 'lucide-react';

const isVideoUrl = (url = '') => /\.(mp4|webm|mov)(\?|$)/i.test(url);

const Welcome = () => {
    const { nextStep, configs } = useWorkflow();
    const backgroundUrl = configs?.bg_welcome || '/1.png';
    const [showStaffPanel, setShowStaffPanel] = useState(false);
    const [showPinCard, setShowPinCard] = useState(false);
    const [pinInput, setPinInput] = useState('');
    const [pinError, setPinError] = useState('');
    const longPressTimer = useRef(null);
    const longPressTriggered = useRef(false);
    const staffPin = String(configs?.staff_pin || '1310');

    const clearLongPress = () => {
        if (longPressTimer.current) {
            window.clearTimeout(longPressTimer.current);
            longPressTimer.current = null;
        }
    };

    const startLongPress = () => {
        longPressTriggered.current = false;
        clearLongPress();
        longPressTimer.current = window.setTimeout(() => {
            longPressTriggered.current = true;
            setPinInput('');
            setPinError('');
            setShowPinCard(true);
        }, 5000);
    };

    const handleRelease = () => {
        clearLongPress();
    };

    const handleClick = () => {
        if (longPressTriggered.current) {
            longPressTriggered.current = false;
            return;
        }
        nextStep();
    };

    const closePinCard = () => {
        setShowPinCard(false);
        setPinInput('');
        setPinError('');
    };

    const submitPin = (value = pinInput) => {
        if (String(value) === staffPin) {
            closePinCard();
            setShowStaffPanel(true);
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
        <div
            className="relative flex h-full w-full cursor-pointer flex-col items-center justify-center overflow-hidden bg-[#FFF8E7]"
            onPointerDown={startLongPress}
            onPointerUp={handleRelease}
            onPointerCancel={handleRelease}
            onPointerLeave={handleRelease}
            onClick={handleClick}
        >
            {isVideoUrl(backgroundUrl) ? (
                <video
                    src={backgroundUrl}
                    className="absolute inset-0 z-0 h-full w-full object-cover"
                    autoPlay
                    muted
                    loop
                    playsInline
                    preload="auto"
                />
            ) : (
                <div
                    className="absolute inset-0 z-0 bg-cover bg-center"
                    style={{ backgroundImage: `url('${backgroundUrl}')` }}
                />
            )}

            {showStaffPanel && (
                <StaffPanel onClose={() => setShowStaffPanel(false)} />
            )}

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
                                    <p className="text-sm font-bold text-[#7B5E43]">Nhập PIN để mở Staff Panel</p>
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
        </div>
    );
};

export default Welcome;
