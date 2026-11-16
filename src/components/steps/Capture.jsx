import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useWorkflow } from '../../context/WorkflowContext';
import { CameraService } from '../../services/CameraService';
import { Camera } from 'lucide-react';
import { FirebaseService } from '../../services/FirebaseService';
import { demSuKien, ghiLoi, ghiThoiGian } from '../../utils/doMuot';
import { latGuongAnhKemXem } from '../../utils/latAnh';
import { NhanRemote } from '../remote/BoothRemote';
import { guiRemote, ngheRemote, useKetNoiRemote } from '../../remote/remoteBooth';

// BẤM CHỤP BẰNG ĐIỆN THOẠI (src/remote/): điện thoại đã nối thì mỗi ảnh CHỜ khách bấm (điện thoại hoặc chạm màn
// hình) và chụp NGAY khi bấm, không đếm ngược. Chờ quá CHO_BAM_MAX_S (hoặc giờ chặng không còn đủ cho số ảnh còn
// lại) thì tự đếm ngược như thường; mất kết nối điện thoại thì tự chụp sau CHO_KHI_MAT_S.
const CHO_BAM_MAX_S = 15;
const CHO_KHI_MAT_S = 5;
const QUAY_LAI_SAU_MS = 6000; // motion: đang chờ bấm lâu thì quay lại từ đầu (clip ≤ 6 s; bấm ngay sau lúc quay lại thì clip ngắn — chấp nhận, đỡ tốn CPU hơn 2 bộ quay)
// Màn Chụp chỉ hiện bản nhỏ của ảnh vừa chụp (ảnh Canon 24 MP hiện thẳng làm khựng 200-400 ms mỗi tấm, 9 ô dưới
// mỗi ô giải mã nguyên 24 MP). Ảnh gốc cỡ đầy đủ vẫn đi tiếp xuống Chọn ảnh / in / album.
const CANH_XEM = 1920;
const CANH_O = 320;
const CHO_HINH_MOI_MS = 4000;  // chờ live view chạy lại sau lần chụp trước, quá thì vẫn mở nút
const THU_LAI_BAN_LAN = 3;     // máy báo bận thì thử lại tối đa 3 lần...
const THU_LAI_BAN_MS = 800;    // ...cách nhau 0,8 s (mỗi lần middleware còn tốn thêm ~0,7 s)

// Cờ cấp module: camera đã sẵn sàng ít nhất 1 lần trong phiên chạy app. Dùng để KHÔNG hiện
// lại overlay "Đang khởi động camera" mỗi lần chụp lại (Capture remount nhưng live view vẫn chạy).
let _cameraReadyOnce = false;

// Giải phóng blob URL (ảnh + video) của tấm cũ khi chụp lại thay thế, để tránh rò rỉ
// bộ nhớ trong phiên. Chỉ revoke khi URL không còn được dùng ở mảng ảnh mới.
const releaseReplacedPhoto = (oldPhoto, newPhotos) => {
    if (!oldPhoto) return;
    const urlOf = (p) => (p && typeof p === 'object' ? p.url : p);
    const vidOf = (p) => (p && typeof p === 'object' ? p.videoUrl : null);
    const stillUsed = (u) => newPhotos.some((p) => urlOf(p) === u || vidOf(p) === u);
    [urlOf(oldPhoto), vidOf(oldPhoto)].forEach((u) => {
        if (typeof u === 'string' && u.startsWith('blob:') && !stillUsed(u)) {
            try { URL.revokeObjectURL(u); } catch { /* ignore */ }
        }
    });
};

