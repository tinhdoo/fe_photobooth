import { useEffect, useRef } from 'react';
import { useWorkflow } from '../../context/WorkflowContext';

// Màn "Chuẩn bị" chèn giữa Thanh toán và Chụp: vừa cho khách đọc thông điệp + tạo dáng,
// vừa PRE-WARM live view Canon (EVF) để khi vào bước Chụp là có hình ngay (không đen lượt đầu).
// Tự chuyển sang Chụp khi camera đã ra hình (tối thiểu MIN_MS để đọc), hoặc sau MAX_MS.
const GetReady = () => {
    const { goToStep, updateSessionData, configs } = useWorkflow();
    const isCanon = (configs?.camera_mode || 'canon') === 'canon';

    const MIN_MS = 3000; // hiển thị ~3s để khách kịp đọc + tạo dáng
    const MAX_MS = 6000; // trần: không chờ camera quá lâu

    const mountAtRef = useRef(0);
    const doneRef = useRef(false);
    const readyTimerRef = useRef(null);

    const advance = () => {
        if (doneRef.current) return;
        doneRef.current = true;
        goToStep(4); // vào bước Chụp
    };

    useEffect(() => {
        mountAtRef.current = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        // Reset cờ: chỉ bật lại khi live view thực sự ra hình (onLoad). Nếu tới đây do hết MAX_MS
        // mà camera chưa lên hình thì cờ = false -> Capture tự chờ frame (hiện overlay như cũ).
        updateSessionData('cameraWarm', false);

        const maxTimer = setTimeout(advance, MAX_MS);
        // Không phải canon (webcam/hotfolder): không có /liveview để dò -> chỉ chờ MIN rồi vào Chụp.
        const minTimer = isCanon ? null : setTimeout(advance, MIN_MS);
        return () => {
            clearTimeout(maxTimer);
            if (minTimer) clearTimeout(minTimer);
            if (readyTimerRef.current) clearTimeout(readyTimerRef.current);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Live view đã ra hình (EVF ấm) -> đánh dấu camera đã sẵn sàng để Capture vào thẳng, KHÔNG
    // hiện overlay "Đang khởi động camera". Vẫn giữ tối thiểu MIN_MS để khách kịp đọc.
    const onLiveReady = () => {
        updateSessionData('cameraWarm', true);
        if (doneRef.current || readyTimerRef.current) return;
        const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        const wait = Math.max(0, MIN_MS - (now - mountAtRef.current));
        readyTimerRef.current = setTimeout(advance, wait);
    };

    return (
        <div
            className="relative w-full h-full flex flex-col items-center justify-center gap-3 bg-[#FFF8E7] bg-cover bg-center p-8 font-serif text-center"
            style={{ backgroundImage: configs?.['bg_preview-when'] ? `url('${configs['bg_preview-when']}')` : 'none' }}
        >
            <h1 className="text-3xl md:text-5xl font-extrabold text-[#c1121f] leading-relaxed drop-shadow-sm">
                Chuẩn bị tạo dáng nha!
            </h1>
            <h1 className="text-3xl md:text-5xl font-extrabold text-[#c1121f] leading-relaxed drop-shadow-sm">
                Tomato sẽ bắt đầu chụp sau vài giây nữa!
            </h1>

            {/* Pre-warm live view Canon (ẩn): bật EVF cho ấm + dùng onLoad để biết camera đã ra
                hình -> vào Chụp là có hình ngay. Chỉ áp dụng canon mode. */}
            {isCanon && (
                <img
                    src="http://localhost:5001/liveview"
                    alt=""
                    aria-hidden="true"
                    style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none', left: 0, top: 0 }}
                    onLoad={onLiveReady}
                />
            )}
        </div>
    );
};

export default GetReady;
