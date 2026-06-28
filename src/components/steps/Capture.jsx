import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useWorkflow } from '../../context/WorkflowContext';
import { CameraService } from '../../services/CameraService';
import { Camera } from 'lucide-react'; // Added import
import { FirebaseService } from '../../services/FirebaseService';

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

const mirrorImage = async (imageUrl) => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                
                // Flip horizontally
                ctx.translate(canvas.width, 0);
                ctx.scale(-1, 1);
                ctx.drawImage(img, 0, 0);
                
                canvas.toBlob((blob) => {
                    if (blob) {
                        const localUrl = URL.createObjectURL(blob);
                        resolve(localUrl);
                    } else {
                        reject(new Error("Failed to create blob"));
                    }
                }, 'image/jpeg', 0.95);
            } catch (err) {
                reject(err);
            }
        };
        img.onerror = (err) => {
            reject(err);
        };
        img.src = imageUrl;
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
    const isRetakeMode = sessionData.retakeIndex !== undefined && sessionData.retakeIndex !== null;

    // Webcam refs and state
    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const [stream, setStream] = useState(null);
    const [cameraReady, setCameraReady] = useState(false);
    const [cameraError, setCameraError] = useState(null);
    // Booth dùng máy ảnh Canon (không có webcam). Mặc định 'canon' để khi configs CHƯA load
    // kịp KHÔNG rơi vào webcam -> getUserMedia 'Requested device not found' trên máy không webcam.
    const cameraMode = configs?.camera_mode || 'canon';

    // Motion Photo Refs
    const videoChunksRef = useRef([]);
    const mediaRecorderRef = useRef(null);
    const shutterAudioRef = useRef(null);
    // Cờ: đã vẽ được ít nhất 1 frame live view THẬT vào canvas chưa (để bỏ video rỗng ảnh đầu).
    const canonHasFramesRef = useRef(false);
    const canonDrawTimerRef = useRef(null);
    const canonStreamRef = useRef(null);
    // Ref ảnh live view HIỂN THỊ -> để NGẮT kết nối MJPEG khi rời bước chụp.
    const liveViewVisibleRef = useRef(null);
    // Đếm số frame poll lỗi liên tiếp -> chỉ báo lỗi kết nối khi thực sự hỏng (tránh báo nhầm
    // do 1-2 frame 503 lúc mới khởi động).
    const liveFrameFailRef = useRef(0);

    useEffect(() => {
        shutterAudioRef.current = new Audio('/shutter.mp3');
        shutterAudioRef.current.preload = 'auto';
    }, []);

    // Dọn khi UNMOUNT (rời bước chụp do retake/next): dừng timer+recorder và NGẮT 2 kết nối
    // MJPEG live view (set src=''). <img> MJPEG là kết nối sống dai; không ngắt -> tích tụ tới
    // giới hạn ~6 kết nối/host của trình duyệt -> đơ/màn trắng sau nhiều lần retake.
    useEffect(() => {
        return () => {
            // Gán 1 ảnh GIF 1x1 (data URI) buộc trình duyệt HỦY ngay luồng MJPEG đang stream.
            // Set src='' với MJPEG nhiều khi không ngắt kết nối -> tích tụ tới trần ~6/host -> đơ.
            const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
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
    const TOTAL_PHOTOS = layout ? layout.photoCount : 4; // Default to 4

    // Initialize webcam

    // Auto-complete if timeout during capture. Dùng cờ timedOut (bền vững) thay vì
    // isSessionActive (tắt ngay khi hết giờ -> đứt chuỗi auto sang Review/Edit).
    useEffect(() => {
        if (timedOut) {
            console.log("Session Timeout in Capture Step - Force Proceed...");
            // Stop any ongoing countdown/capture
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
            // Đã sẵn sàng ít nhất 1 lần trong phiên (live view server chạy liên tục) -> KHÔNG
            // hiện lại overlay "Đang khởi động camera" mỗi lần chụp lại; coi như sẵn sàng ngay.
            if (_cameraReadyOnce) {
                setCameraReady(true);
                return;
            }
            // Lần đầu: CHỜ live view ra hình (onLoad set cameraReady) -> tránh đen + motion rỗng
            // ở ảnh đầu. Fallback 3s để không kẹt nếu live view chậm lên.
            const fb = setTimeout(() => { _cameraReadyOnce = true; setCameraReady(true); }, 3000);
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
        const onPollDone = () => { if (alive && mode === 'poll') pollTimer = window.setTimeout(pollNext, 20); };
        const startPolling = () => {
            if (mode === 'poll' || !alive) return;
            mode = 'poll';
            const el = liveViewVisibleRef.current;
            if (el) { el.addEventListener('load', onPollDone); el.addEventListener('error', onPollDone); }
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
            if (el) { el.removeEventListener('load', onPollDone); el.removeEventListener('error', onPollDone); }
            if (lastUrl) URL.revokeObjectURL(lastUrl);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cameraMode]);

    useEffect(() => {
        const needsRetake = sessionData.retakeIndex !== undefined && sessionData.retakeIndex !== null;
        const needsMorePhotos = photosTaken.length < TOTAL_PHOTOS;

        if (cameraReady && (needsRetake || needsMorePhotos)) {
            startCountdown();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cameraReady]); // Only depend on cameraReady (initially), logic internal checks sessionData/photos

    const getEffectiveCountdown = () => TOTAL_PHOTOS > 4 ? 3 : (parseInt(configs.countdown) || 5);

    const startCountdown = () => {
        setLatestPhoto(null);
        // getEffectiveCountdown() + 1: thêm 1s buffer để motion video có đủ thời gian quay
        setCountdown(getEffectiveCountdown() + 1);
    };

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
            const slots = (sessionData.photos || []).map((p) => (p && p === oldItem ? newItem : p));
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
        setIsShooting(true);
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
                    videoUrl = await stopRecording();
                    console.log("🎥 [Motion] Canon motion captured:", videoUrl);
                } catch (motionErr) {
                    console.warn("Canon motion capture error:", motionErr);
                }
                const timeout = parseInt(configs.canon_capture_timeout, 10) || 30;
                const res = await fetch(`http://localhost:5001/capture?timeout=${timeout}`);
                const data = await res.json();

                if (data.success && data.url) {
                    console.log("📷 [Capture] Canon Photo received:", data.url);
                    const url = data.url;

                    let finalUrl = url;
                    try {
                        finalUrl = await mirrorImage(url);
                        console.log("📷 [Capture] Mirrored Canon Photo:", finalUrl);
                    } catch (mirrorError) {
                        console.error("Failed to mirror Canon photo, using original:", mirrorError);
                    }

                    // Lưu dạng object {url, videoUrl} để motion chảy xuống bước Edit/upload
                    const canonPhoto = { id: crypto.randomUUID(), url: finalUrl, videoUrl };

                    const count = applyCapture(canonPhoto);
                    setLatestPhoto(finalUrl);

                    setTimeout(() => {
                        setFlash(false);
                        setIsShooting(false);
                        if (count < TOTAL_PHOTOS) {
                            // Poll /frame tự cập nhật lại khi live view resume sau /capture ->
                            // KHÔNG cần đóng/đổi token reconnect nữa (đó là nguồn gây tích tụ kết nối cũ).
                            setTimeout(() => startCountdown(), 2000);
                        } else {
                            setTimeout(() => nextStep(), 1500);
                        }
                    }, 500);
                } else {
                    throw new Error(data.error || "Canon Capture Failed");
                }
            } catch (error) {
                console.error("Canon Capture Failed", error);
                setIsShooting(false);
                setFlash(false);
                setCameraError("Lỗi chụp ảnh Canon: " + error.message);
                setTimeout(() => setCameraError(null), 3000);
            }
            return;
        }

        // --- HOT FOLDER MODE ---
        if (cameraMode === 'hotfolder') {
            try {
                // Call Backend to wait for photo
                // We use a longer timeout on frontend? Or just wait for promise.
                console.log("🔥 [Capture] Waiting for Hot Folder photo...");
                const res = await fetch('/api/camera/capture', { method: 'POST' });
                const data = await res.json();

                if (data.success && data.url) {
                    console.log("🔥 [Capture] Photo detected:", data.url);
                    const url = data.url;

                    let finalUrl = url;
                    try {
                        finalUrl = await mirrorImage(url);
                        console.log("🔥 [Capture] Mirrored Hot Folder Photo:", finalUrl);
                    } catch (mirrorError) {
                        console.error("Failed to mirror Hot Folder photo, using original:", mirrorError);
                    }

                    const count = applyCapture(finalUrl);
                    setLatestPhoto(finalUrl);

                    setTimeout(() => {
                        setFlash(false);
                        setIsShooting(false);
                        if (count < TOTAL_PHOTOS) {
                            setTimeout(() => startCountdown(), 2000);
                        } else {
                            setTimeout(() => nextStep(), 1500);
                        }
                    }, 500);
                } else {
                    throw new Error(data.error || "Hot Folder Timeout");
                }

            } catch (error) {
                console.error("Hot Folder Capture Failed", error);
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

            setTimeout(() => {
                setFlash(false);
                setIsShooting(false);
                // Chụp lại -> nguồn đã đầy -> quay lại Review; chụp mới chưa đủ -> chụp tiếp
                if (count < TOTAL_PHOTOS) {
                    setTimeout(() => startCountdown(), 2000);
                } else {
                    setTimeout(() => nextStep(), 1500);
                }
            }, 500);

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
                                onLoad={() => { _cameraReadyOnce = true; liveFrameFailRef.current = 0; setCameraReady(true); }}
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
                    <div className="absolute bottom-6 left-0 right-0 flex justify-center gap-4 z-30 px-8">
                        {Array.from({ length: TOTAL_PHOTOS }).map((_, i) => {
                            const photoUrl = photosTaken[i];
                            const isCurrent = i === photosTaken.length; // The slot currently being taken

                            return (
                                <motion.div
                                    key={i}
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: i * 0.1 }}
                                    className={`
                                    w-24 h-20 md:w-32 md:h-24 rounded-lg flex items-center justify-center text-2xl font-serif transition-all duration-300 overflow-hidden shadow-lg border-2
                                    ${photoUrl ? 'bg-[#D5B895] border-[#fff]/50' : 'bg-[#D5B895]/50 border-transparent text-[#8E6B4D]'}
                                    ${isCurrent ? 'scale-110 border-[#fff] shadow-xl ring-2 ring-[#fff]/30' : ''}
                                `}
                                >
                                    {photoUrl ? (
                                        <motion.img
                                            initial={{ opacity: 0 }}
                                            animate={{ opacity: 1 }}
                                            src={typeof photoUrl === 'object' ? photoUrl.url : photoUrl}
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
