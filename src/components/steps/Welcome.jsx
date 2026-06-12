import { useRef, useState } from 'react';
import { useWorkflow } from '../../context/WorkflowContext';
import StaffPanel from '../staff/StaffPanel';

const isVideoUrl = (url = '') => /\.(mp4|webm|mov)(\?|$)/i.test(url);

const Welcome = () => {
    const { nextStep, configs } = useWorkflow();
    const backgroundUrl = configs?.bg_welcome || '/1.png';
    const [showStaffPanel, setShowStaffPanel] = useState(false);
    const longPressTimer = useRef(null);
    const longPressTriggered = useRef(false);
    const staffPin = String(configs?.staff_pin || '2606');

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
            const pin = window.prompt('Nhập PIN nhân viên');
            if (pin === staffPin) {
                setShowStaffPanel(true);
            } else if (pin !== null) {
                window.alert('PIN không đúng.');
            }
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
        </div>
    );
};

export default Welcome;