const Capture = () => {
    const { nextStep, sessionData, updateSessionData, timeLeft, isSessionActive, timedOut, configs } = useWorkflow();
    const primaryTextColor = configs?.brand_text_primary || '#7B5E43';
    const [countdown, setCountdown] = useState(null);
    // Initialize with existing photos if any (for retake feature)
    const [photosTaken, setPhotosTaken] = useState(sessionData.photos || []);
    const [isShooting, setIsShooting] = useState(false);
    const [flash, setFlash] = useState(false);
    const [latestPhoto, setLatestPhoto] = useState(null);
    const xemRef = useRef(new Map()); // url ảnh gốc -> { xem, o }: bản nhỏ chỉ dùng trên màn Chụp, rời màn là thu hồi
    const isRetakeMode = sessionData.retakeIndex !== undefined && sessionData.retakeIndex !== null;

    // Chụp lại chỉ làm từ bước Review (sessionData.retakeIndex). Bản cũ có sẵn xử lý "chạm ô ảnh nhỏ để chụp lại
    // giữa chuỗi" nhưng chưa từng có chỗ chạm nào kích hoạt -> đã gỡ (23/10): chạm nhầm lúc đang tạo dáng sẽ đè
    // một tấm cũ, còn Review có đủ thời gian xem rồi mới chọn.

    // Webcam refs and state
    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const [stream, setStream] = useState(null);
    // Khởi tạo sẵn sàng từ cờ cameraWarm (do màn "Chuẩn bị"/GetReady đặt khi live view đã ra
    // hình) -> vào Chụp KHÔNG chớp overlay "Đang khởi động camera" ngay từ khung hình đầu.
    const [cameraReady, setCameraReady] = useState(!!sessionData.cameraWarm);
    const [cameraError, setCameraError] = useState(null);
    // Booth dùng máy ảnh Canon (không có webcam). Mặc định 'canon' để khi configs CHƯA load
    // kịp KHÔNG rơi vào webcam -> getUserMedia 'Requested device not found' trên máy không webcam.
    const cameraMode = configs?.camera_mode || 'canon';

    // Motion Photo Refs
    const videoChunksRef = useRef([]);
    const mediaRecorderRef = useRef(null);
    const shutterAudioRef = useRef(null);
    // Cờ chống TÁI NHẬP takePhoto: countdown effect phụ thuộc configs.countdown, nên nếu cấu hình
    // countdown bị đổi (admin sửa + realtime/refetch) ĐÚNG lúc countdown===0 đang chờ /capture,
    // effect chạy lại -> takePhoto() bắn LẦN 2 song song -> 2 lệnh Canon /capture tranh chấp thread
    // EDSDK -> treo + ảnh nhân đôi. Guard này chỉ mở lại ở startCountdown (mỗi lượt chụp hợp lệ).
    const shootingRef = useRef(false);
    // Cờ: đã vẽ được ít nhất 1 frame live view THẬT vào canvas chưa (để bỏ video rỗng ảnh đầu).
    const canonHasFramesRef = useRef(false);
    const canonDrawTimerRef = useRef(null);
    const canonStreamRef = useRef(null);
    // Ref ảnh live view HIỂN THỊ -> để NGẮT kết nối MJPEG khi rời bước chụp.
    const liveViewVisibleRef = useRef(null);
    // Đếm số frame poll lỗi liên tiếp -> chỉ báo lỗi kết nối khi thực sự hỏng (tránh báo nhầm
    // do 1-2 frame 503 lúc mới khởi động).
    const liveFrameFailRef = useRef(0);
    // --- WATCHDOG LIVE VIEW (chống đen màn) ---
    // Vấn đề: cameraReady bật sẵn từ cameraWarm -> ẩn overlay + tự đếm ngược NGAY, nhưng nếu /ws
    // KHÔNG đẩy frame (EVF phía middleware kẹt lúc chuyển Chuẩn bị->Chụp) thì màn ĐEN CÂM, không
    // báo lỗi, không tự phục hồi (nhánh /ws không có onError khi frame ngừng đến). Watchdog theo dõi
    // thời điểm frame cuối; quá lâu không có hình -> hiện "Đang kết nối lại" + ép /start-liveview và
    // dựng lại /ws. Đồng thời CHẶN đếm ngược tới khi có >=1 frame thật -> không bắn /capture vào máy treo.
    const lastFrameAtRef = useRef(Date.now());   // lần cuối nhận được frame live view (onLoad)
    const soKhungRef = useRef(0);                // đếm frame thật (lastFrameAtRef bị watchdog chỉnh lúc đang chụp)
    const hasLiveFrameRef = useRef(false);       // đã có >=1 frame thật? (gate hot-path setState)
    const stalledRef = useRef(false);            // đang đứng hình?
    const lastRecoveryAtRef = useRef(0);         // lần cuối chạy phục hồi (đừng nhồi liên tục)
    const [hasLiveFrame, setHasLiveFrame] = useState(false); // để re-render mở đếm ngược khi có hình
    const [liveStalled, setLiveStalled] = useState(false);   // để hiện overlay "Đang kết nối lại"
    // Đứng hình QUÁ LÂU (máy ảnh không tự hồi) -> overlay đổi sang hướng dẫn nhân viên. Sự cố 2026-10-04:
    // kiosk quay vòng "Đang kết nối lại máy ảnh" mãi, không ai biết phải tắt/bật máy ảnh.
    const stallFromRef = useRef(0);
    const daBaoStallRef = useRef(0);
    const [stallLau, setStallLau] = useState(false);
    const [wsReconnectToken, setWsReconnectToken] = useState(0); // bump -> effect /ws chạy lại (reconnect)
    // Ghi nhận 1 frame live view vừa tới (gọi ở onLoad của <img> live view). Dùng ref chặn setState
    // thừa vì onLoad bắn ~30 lần/s.
    const markLiveFrame = () => {
        lastFrameAtRef.current = Date.now();
        soKhungRef.current += 1;
        if (!hasLiveFrameRef.current) { hasLiveFrameRef.current = true; setHasLiveFrame(true); }
        if (stalledRef.current) {
            stalledRef.current = false; setLiveStalled(false); setStallLau(false);
            ghiThoiGian('mat_hinh', Date.now() - stallFromRef.current); // đứng hình bao lâu thì tự hồi
        }
    };
    // Còn mounted không -> chặn các setTimeout sau khi chụp (advance/countdown) chạy MUỘN sau khi
    // đã rời bước (vd hết giờ -> nextStep tự động unmount Capture) -> tránh nextStep() thừa gây
    // NHẢY/BỎ bước (Review bị skip). Đặt false ở cleanup unmount bên dưới.
    const mountedRef = useRef(true);
    // Các timer hẹn giờ chuyển ô kế / sang bước sau khi chụp xong. Lưu lại để HUỶ được khi khách
    // chạm chụp lại giữa chừng (nếu không, ô kế vẫn tự bắt đầu chồng lên lượt chụp lại).
    const advanceTimersRef = useRef([]);

    // Chờ khách bấm (điện thoại đã nối) — xem CHO_BAM_MAX_S.
    const ketNoiRemote = useKetNoiRemote();       // 'chua' | 'on' | 'lost'
    const [choBam, setChoBam] = useState(false);
    const [tuChupSau, setTuChupSau] = useState(null);
    const choBamRef = useRef(false);
    const hanChoRef = useRef(0);                  // mốc (ms) tự chụp nếu chưa bấm
    const nhipChoRef = useRef(null);
    const batDauQuayRef = useRef(0);
    const quayLaiRef = useRef(null);              // promise đang quay lại motion (chờ xong mới dừng hẳn)
    const timeLeftRef = useRef(timeLeft);
    timeLeftRef.current = timeLeft;

    useEffect(() => {
        shutterAudioRef.current = new Audio('/shutter.mp3');
        shutterAudioRef.current.preload = 'auto';
    }, []);

    // Dọn khi UNMOUNT (rời bước chụp do retake/next): dừng timer+recorder và NGẮT 2 kết nối
    // MJPEG live view (set src=''). <img> MJPEG là kết nối sống dai; không ngắt -> tích tụ tới
    // giới hạn ~6 kết nối/host của trình duyệt -> đơ/màn trắng sau nhiều lần retake.
    useEffect(() => {
        // BẬT LẠI cờ ở SETUP, không chỉ tắt ở cleanup. React StrictMode (chỉ có ở dev) chạy
        // setup -> cleanup -> setup trên CÙNG một component, mà useRef giữ nguyên giá trị qua
        // vòng giả lập đó. Thiếu dòng này thì cleanup đặt false rồi không ai bật lại -> cờ kẹt
        // false suốt phiên -> timer trong scheduleAdvance() luôn thoát sớm -> chụp xong tấm đầu
        // là đứng im, không đếm ngược tấm kế. Build production không double-invoke nên máy ngoài
        // quầy không dính, chỉ dính khi chạy npm run dev.
        mountedRef.current = true;
        return () => {
            mountedRef.current = false; // chặn các advance/countdown hẹn giờ chạy sau khi rời bước
            xemRef.current.forEach((v) => { try { URL.revokeObjectURL(v.xem); if (v.o) URL.revokeObjectURL(v.o); } catch { /* bỏ qua */ } });
            xemRef.current.clear();
            // Gán 1 ảnh GIF 1x1 (data URI) buộc trình duyệt HỦY ngay luồng MJPEG đang stream.
            // Set src='' với MJPEG nhiều khi không ngắt kết nối -> tích tụ tới trần ~6/host -> đơ.
            const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
            if (nhipChoRef.current) clearInterval(nhipChoRef.current);
            // Huỷ các timer chuyển ô/sang bước còn treo -> tránh startCountdown/nextStep chạy sau khi rời bước.
            try { advanceTimersRef.current.forEach((t) => clearTimeout(t)); advanceTimersRef.current = []; } catch (e) { /* ignore */ }
            try { stopCanonDraw(); } catch (e) { /* ignore */ }
            try {
                const r = mediaRecorderRef.current;
                if (r && r.state !== 'inactive') r.stop();
            } catch (e) { /* ignore */ }
            try { if (liveViewVisibleRef.current) liveViewVisibleRef.current.src = BLANK; } catch (e) { /* ignore */ }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const pickVideoMime = () => {
        const mimeTypes = ['video/webm;codecs=vp9', 'video/webm', 'video/mp4'];
        for (const type of mimeTypes) {
            if (MediaRecorder.isTypeSupported(type)) return { mimeType: type };
        }
        return {};
    };

    // Quay motion cho Canon: liên tục vẽ frame liveview (MJPEG <img>) lên canvas ẩn,
    // rồi dùng canvas.captureStream() làm nguồn cho MediaRecorder (giống luồng webcam).
    const startCanonRecording = () => {
        try {
            // Dùng chính ảnh live view đang HIỂN THỊ (crossOrigin) làm nguồn quay -> motion luôn
            // khớp khung đang xem, và không cần kết nối MJPEG thứ hai.
            const img = liveViewVisibleRef.current;
            if (!img) return;
            videoChunksRef.current = [];
            canonHasFramesRef.current = false;

            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth || 960;
            canvas.height = img.naturalHeight || 640;
            const ctx = canvas.getContext('2d');

            const drawFrame = () => {
                // Vẽ frame ĐANG HIỂN THỊ (luôn là frame đã decode) mỗi nhịp -> motion đều hơn.
                // Bỏ check !img.complete vì với WebSocket img liên tục nạp blob mới; chỉ cần đã có
                // ít nhất 1 frame (naturalWidth > 0) để tránh quay khung trống lúc đầu.
                if (!img.naturalWidth) return;
                try {
                    // Quay RAW (KHÔNG lật). Việc lật gương để khớp ảnh chụp được làm thống nhất ở
                    // khâu hiển thị (CSS scaleX(-1)) và khâu xuất video -> tránh lật 2 lần (ảnh ngược).
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                    canonHasFramesRef.current = true;
                } catch (e) { /* frame chưa sẵn sàng */ }
            };
            drawFrame();
            canonDrawTimerRef.current = setInterval(drawFrame, 1000 / 24);

            const captureStream = canvas.captureStream(24);
            canonStreamRef.current = captureStream;

            const recorder = new MediaRecorder(captureStream, {
                ...pickVideoMime(),
                videoBitsPerSecond: 2500000,
            });
            recorder.ondataavailable = (event) => {
                if (event.data && event.data.size > 0) videoChunksRef.current.push(event.data);
            };
            recorder.start();
            mediaRecorderRef.current = recorder;
            console.log("🎥 [Motion] Canon recording started");
        } catch (e) {
            console.error("Failed to start Canon recording", e);
        }
    };

    const startRecording = () => {
        // Ảnh thẻ KHÔNG quay motion: ảnh hồ sơ chỉ cần tấm tĩnh, quay thêm chỉ tốn CPU và bộ nhớ
        // giữa 4 lần bấm máy. stopRecording() tự trả null khi không có recorder nên không cần
        // chặn thêm ở chỗ dừng.
        if (layout?.idPhoto) return;
        if (cameraMode === 'canon') { startCanonRecording(); return; }
        if (cameraMode !== 'webcam' || !stream) return;
        try {
            console.log("🎥 [Motion] Starting recording...");
            videoChunksRef.current = [];

            // Check for supported mime types
            const mimeTypes = [
                'video/webm;codecs=vp9',
                'video/webm',
                'video/mp4'
            ];

            let options = {};
            for (const type of mimeTypes) {
                if (MediaRecorder.isTypeSupported(type)) {
                    options = { mimeType: type };
                    break;
                }
            }

            const recorder = new MediaRecorder(stream, {
                ...options,
                videoBitsPerSecond: 2500000,
            });

            recorder.ondataavailable = (event) => {
                if (event.data && event.data.size > 0) {
                    videoChunksRef.current.push(event.data);
                }
            };

            recorder.start();
            mediaRecorderRef.current = recorder;
        } catch (e) {
            console.error("Failed to start recording", e);
        }
    };

    const stopCanonDraw = () => {
        if (canonDrawTimerRef.current) {
            clearInterval(canonDrawTimerRef.current);
            canonDrawTimerRef.current = null;
        }
        if (canonStreamRef.current) {
            canonStreamRef.current.getTracks().forEach(t => t.stop());
            canonStreamRef.current = null;
        }
    };

    const stopRecording = () => {
        return new Promise((resolve) => {
            const recorder = mediaRecorderRef.current;
            if (!recorder || recorder.state === 'inactive') {
                stopCanonDraw();
                resolve(null);
                return;
            }

            recorder.onstop = () => {
                const blob = new Blob(videoChunksRef.current, { type: 'video/webm' }); // Force webm container
                stopCanonDraw();
                // Bỏ video nếu blob rỗng, HOẶC (canon) chưa từng vẽ được frame thật (live view
                // chưa ra hình - thường là ảnh đầu) -> album fallback sang ảnh tĩnh, không ô trống.
                if (!blob.size || (cameraMode === 'canon' && !canonHasFramesRef.current)) { resolve(null); return; }
                const url = URL.createObjectURL(blob);
                resolve(url);
            };

            recorder.stop();
        });
    };

    // Dynamic Photo Count based on Layout
    const layout = sessionData.layout;
    // captureCount TÁCH RIÊNG số LẦN BẤM MÁY khỏi số Ô ẢNH trên tờ in. Ảnh chơi thì hai con số
    // này bằng nhau nên photoCount là đủ. Ảnh thẻ thì khác hẳn: chụp 4 tấm cho khách chọn,
    // nhưng chỉ MỘT tấm được chọn rồi nhân ra 9 ô trên tờ (photoCount: 1).
    const TOTAL_PHOTOS = layout ? (layout.captureCount || layout.photoCount) : 4; // Default to 4

    // Initialize webcam

    // Auto-complete if timeout during capture. Dùng cờ timedOut (bền vững) thay vì
    // isSessionActive (tắt ngay khi hết giờ -> đứt chuỗi auto sang Review/Edit).
    useEffect(() => {
        if (timedOut) {
            console.log("Session Timeout in Capture Step - Force Proceed...");
            // Stop any ongoing countdown/capture
            thoatChoBam();
            setIsShooting(false);
            setCountdown(null);

            // If we have at least one photo, we proceed to Review/Edit
            // If NO photos, we might have to reset? Or just proceed (Review will fail or be empty).
            // Let's proceed. Review step handles empty slots.
            // But if 0 photos, Review step might be weird.
            // User wants "auto choose ... in luon". Use what we have.

            // We can't easily wait for "current" capture if it's mid-process.
            // Just go next.
            nextStep();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [timedOut]);

    useEffect(() => {
        let currentStream = null;
        setCameraReady(false);
        setCameraError(null);
        setStream(null);

        if (cameraMode === 'hotfolder') {
            setCameraReady(true); // hotfolder: không có live view -> sẵn sàng ngay
            return;
        }

        if (cameraMode === 'canon') {
            // Vừa qua màn "Chuẩn bị" (GetReady) đã xác nhận camera RA HÌNH (cameraWarm) -> vào là
            // sẵn sàng NGAY, KHÔNG hiện overlay "Đang khởi động camera" (live view đang chạy nên
            // có hình liền). Vì MỌI đường vào Chụp đều qua GetReady nên cờ này luôn chuẩn.
            if (sessionData.cameraWarm) {
                setCameraReady(true);
                return;
            }
            // Trường hợp hiếm (camera chưa kịp ấm ở GetReady): CHỜ frame thật (onLoad) mới cho đếm
            // ngược, tránh đen. Fallback 8s để không kẹt nếu camera thật sự không lên hình.
            const fb = setTimeout(() => { setCameraReady(true); }, 8000);
            return () => clearTimeout(fb);
        }

        const initCamera = async () => {
            try {
                const mediaStream = await navigator.mediaDevices.getUserMedia({
                    video: {
                        width: { ideal: 1280 },
                        height: { ideal: 720 },
                        frameRate: { ideal: 30, max: 30 },
                        facingMode: 'user',
                    },
                    audio: false
                });

                currentStream = mediaStream;

                if (videoRef.current) {
                    videoRef.current.srcObject = mediaStream;
                    setStream(mediaStream);
                    setCameraReady(true);
                } else {
                    setCameraError('Video element not ready');
                }
            } catch (error) {
                console.error('Webcam init failed:', error);
                setCameraError(error.message);
            }
        };

        const timer = setTimeout(() => {
            initCamera();
        }, 50);

        return () => {
            clearTimeout(timer);
            if (currentStream) {
                currentStream.getTracks().forEach(track => track.stop());
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cameraMode]);

    // Canon liveview: ƯU TIÊN WebSocket (/ws) -> server đẩy frame liên tục qua 1 kết nối, mượt
    // như stream nhưng không tích tụ kết nối. Nếu /ws không có (middleware cũ) -> FALLBACK poll /frame.
    useEffect(() => {
        if (cameraMode !== 'canon') return undefined;
        let alive = true;
        let ws = null;
        let lastUrl = null;
        let reconnectTimer = null;
        let pollTimer = null;
        let wsFails = 0;
        let mode = 'ws'; // 'ws' | 'poll'
        liveFrameFailRef.current = 0;

        // --- Fallback: poll /frame nối tiếp ---
        const pollNext = () => {
            if (!alive) return;
            const el = liveViewVisibleRef.current;
            if (el) el.src = `http://localhost:5001/frame?t=${Date.now()}`;
        };
        let pollFails = 0;
        const scheduleNextPoll = (delay) => { if (alive && mode === 'poll') pollTimer = window.setTimeout(pollNext, delay); };
        // Có frame -> poll ~30fps. LỖI (mất cam / cổng 5001 chết) -> GIÃN dần tới 1s: KHÔNG hammer
        // /frame ~50 lần/s gây giật + spam khi không có camera. Có frame trở lại -> xóa báo lỗi.
        const onPollLoad = () => { if (pollFails > 0) setCameraError(null); pollFails = 0; scheduleNextPoll(33); };
        const onPollError = () => {
            pollFails += 1;
            if (pollFails === 12) setCameraError('Không tìm thấy máy ảnh. Kiểm tra cáp/kết nối Canon.');
            scheduleNextPoll(Math.min(1000, 150 * pollFails));
        };
        const startPolling = () => {
            if (mode === 'poll' || !alive) return;
            mode = 'poll';
            const el = liveViewVisibleRef.current;
            if (el) { el.addEventListener('load', onPollLoad); el.addEventListener('error', onPollError); }
            pollNext();
        };

        // --- WebSocket (chính) ---
        const connect = () => {
            if (!alive || mode === 'poll') return;
            try {
                ws = new WebSocket('ws://localhost:5001/ws');
                ws.binaryType = 'blob';
                ws.onopen = () => { wsFails = 0; liveFrameFailRef.current = 0; };
                ws.onmessage = (event) => {
                    if (!alive) return;
                    const el = liveViewVisibleRef.current;
                    if (!el) return;
                    const url = URL.createObjectURL(event.data);
                    const prev = lastUrl;
                    lastUrl = url;
                    el.src = url;
                    if (prev) setTimeout(() => URL.revokeObjectURL(prev), 250);
                };
                ws.onerror = () => { try { ws.close(); } catch (e) { /* ignore */ } };
                ws.onclose = () => {
                    if (!alive || mode === 'poll') return;
                    wsFails += 1;
                    if (wsFails >= 2) { startPolling(); return; } // /ws không khả dụng -> dùng /frame
                    reconnectTimer = window.setTimeout(connect, 500);
                };
            } catch (e) {
                startPolling();
            }
        };
        connect();

        return () => {
            alive = false;
            if (reconnectTimer) clearTimeout(reconnectTimer);
            if (pollTimer) clearTimeout(pollTimer);
            if (ws) { try { ws.onclose = null; ws.close(); } catch (e) { /* ignore */ } }
            const el = liveViewVisibleRef.current;
            if (el) { el.removeEventListener('load', onPollLoad); el.removeEventListener('error', onPollError); }
            if (lastUrl) URL.revokeObjectURL(lastUrl);
        };
        // wsReconnectToken: watchdog bump -> chạy lại effect này = đóng /ws cũ + kết nối lại.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cameraMode, wsReconnectToken]);

    // Watchdog live view (canon): phát hiện đứng hình -> hiện overlay + tự phục hồi. Bỏ qua trong
    // lúc đang chụp thật (EVF cố ý tắt để /capture) bằng cách coi như vừa có frame -> không báo nhầm.
    useEffect(() => {
        if (cameraMode !== 'canon') return undefined;
        const STALL_MS = 4000;         // quá 4s không có frame -> coi là đứng hình
        const RECOVER_EVERY_MS = 6000; // giãn nhịp phục hồi, không nhồi liên tục
        const id = setInterval(() => {
            const now = Date.now();
            if (shootingRef.current) { lastFrameAtRef.current = now; return; } // đang chụp -> EVF tắt là bình thường
            if (now - lastFrameAtRef.current < STALL_MS) return;                 // vẫn có hình -> ổn
            if (!stalledRef.current) { stalledRef.current = true; stallFromRef.current = now; setLiveStalled(true); demSuKien('mat_hinh'); }
            if (now - stallFromRef.current > 20000 && stallFromRef.current !== daBaoStallRef.current) {
                daBaoStallRef.current = stallFromRef.current; // báo một lần cho mỗi lần đứng hình
                ghiLoi('mat_hinh_lau', 'Máy ảnh không có hình quá 20 s');
            }
            if (now - stallFromRef.current > 20000) setStallLau(true);
            if (now - lastRecoveryAtRef.current < RECOVER_EVERY_MS) return;
            lastRecoveryAtRef.current = now;
            // Ép middleware bật lại EVF (EnsureSessionOpen + StartLiveView) rồi dựng lại /ws.
            try { fetch('http://localhost:5001/start-liveview', { cache: 'no-store' }).catch(() => {}); } catch { /* ignore */ }
            setWsReconnectToken((t) => t + 1);
        }, 1000);
        return () => clearInterval(id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cameraMode]);

    useEffect(() => {
        const needsRetake = sessionData.retakeIndex !== undefined && sessionData.retakeIndex !== null;
        const needsMorePhotos = photosTaken.length < TOTAL_PHOTOS;
        // Canon: CHỜ có >=1 frame live view thật rồi mới đếm ngược -> không bắn /capture vào lúc màn
        // đen/máy chưa ra hình (nguyên nhân "vào là chụp rồi kẹt"). Webcam/hotfolder không dùng cờ này.
        const canonNeedsFrame = cameraMode === 'canon' && !hasLiveFrame;

        if (cameraReady && !canonNeedsFrame && (needsRetake || needsMorePhotos)) {
            batDauLuotRef.current();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cameraReady, hasLiveFrame]); // thêm hasLiveFrame: có hình đầu tiên (canon) -> mở đếm ngược

    // Mọi khung dùng chung "Đếm ngược mỗi ảnh" trong Cài đặt (trước 0.0.34 khung > 4 ảnh bị ép 3 s).
    const getEffectiveCountdown = () => parseInt(configs.countdown, 10) || 5;

    const startCountdown = () => {
        // Mở lại guard: một lượt đếm ngược mới = một lượt chụp hợp lệ mới được phép.
        shootingRef.current = false;
        setLatestPhoto(null);
        // getEffectiveCountdown() + 1: thêm 1s buffer để motion video có đủ thời gian quay
        setCountdown(getEffectiveCountdown() + 1);
    };

    // --- Chờ khách bấm (điện thoại) ---
    const thoatChoBam = () => {
        choBamRef.current = false;
        setChoBam(false);
        setTuChupSau(null);
        if (nhipChoRef.current) { clearInterval(nhipChoRef.current); nhipChoRef.current = null; }
    };
    // Đang chờ lâu: bỏ đoạn motion cũ, quay lại từ đầu (clip chỉ là vài giây ngay trước lúc bấm).
    const lamMoiQuay = () => {
        if (quayLaiRef.current) return;
        quayLaiRef.current = stopRecording()
            .then((u) => {
                if (u) { try { URL.revokeObjectURL(u); } catch { /* bỏ qua */ } }
                if (choBamRef.current && mountedRef.current) { startRecording(); batDauQuayRef.current = Date.now(); }
            })
            .finally(() => { quayLaiRef.current = null; });
    };
    // Hết giờ chờ -> tự chụp bằng đếm ngược như thường (đếm ngược tự quay motion lại từ đầu).
    const hetChoBam = async () => {
        if (!choBamRef.current) return;
        thoatChoBam();
        if (quayLaiRef.current) await quayLaiRef.current;
        const u = await stopRecording();
        if (u) { try { URL.revokeObjectURL(u); } catch { /* bỏ qua */ } }
        if (mountedRef.current) startCountdown();
    };
    const vaoChoBam = () => {
        // Đủ giờ cho các ảnh còn lại (mỗi ảnh ~ đếm ngược + 5 s chụp/xem) rồi mới cho chờ; thiếu thì đếm ngược luôn.
        const conAnh = isRetakeMode ? 1 : Math.max(1, TOTAL_PHOTOS - photosTaken.length);
        const du = timeLeftRef.current - conAnh * (getEffectiveCountdown() + 5);
        const han = Math.min(CHO_BAM_MAX_S, du);
        if (!(han > 3)) { startCountdown(); return; }
        shootingRef.current = false;
        setLatestPhoto(null);
        setCountdown(null);
        choBamRef.current = true;
        setChoBam(true);
        hanChoRef.current = Date.now() + han * 1000;
        setTuChupSau(Math.ceil(han));
        startRecording();
        batDauQuayRef.current = Date.now();
        if (nhipChoRef.current) clearInterval(nhipChoRef.current);
        nhipChoRef.current = setInterval(() => {
            if (!choBamRef.current) return;
            const now = Date.now();
            const con = Math.ceil((hanChoRef.current - now) / 1000);
            setTuChupSau(Math.max(0, con));
            if (con <= 0) { hetChoBam(); return; }
            if (now - batDauQuayRef.current > QUAY_LAI_SAU_MS) lamMoiQuay();
        }, 1000);
    };
    // Khách bấm (điện thoại / chạm màn hình) lúc đang chờ -> chụp ngay.
    const bamChup = async () => {
        if (!choBamRef.current || shootingRef.current) return;
        thoatChoBam();
        if (quayLaiRef.current) await quayLaiRef.current;
        if (mountedRef.current) takePhoto();
    };
    // Mỗi ảnh bắt đầu ở đây: điện thoại đang nối -> chờ bấm; không thì đếm ngược như cũ.
    const batDauLuot = async () => {
        if (ketNoiRemote !== 'on') { startCountdown(); return; }
        // Canon: chỉ mở nút khi live view đã chạy lại sau lần chụp trước. Luồng đếm ngược luôn có ít nhất 6,5 s giữa hai
        // lệnh chụp, còn bấm từ điện thoại có thể chỉ cách 2,5 s -> dễ trúng lúc máy còn bận (0x81).
        if (cameraMode === 'canon') {
            const soKhung = soKhungRef.current;
            const moc = Date.now();
            while (soKhungRef.current === soKhung && Date.now() - moc < CHO_HINH_MOI_MS) {
                await new Promise((r) => setTimeout(r, 100));
                if (!mountedRef.current) return;
            }
        }
        vaoChoBam();
    };
    // Hàm gọi từ timer / sự kiện phải là bản mới nhất (state trong closure).
    const batDauLuotRef = useRef(batDauLuot);
    batDauLuotRef.current = batDauLuot;
    const bamChupRef = useRef(bamChup);
    bamChupRef.current = bamChup;

    useEffect(() => ngheRemote((loai) => {
        if (loai === 'chup') bamChupRef.current();
        else if (loai === 'mat' && choBamRef.current) {
            // Mất điện thoại giữa lúc chờ: không chờ khách bấm nữa, tự chụp sớm.
            hanChoRef.current = Math.min(hanChoRef.current, Date.now() + CHO_KHI_MAT_S * 1000);
            setTuChupSau(CHO_KHI_MAT_S);
        }
    }), []);

    // Gửi trạng thái cho điện thoại (không có phiên thì guiRemote bỏ qua).
    const trangThaiRemote = choBam ? 'cho_bam' : (countdown !== null && countdown > 0 ? 'dem_nguoc' : 'dang_chup');
    useEffect(() => {
        guiRemote({
            buoc: 'chup',
            trangThai: trangThaiRemote,
            tongAnh: TOTAL_PHOTOS,
            daChup: photosTaken.filter(Boolean).length,
            anhHienTai: isRetakeMode ? sessionData.retakeIndex + 1 : Math.min(photosTaken.length + 1, TOTAL_PHOTOS),
            demNguoc: countdown || 0,
            tuChupSau: choBam ? tuChupSau : null,
            conLai: timeLeftRef.current,
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [trangThaiRemote, countdown, tuChupSau, photosTaken.length, TOTAL_PHOTOS]);
    useEffect(() => { guiRemote({ conLai: timeLeft }, { im: true }); }, [timeLeft]);

    useEffect(() => {
        if (countdown === null) return;

        const effectiveCountdown = getEffectiveCountdown();

        if (countdown > 0) {
            // Start recording motion photo when countdown reaches effectiveCountdown
            // (1 giây sau khi bắt đầu, tức là khi buffer 1s đã qua)
            if (countdown === effectiveCountdown) {
                startRecording();
            }
            const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
            return () => clearTimeout(timer);
        } else {
            takePhoto();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [countdown, configs.countdown, TOTAL_PHOTOS]);

    const clearAdvanceTimers = () => {
        advanceTimersRef.current.forEach((t) => clearTimeout(t));
        advanceTimersRef.current = [];
    };

    // Hẹn giờ chuyển ô kế (chưa đủ ảnh) hoặc sang bước sau (đủ ảnh) sau khi chụp xong. Dùng
    // advanceTimersRef để có thể HUỶ khi khách chạm chụp lại trong lúc chờ.
    const scheduleAdvance = (count) => {
        const t1 = setTimeout(() => {
            setFlash(false);
            setIsShooting(false);
            const t2 = setTimeout(() => {
                if (!mountedRef.current) return;
                if (count < TOTAL_PHOTOS) batDauLuotRef.current();
                else nextStep();
            }, count < TOTAL_PHOTOS ? 2000 : 1500);
            advanceTimersRef.current.push(t2);
        }, 500);
        advanceTimersRef.current.push(t1);
    };

    // Ghi ảnh sau khi chụp xong: phân biệt rõ NGUỒN (capturedPhotos, lưới phải) và Ô (photos, lưới trái).
    // Khi chụp lại, thay đúng ảnh trong nguồn, KHÔNG để ô trống (null) bên trái lọt sang nguồn.
    const applyCapture = (newItem) => {
        const ri = sessionData.retakeIndex;
        if (ri !== undefined && ri !== null) {
            const prevSources = (sessionData.capturedPhotos && sessionData.capturedPhotos.length)
                ? sessionData.capturedPhotos
                : photosTaken;
            const oldItem = prevSources[ri];
            const sources = [...prevSources];
            sources[ri] = newItem;
            // Ô nào đang dùng đúng ảnh cũ -> đổi sang ảnh mới; giữ nguyên ô khác (kể cả ô đã gỡ = null)
            let slots = (sessionData.photos || []).map((p) => (p && p === oldItem ? newItem : p));
            // ĐẢM BẢO ảnh chụp lại LUÔN vào 1 ô: nếu ô cũ đã bị gỡ/null (oldItem không còn trong ô) thì
            // khớp theo object ở trên sẽ TRƯỢT -> ảnh mới không vào ô nào -> để lại Ô TRỐNG (null) lọt
            // sang Edit -> filter(Boolean) lệch chỉ số -> MẤT Ô / thiếu ảnh gốc (đúng lỗi retake nhiều lần).
            if (!slots.includes(newItem)) {
                slots = [...slots];
                const fillIdx = (ri < slots.length && !slots[ri]) ? ri : slots.findIndex((p) => !p);
                if (fillIdx >= 0) slots[fillIdx] = newItem;
            }
            releaseReplacedPhoto(oldItem, [...sources, ...slots]);
            updateSessionData('retakeIndex', null);
            setPhotosTaken(sources);
            updateSessionData('photos', slots);
            updateSessionData('capturedPhotos', sources);
            return sources.length;
        }
        // Chụp mới: nối thêm vào cả nguồn lẫn ô (đang đồng bộ ở luồng chụp lần đầu)
        const appended = [...photosTaken, newItem];
        setPhotosTaken(appended);
        updateSessionData('photos', appended);
        updateSessionData('capturedPhotos', appended);
        return appended.length;
    };

    const takePhoto = async () => {
        // Chặn gọi lại khi đang chụp dở (xem shootingRef): tránh 2 lệnh /capture song song.
        if (shootingRef.current) return;
        shootingRef.current = true;
        setIsShooting(true);
        const batDauChup = performance.now(); // đo: bấm chụp -> ảnh hiện trên màn (doMuot 'chup')
        // Flash chỉ CHỚP nhanh (~200ms) thay vì trắng suốt thời gian chờ Canon /capture.
        // Trong lúc chờ sẽ hiện spinner + vẫn thấy live view (xem overlay isShooting).
        setFlash(true);
        setTimeout(() => setFlash(false), 200);

        const audio = shutterAudioRef.current;
        if (audio) audio.currentTime = 0;
        audio?.play().catch(e => { });

        // --- CANON MIDDLEWARE MODE ---
        if (cameraMode === 'canon') {
            try {
                console.log("📷 [Capture] Requesting Canon capture...");
                // Dừng quay motion TRƯỚC khi /capture (lệnh này tạm dừng liveview để chụp).
                let videoUrl = null;
                try {
                    if (quayLaiRef.current) await quayLaiRef.current;
                    videoUrl = await stopRecording();
                    console.log("🎥 [Motion] Canon motion captured:", videoUrl);
                } catch (motionErr) {
                    console.warn("Canon motion capture error:", motionErr);
                }
                const timeout = parseInt(configs.canon_capture_timeout, 10) || 30;
                // Timeout PHÍA CLIENT: nếu middleware/EDSDK treo (lệnh chụp không trả về — hay gặp
                // ở lần chụp lại do tranh chấp thread EDSDK), fetch không có timeout sẽ ĐƠ vĩnh viễn
                // sau đếm ngược. Tự huỷ sau (timeout server + 10s) rồi rơi xuống catch để phục hồi.
                const ctrl = new AbortController();
                const abortTimer = setTimeout(() => ctrl.abort(), (timeout + 10) * 1000);
                let data;
                try {
                    for (let lan = 0; ; lan += 1) {
                        const res = await fetch(`http://localhost:5001/capture?timeout=${timeout}`, { signal: ctrl.signal });
                        data = await res.json();
                        // Máy báo bận (0x81) là chưa chụp gì: thử lại ngay, khách không cần thấy lỗi.
                        if (data.success || !/0x81\b/i.test(data.error || '') || lan >= THU_LAI_BAN_LAN || !mountedRef.current) break;
                        demSuKien('may_ban');
                        await new Promise((r) => setTimeout(r, THU_LAI_BAN_MS));
                    }
                    ghiThoiGian('chup_may', performance.now() - batDauChup); // phần của máy ảnh + middleware
                } finally {
                    clearTimeout(abortTimer);
                }

                if (data.success && data.url) {
                    console.log("📷 [Capture] Canon Photo received:", data.url);
                    const url = data.url;

                    let finalUrl = url;
                    try {
                        const batDauLat = performance.now();
                        const lat = await latGuongAnhKemXem(url, [CANH_XEM, CANH_O]);
                        finalUrl = lat.url;
                        if (lat.xem[CANH_XEM]) {
                            if (mountedRef.current) xemRef.current.set(finalUrl, { xem: lat.xem[CANH_XEM], o: lat.xem[CANH_O] });
                            else Object.values(lat.xem).forEach((u) => URL.revokeObjectURL(u));
                        }
                        ghiThoiGian('lat_anh', performance.now() - batDauLat);
                        console.log("📷 [Capture] Mirrored Canon Photo:", finalUrl);
                    } catch (mirrorError) {
                        console.error("Failed to mirror Canon photo, using original:", mirrorError);
                    }

                    // Đã rời bước chụp trong lúc chờ (hết giờ phiên -> tự sang Review/Edit): ảnh về MUỘN
                    // không được ghi vào phiên nữa — trước 0.0.22 nó ghi đè danh sách ảnh lúc Edit đang
                    // ghép/in -> ảnh in và ảnh tải lên lệch nhau.
                    if (!mountedRef.current) return;

                    // Lưu dạng object {url, videoUrl} để motion chảy xuống bước Edit/upload
                    const canonPhoto = { id: crypto.randomUUID(), url: finalUrl, videoUrl };

                    const count = applyCapture(canonPhoto);
                    setLatestPhoto(xemRef.current.get(finalUrl)?.xem || finalUrl);
                    ghiThoiGian('chup', performance.now() - batDauChup);

                    // Poll /frame tự cập nhật lại khi live view resume sau /capture -> KHÔNG cần đóng/
                    // đổi token reconnect. scheduleAdvance: hẹn giờ chuyển ô/sang bước, huỷ được khi
                    // khách chạm chụp lại giữa chừng.
                    scheduleAdvance(count);
                } else {
                    throw new Error(data.error || "Canon Capture Failed");
                }
            } catch (error) {
                console.error("Canon Capture Failed", error);
                setIsShooting(false);
                setFlash(false);
                const aborted = error?.name === 'AbortError';
                ghiLoi('chup_loi', aborted ? 'Máy ảnh không phản hồi (quá giờ)' : error?.message);
                setCameraError(aborted
                    ? "Máy ảnh không phản hồi, đang thử lại..."
                    : ("Lỗi chụp ảnh Canon: " + error.message));
                setTimeout(() => setCameraError(null), 3000);
                // TỰ PHỤC HỒI: thay vì đơ, đếm ngược lại để thử chụp tiếp (còn thiếu ảnh hoặc đang chụp lại
                // từ Review). Lỗi hiện lặp lại (không kẹt cứng) để nhân viên biết mà xử lý. Đẩy timer vào
                // advanceTimersRef để rời bước giữa lúc chờ vẫn huỷ được.
                if (isRetakeMode || photosTaken.length < TOTAL_PHOTOS) {
                    const rt = setTimeout(() => { if (mountedRef.current) batDauLuotRef.current(); }, 3500);
                    advanceTimersRef.current.push(rt);
                }
            }
            return;
        }

        // --- HOT FOLDER MODE ---
        if (cameraMode === 'hotfolder') {
            const hfTimeout = parseInt(configs.hotfolder_capture_timeout, 10) || 30;
            // Timeout PHÍA CLIENT (giống đường Canon): nếu backend treo/không có ảnh, fetch không có
            // timeout sẽ ĐƠ vĩnh viễn ở màn chụp. Tự huỷ sau (timeout+10)s rồi rơi xuống catch để phục hồi.
            const hfCtrl = new AbortController();
            const hfAbort = setTimeout(() => hfCtrl.abort(), (hfTimeout + 10) * 1000);
            try {
                console.log("🔥 [Capture] Waiting for Hot Folder photo...");
                let res;
                try {
                    res = await fetch('/api/camera/capture', { method: 'POST', signal: hfCtrl.signal });
                } finally {
                    clearTimeout(hfAbort);
                }
                const data = await res.json();

                if (data.success && data.url) {
                    console.log("🔥 [Capture] Photo detected:", data.url);
                    const url = data.url;

                    let finalUrl = url;
                    try {
                        const batDauLat = performance.now();
                        const lat = await latGuongAnhKemXem(url, [CANH_XEM, CANH_O]);
                        finalUrl = lat.url;
                        if (lat.xem[CANH_XEM]) {
                            if (mountedRef.current) xemRef.current.set(finalUrl, { xem: lat.xem[CANH_XEM], o: lat.xem[CANH_O] });
                            else Object.values(lat.xem).forEach((u) => URL.revokeObjectURL(u));
                        }
                        ghiThoiGian('lat_anh', performance.now() - batDauLat);
                        console.log("🔥 [Capture] Mirrored Hot Folder Photo:", finalUrl);
                    } catch (mirrorError) {
                        console.error("Failed to mirror Hot Folder photo, using original:", mirrorError);
                    }

                    if (!mountedRef.current) return; // đã rời bước chụp: bỏ ảnh về muộn (như Canon)
                    const count = applyCapture(finalUrl);
                    setLatestPhoto(xemRef.current.get(finalUrl)?.xem || finalUrl);
                    ghiThoiGian('chup', performance.now() - batDauChup);

                    scheduleAdvance(count);
                } else {
                    throw new Error(data.error || "Hot Folder Timeout");
                }

            } catch (error) {
                console.error("Hot Folder Capture Failed", error);
                ghiLoi('chup_loi', error?.message);
                setIsShooting(false);
                setFlash(false);
                const timeout = parseInt(configs.hotfolder_capture_timeout, 10) || 30;
                setCameraError(`Không tìm thấy ảnh sau ${timeout}s. Vui lòng thử lại.`);
                // Reset error after 3s
                setTimeout(() => setCameraError(null), 3000);
            }
            return;
        }

        // --- WEBCAM MODE ---
        try {
            const canvas = canvasRef.current;
            const video = videoRef.current;

            if (!canvas || !video) throw new Error('Canvas or Video not ready');

            // Set canvas size to video dimensions
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;

            const ctx = canvas.getContext('2d');
            ctx.setTransform(1, 0, 0, 1, 0, 0);

            // Flip horizontally (mirror effect)
            ctx.translate(canvas.width, 0);
            ctx.scale(-1, 1);

            // Draw video frame to canvas
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

            // Convert to blob
            const photoBlob = await new Promise(resolve =>
                canvas.toBlob(resolve, 'image/jpeg', 0.9)
            );

            // Stop Motion Recording
            let videoUrl = null;
            try {
                videoUrl = await stopRecording();
                console.log("🎥 [Motion] Captured:", videoUrl);
            } catch (error) {
                console.warn("Motion capture error:", error);
            }

            // Create Photo Object
            const photoUrl = URL.createObjectURL(photoBlob);
            const newPhoto = {
                id: crypto.randomUUID(),
                url: photoUrl,
                videoUrl: videoUrl
            };

            // Ghi ảnh (chụp lại thì thay đúng nguồn, không để ô trống lọt sang nguồn)
            const count = applyCapture(newPhoto);

            // Show Instant Preview
            setLatestPhoto(photoUrl);

            // Chụp lại -> nguồn đã đầy -> quay lại Review; chụp mới chưa đủ -> chụp tiếp.
            scheduleAdvance(count);

        } catch (error) {
            console.error("Capture Failed", error);
            setIsShooting(false);
            setFlash(false);
        }
    };

    return (
        <div
            className="relative w-full h-full flex items-center justify-center bg-[#FFF8E7] p-4 md:p-8 bg-cover bg-center"
            style={{ backgroundImage: configs?.['bg_preview-when'] ? `url('${configs['bg_preview-when']}')` : 'none' }}
        >

            {/* Main Capture Card */}
            <div className="relative w-full max-w-6xl aspect-[16/9] bg-[#F7E8CF] rounded-2xl overflow-hidden shadow-2xl flex flex-col">

                {/* Live View Area */}
                <div className="flex-1 relative overflow-hidden">
                    {/* Webcam Video - Always rendered so stream stays active */}
                    {/* Webcam Video OR Hot Folder Placeholder */}
                    {cameraMode === 'webcam' ? (
                        <video
                            ref={videoRef}
                            autoPlay
                            playsInline
                            muted
                            className="w-full h-full object-cover"
                            style={{ transform: 'scaleX(-1)' }}
                        />
                    ) : cameraMode === 'canon' ? (
                        <div className="w-full h-full bg-black relative">
                            {/* POLL từng frame JPEG (/frame) thay vì stream MJPEG sống dai -> mỗi
                                request ngắn, đóng ngay, dùng lại keep-alive -> KHÔNG bao giờ tích tụ
                                kết nối dù chụp lại bao nhiêu lần. src do effect poll set liên tục. */}
                            <img
                                ref={liveViewVisibleRef}
                                crossOrigin="anonymous"
                                className="w-full h-full object-cover"
                                style={{ transform: 'scaleX(-1)' }}
                                alt="LiveView"
                                onLoad={() => { _cameraReadyOnce = true; liveFrameFailRef.current = 0; setCameraReady(true); markLiveFrame(); }}
                                onError={() => {
                                    liveFrameFailRef.current += 1;
                                    if (liveFrameFailRef.current > 25) {
                                        setCameraError("Không thể kết nối Canon Middleware (Port 5001)");
                                    }
                                }}
                            />
                        </div>
                    ) : (
                        <div className="w-full h-full bg-black flex items-center justify-center text-white flex-col">
                            <Camera size={64} className="mb-4 text-gray-500 animate-pulse" />
                            <p className="text-xl font-serif">Đang đợi ảnh từ máy ảnh...</p>
                            <p className="text-sm text-gray-500 mt-2">Vui lòng chụp ảnh trên máy Canon</p>
                        </div>
                    )}

                    {/* Loading Overlay */}
                    {!cameraReady && !cameraError && (
                        <div className="absolute inset-0 bg-[#F7E8CF] flex items-center justify-center">
                            <p className="text-xl" style={{ color: primaryTextColor }}>Đang khởi động camera...</p>
                        </div>
                    )}

                    {/* Watchdog: live view ĐỨNG HÌNH (canon) -> báo rõ + đang tự kết nối lại. Thay cho
                        màn ĐEN CÂM trước đây. Ẩn khi đã có lỗi kết nối rõ ràng (cameraError) để không đè. */}
                    {cameraMode === 'canon' && liveStalled && !cameraError && (
                        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-black/70 text-white">
                            <div className="mb-4 h-16 w-16 animate-spin rounded-full border-4 border-white/30 border-t-white" />
                            <p className="text-xl font-serif">{stallLau ? 'Máy ảnh chưa phản hồi' : 'Đang kết nối lại máy ảnh...'}</p>
                            <p className="mt-1 max-w-md text-center text-sm text-white/70">
                                {stallLau
                                    ? 'Nhân viên: tắt rồi bật lại máy ảnh và kiểm tra cáp USB. Có hình lại là tự chụp tiếp.'
                                    : 'Vui lòng đợi giây lát'}
                            </p>
                        </div>
                    )}

                    {/* Error Overlay */}
                    {cameraError && (
                        <div className="absolute inset-0 bg-red-50 flex items-center justify-center">
                            <div className="text-center p-8">
                                <p className="text-red-600 text-xl mb-4 font-semibold">
                                    {cameraMode === 'canon' ? 'Không thể kết nối Canon' : 'Không thể truy cập webcam'}
                                </p>
                                <p className="text-gray-600">{cameraError}</p>
                                <p className="text-gray-500 text-sm mt-2">
                                    {cameraMode === 'canon' ? 'Vui lòng kiểm tra Canon middleware cổng 5001' : 'Vui lòng cho phép quyền truy cập camera'}
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Photo Preview Overlay */}
                    {latestPhoto && (
                        <motion.img
                            key={latestPhoto}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            src={latestPhoto}
                            className="absolute inset-0 w-full h-full object-cover"
                            alt="Instant Preview"
                        />
                    )}


                    {/* Điện thoại đang điều khiển: nhãn ở mép trên + lời nhắc ở đáy (không che mặt). Đang chờ bấm thì
                        chạm vào khung hình cũng chụp. */}
                    {ketNoiRemote !== 'chua' && cameraReady && !latestPhoto && !cameraError && (
                        <NhanRemote
                            trangThai={ketNoiRemote === 'lost' ? 'mat_ket_noi' : choBam ? 'cho_bam' : 'dem_nguoc'}
                            tuChupSau={choBam ? tuChupSau : null}
                        />
                    )}
                    {choBam && (
                        <button
                            type="button"
                            aria-label="Chụp"
                            onClick={() => bamChupRef.current()}
                            className="absolute inset-0 z-30 cursor-pointer bg-transparent"
                        />
                    )}

                    {/* Countdown Overlay - Centered Thin Circle */}
                    <AnimatePresence>
                        {countdown !== null && countdown > 0 && (
                            <div className="absolute inset-0 flex items-center justify-center z-40">
                                <motion.div
                                    initial={{ scale: 0.9, opacity: 0 }}
                                    animate={{ scale: 1, opacity: 1 }}
                                    exit={{ scale: 1.1, opacity: 0 }}
                                    className="w-64 h-64 rounded-full border flex items-center justify-center"
                                    style={{ borderColor: primaryTextColor }}
                                >
                                    <span className="text-[100px] font-serif font-light" style={{ color: primaryTextColor }}>
                                        {countdown}
                                    </span>
                                </motion.div>
                            </div>
                        )}
                    </AnimatePresence>



                    {/* Đang xử lý chụp: spinner trên nền mờ NHẸ -> KHÔNG che trắng, vẫn thấy live view.
                        Chỉ hiện trong lúc chờ máy chụp (isShooting) và chưa có ảnh xem nhanh. */}
                    {isShooting && !latestPhoto && (
                        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/25">
                            <div className="h-20 w-20 animate-spin rounded-full border-4 border-white/40 border-t-white" />
                        </div>
                    )}

                    {/* Flash Overlay (chỉ chớp nhanh) */}
                    <AnimatePresence>
                        {flash && <motion.div initial={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-white z-50" />}
                    </AnimatePresence>
                </div>

                {/* Bottom Thumbnail Strip (Overlay or Part of Card) - Hide if Retaking specific photo */}
                {!isRetakeMode && (
                    <div className={`absolute bottom-6 left-0 right-0 flex justify-center z-30 px-8 ${TOTAL_PHOTOS > 8 ? 'gap-2' : 'gap-4'}`}>
                        {Array.from({ length: TOTAL_PHOTOS }).map((_, i) => {
                            const photoUrl = photosTaken[i];
                            const isCurrent = i === photosTaken.length; // ô sắp chụp
                            return (
                                <motion.div
                                    key={i}
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: i * 0.1 }}
                                    className={`
                                    relative rounded-lg flex items-center justify-center text-2xl font-serif transition-all duration-300 overflow-hidden shadow-lg border-2 ${TOTAL_PHOTOS > 8 ? 'w-16 h-14 md:w-20 md:h-16' : 'w-24 h-20 md:w-32 md:h-24'}
                                    ${photoUrl ? 'bg-[#D5B895] border-[#fff]/50' : 'bg-[#D5B895]/50 border-transparent text-[#8E6B4D]'}
                                    ${isCurrent ? 'scale-110 border-[#fff] shadow-xl ring-2 ring-[#fff]/30' : ''}
                                `}
                                >
                                    {photoUrl ? (
                                        <motion.img
                                            initial={{ opacity: 0 }}
                                            animate={{ opacity: 1 }}
                                            src={(() => { const u = typeof photoUrl === 'object' ? photoUrl.url : photoUrl; return xemRef.current.get(u)?.o || u; })()}
                                            className="w-full h-full object-cover"
                                        />
                                    ) : (
                                        <span>{i + 1}</span>
                                    )}
                                </motion.div>
                            );
                        })}
                    </div>
                )}

            </div>

            {/* Hidden Canvas for Capture & Recording */}
            <canvas ref={canvasRef} className="hidden" />
        </div>
    );
};

export default Capture;
