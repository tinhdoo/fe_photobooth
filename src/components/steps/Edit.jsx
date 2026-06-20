import { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react';
import { motion } from 'framer-motion';
import { useWorkflow } from '../../context/WorkflowContext';
import axios from 'axios';
import { drawImageCover } from '../../utils/canvasUtils';
import { Monitor, Edit2, ArrowLeft, AlertCircle } from 'lucide-react';
import QRCodeStyling from 'qr-code-styling';
import { LAYOUTS } from '../../data/layouts';
import { getDeviceId } from '../../utils/deviceId';

// Cấu hình URL API (Nên đưa vào biến môi trường)
const API_URL = import.meta.env.VITE_API_URL || '';
const CLOUD_API_URL = import.meta.env.VITE_CLOUD_API_URL
    || (typeof window !== 'undefined' && window.location.hostname === 'localhost'
        ? 'https://tomatophotobooth.vercel.app'
        : '');
const FRAME_API_URL = CLOUD_API_URL || API_URL;

const FILTERS = [
    { id: 'normal', name: 'Gốc', filter: null },
    {
        id: 'bw',
        name: 'Đen Trắng',
        filter: (ctx, w, h) => {
            const imageData = ctx.getImageData(0, 0, w, h);
            const data = imageData.data;
            for (let i = 0; i < data.length; i += 4) {
                const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
                data[i] = data[i + 1] = data[i + 2] = avg;
            }
            ctx.putImageData(imageData, 0, 0);
        }
    },
    { id: 'makeup_light', name: 'Makeup nhẹ', type: 'backend', description: 'Cà da nhẹ, sáng trong tự nhiên' },
    { id: 'makeup_soft', name: 'Makeup mềm', type: 'backend', description: 'Môi, má và mắt nhẹ tự nhiên' },
    { id: 'korean', name: 'Trắng hồng', type: 'backend', description: 'Da sáng hồng mức vừa, giữ nét tự nhiên' },
    { id: 'natural', name: 'Da Tự Nhiên', type: 'backend', description: 'Mịn da tự nhiên' },
    { id: 'men', name: 'Da Nam', type: 'backend', description: 'Mịn nhẹ, giữ chi tiết' }
];

const mapWithConcurrency = async (items, limit, worker) => {
    const results = new Array(items.length);
    let cursor = 0;
    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (cursor < items.length) {
            const index = cursor;
            cursor += 1;
            results[index] = await worker(items[index], index);
        }
    });
    await Promise.all(runners);
    return results;
};

const DraggablePhotoSlot = memo(({ photo, box, index, position, onUpdatePosition, frameConfig }) => {
    const handlePan = (event, info) => {
        // Natural dragging
        const SENSITIVITY = 0.002;
        const deltaX = info.delta.x;
        const deltaY = info.delta.y;

        const rot = box.innerRotation || 0;
        const rad = (rot * Math.PI) / 180;

        // Inverse rotate deltas to match image's local coordinate system
        const adjustedDx = Math.cos(rad) * deltaX + Math.sin(rad) * deltaY;
        const adjustedDy = -Math.sin(rad) * deltaX + Math.cos(rad) * deltaY;

        const newX = Math.max(0, Math.min(1, position.x - (adjustedDx * SENSITIVITY)));
        const newY = Math.max(0, Math.min(1, position.y - (adjustedDy * SENSITIVITY)));

        onUpdatePosition(index, { x: newX, y: newY });
    };

    return (
        <div
            className="absolute overflow-hidden bg-gray-200"
            style={{
                left: `${box.x}%`, top: `${box.y}%`, width: `${box.width}%`, height: `${box.height}%`,
                transform: `rotate(${box.rotation}deg)`, borderRadius: `${frameConfig?.borderRadius || 0}px`,
                containerType: 'size'
            }}
        >
            {photo && (
                <>
                    <div style={{
                        position: 'absolute', top: '50%', left: '50%',
                        width: (box.innerRotation === 90 || box.innerRotation === -90 || box.innerRotation === 270 || box.innerRotation === -270) ? '100cqh' : '100%',
                        height: (box.innerRotation === 90 || box.innerRotation === -90 || box.innerRotation === 270 || box.innerRotation === -270) ? '100cqw' : '100%',
                        transform: `translate(-50%, -50%) rotate(${box.innerRotation || 0}deg)`,
                        pointerEvents: 'none'
                    }}>
                        <img
                            src={photo}
                            className="w-full h-full object-cover select-none"
                            alt="print"
                            style={{
                                objectPosition: `${position.x * 100}% ${position.y * 100}%`
                            }}
                        />
                    </div>
                    {/* Invisible Overlay for Dragging */}
                    <motion.div
                        className="absolute inset-0 z-20 cursor-grab active:cursor-grabbing transition-none"
                        onPan={handlePan}
                        title="Kéo để căn chỉnh ảnh"
                    />
                </>
            )}
        </div>
    );
});

const Edit = () => {
    const { nextStep, prevStep, sessionData, updateSessionData, isSessionActive, timeLeft, configs } = useWorkflow();
    const primaryTextColor = configs?.brand_text_primary || '#7B5E43';
    const captureRef = useRef(null);
    // --- STATE ---
    // Tối ưu: Sử dụng useMemo để tránh tạo tham chiếu mới mỗi lần render gây lặp vô tận
    const photos = useMemo(() => {
        const rawPhotos = (sessionData.photos?.length > 0 ? sessionData.photos : sessionData.selectedPhotos) || [];
        return rawPhotos.map(p => (typeof p === 'object' && p?.url) ? p.url : p).filter(Boolean);
    }, [sessionData.photos, sessionData.selectedPhotos]);

    // Positions state for panning (Array of {x, y})
    // Initialize with 0.5 (center) for all logical slots
    const [photoPositions, setPhotoPositions] = useState(() =>
        Array(10).fill({ x: 0.5, y: 0.5 })
    );

    const filterCacheRef = useRef(new Map());
    const filterRunRef = useRef(0);

    const updatePhotoPosition = useCallback((index, pos) => {
        setPhotoPositions(prev => {
            const next = [...prev];
            next[index] = pos;
            return next;
        });
    }, []);

    const sessionLayout = sessionData.layout || { id: 'strip_4' };
    const layout = LAYOUTS.find(l => l.id === sessionLayout.id) || sessionLayout;

    const [selectedFilter, setSelectedFilter] = useState(FILTERS[0]);
    const [filteredPhotos, setFilteredPhotos] = useState(photos); // Init with original photos
    const [frames, setFrames] = useState([]);
    const [selectedFrame, setSelectedFrame] = useState({ id: 'none', name: 'None', color: '#ffffff', image: null });
    const selectedFrameRef = useRef(selectedFrame);
    // Cache config (boxes) theo frameId để đổi frame không phải fetch lại mỗi lần -> hết delay
    const frameConfigCacheRef = useRef(new Map());
    const [frameConfig, setFrameConfig] = useState({ boxes: [] });
    const [isUploading, setIsUploading] = useState(false);
    const [isFiltering, setIsFiltering] = useState(false);
    const [errorDialog, setErrorDialog] = useState({ show: false, title: '', message: '' });

    // Preview QR Code State
    const [previewQrUrl, setPreviewQrUrl] = useState(null);

    // DEBUG: Log on mount to verify photos data
    useEffect(() => {
        console.log('===== EDIT COMPONENT MOUNT DEBUG =====');
        console.log('1. sessionData.photos:', sessionData.photos);
        console.log('2. sessionData.selectedPhotos:', sessionData.selectedPhotos);
        console.log('3. photos constant:', photos);
        console.log('4. photos length:', photos.length);
        console.log('5. filteredPhotos state:', filteredPhotos);
        console.log('6. layout:', layout);
        console.log('=====================================');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        const cache = filterCacheRef.current;
        return () => {
            cache.forEach((url) => {
                if (typeof url === 'string' && url.startsWith('blob:')) URL.revokeObjectURL(url);
            });
            cache.clear();
        };
    }, []);

    // Pagination
    const [currentPage, setCurrentPage] = useState(0);
    const ITEMS_PER_PAGE = 10;
    const totalPages = Math.ceil(frames.length / ITEMS_PER_PAGE);
    const displayedFrames = frames.slice(currentPage * ITEMS_PER_PAGE, (currentPage + 1) * ITEMS_PER_PAGE);

    const nextPage = () => setCurrentPage((prev) => (prev + 1) % totalPages);
    const prevPage = () => setCurrentPage((prev) => (prev - 1 + totalPages) % totalPages);

    // Overlays
    const [qrSettings, setQrSettings] = useState({ show: false, x: 50, y: 50, size: 15 });
    const [dateSettings, setDateSettings] = useState({ show: false, x: 90, y: 90, fontSize: 14, color: '#000000' });

    // --- EFFECTS ---

    // 1. Fetch Frames
    useEffect(() => {
        const fetchFrames = async () => {
            try {
                const layoutId = layout.id || 'strip_4';
                const res = await axios.get(`${FRAME_API_URL}/api/frames`, { params: { layout: layoutId } });
                const allFrames = res.data || [];
                setFrames(allFrames);

                // Prefetch config + preload ảnh cho TẤT CẢ frame (chạy nền) -> đổi frame về sau là tức thì
                allFrames.forEach((f) => {
                    if (f.url) { const im = new Image(); im.src = f.url; } // warm cache ảnh frame
                    if (f.url && f.layout && f.name && !frameConfigCacheRef.current.has(f.id)) {
                        axios.get(`${FRAME_API_URL}/api/frames`, { params: { layout: f.layout, name: f.name, resource: 'config' } })
                            .then((cfgRes) => { if (cfgRes.data) frameConfigCacheRef.current.set(f.id, cfgRes.data); })
                            .catch(() => {});
                    }
                });

                if (allFrames.length > 0) {
                    handleSelectFrame(allFrames[0]);
                }
            } catch (error) {
                console.error("Error fetching frames:", error);
                setFrames([]);
            }
        };
        fetchFrames();
    }, [layout.id, configs?.frame_revision]);

    useEffect(() => {
        selectedFrameRef.current = selectedFrame;
    }, [selectedFrame]);

    // 2. Generate Preview QR Code (Local generation instead of external API)
    useEffect(() => {
        if (qrSettings.show) {
            const qrCode = new QRCodeStyling({
                width: 200,
                height: 200,
                data: 'PREVIEW-DATA',
                margin: 10,
                qrOptions: { errorCorrectionLevel: 'L' },
                dotsOptions: { color: "#000000", type: "square" },
                cornersSquareOptions: { type: "extra-rounded", color: "#000000" },
                cornersDotOptions: { type: "dot", color: "#000000" }
            });
            qrCode.getRawData("png").then((buffer) => {
                const url = URL.createObjectURL(buffer);
                setPreviewQrUrl(url);
            }).catch(err => console.error(err));
        }
    }, [qrSettings.show]);

    // 3. Filter Logic
    useEffect(() => {
        let isMounted = true;
        const runId = filterRunRef.current + 1;
        filterRunRef.current = runId;

        const applyFilterToPhotos = async () => {
            if (selectedFilter.id === 'normal') {
                if (isMounted) setFilteredPhotos(photos);
                return;
            }

            // Client-side Filters
            if (selectedFilter.filter) {
                const filtered = await mapWithConcurrency(photos, 2, async (photoSrc) => {
                    if (!photoSrc) return null;
                    const cacheKey = `${selectedFilter.id}:${photoSrc}`;
                    if (filterCacheRef.current.has(cacheKey)) return filterCacheRef.current.get(cacheKey);

                    return new Promise((resolve) => {
                        const img = new Image();
                        img.crossOrigin = 'anonymous'; // Important for CORS
                        img.onload = () => {
                            const canvas = document.createElement('canvas');
                            canvas.width = img.width;
                            canvas.height = img.height;
                            const ctx = canvas.getContext('2d');
                            ctx.drawImage(img, 0, 0);
                            selectedFilter.filter(ctx, canvas.width, canvas.height);
                            canvas.toBlob((blob) => {
                                if (!blob) {
                                    resolve(photoSrc);
                                    return;
                                }
                                const url = URL.createObjectURL(blob);
                                filterCacheRef.current.set(cacheKey, url);
                                resolve(url);
                            }, 'image/jpeg', 0.9);
                        };
                        img.onerror = () => resolve(photoSrc);
                        img.src = photoSrc;
                    });
                });
                if (isMounted && filterRunRef.current === runId) setFilteredPhotos(filtered);
                return;
            }

            // Backend Filters
            if (selectedFilter.type === 'backend') {
                setIsFiltering(true);
                try {
                    const filtered = await mapWithConcurrency(photos, 2, async (photoSrc, index) => {
                        if (!photoSrc) return null;
                        const cacheKey = `${selectedFilter.id}:${photoSrc}`;
                        if (filterCacheRef.current.has(cacheKey)) return filterCacheRef.current.get(cacheKey);

                        try {
                            const response = await fetch(photoSrc);
                            const blob = await response.blob();
                            const formData = new FormData();
                            formData.append('photo', blob, `photo_${index}.jpg`);
                            formData.append('filter_type', selectedFilter.id);

                            const res = await axios.post(`${API_URL}/api/enhance`, formData, {
                                headers: { 'Content-Type': 'multipart/form-data' }
                            });
                            const filteredUrl = `${res.data.url}?t=${Date.now()}`;
                            filterCacheRef.current.set(cacheKey, filteredUrl);
                            return filteredUrl;
                        } catch (e) {
                            console.error("Backend filter error", e);
                            return photoSrc;
                        }
                    });
                    if (isMounted && filterRunRef.current === runId) setFilteredPhotos(filtered);
                } catch (err) {
                    console.error("Backend filter failed", err);
                } finally {
                    if (isMounted && filterRunRef.current === runId) setIsFiltering(false);
                }
            }
        };

        applyFilterToPhotos();
        return () => { isMounted = false; };
    }, [selectedFilter, photos]);

    // 4. Auto Complete on Timeout (Modified to include offsets if we want auto-print? No, user is idle)
    const isPrintingRef = useRef(false);
    useEffect(() => {
        if (isSessionActive && timeLeft === 0 && !isPrintingRef.current) {
            console.log("Timeout: Auto-printing...");
            isPrintingRef.current = true;
            const autoFinish = async () => {
                const currentFrame = selectedFrameRef.current;
                if ((!currentFrame || currentFrame.id === 'none') && frames.length > 0) {
                    await handleSelectFrame(frames[0]);
                    setTimeout(handlePrint, 500); // Wait for state update
                } else {
                    handlePrint();
                }
            };
            autoFinish();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [timeLeft, isSessionActive, frames]);


    // --- HANDLERS ---

    // FIX RACE CONDITION: Sử dụng biến kiểm tra ID để đảm bảo config khớp với frame đang chọn
    const handleSelectFrame = async (frame) => {
        setSelectedFrame(frame);
        selectedFrameRef.current = frame;

        // Frame màu trơn / none -> không có config layout
        if (!(frame.url && frame.layout && frame.name)) {
            setFrameConfig({ boxes: [] });
            return;
        }

        const cache = frameConfigCacheRef.current;

        // Đã có config trong cache -> áp ngay, KHÔNG clear (tránh nhấp nháy) và KHÔNG fetch
        if (cache.has(frame.id)) {
            setFrameConfig(cache.get(frame.id) || { boxes: [] });
            return;
        }

        // Lần đầu của frame này: clear tạm rồi fetch + cache lại
        setFrameConfig({ boxes: [] });
        try {
            const res = await axios.get(`${FRAME_API_URL}/api/frames`, {
                params: { layout: frame.layout, name: frame.name, resource: 'config' }
            });
            if (res.data) cache.set(frame.id, res.data);

            // Chỉ update nếu frame đang chọn vẫn là frame này (tránh race condition)
            if (selectedFrameRef.current.id === frame.id && res.data) {
                setFrameConfig(res.data);
            }
        } catch (error) {
            console.error("Error fetching config:", error);
        }
    };

    const handleDrag = (e, type) => {
        // e.preventDefault(); // Có thể gây lỗi trên một số thiết bị touch, cân nhắc bỏ nếu không cần thiết
        const container = captureRef.current;
        if (!container) return;

        const rect = container.getBoundingClientRect();

        // Support both mouse and touch
        const getClientPos = (evt) => {
            if (evt.touches && evt.touches.length > 0) return { x: evt.touches[0].clientX, y: evt.touches[0].clientY };
            return { x: evt.clientX, y: evt.clientY };
        };

        const moveHandler = (moveEvent) => {
            const pos = getClientPos(moveEvent);
            let newX = ((pos.x - rect.left) / rect.width) * 100;
            let newY = ((pos.y - rect.top) / rect.height) * 100;

            // Clamp 0-100
            newX = Math.max(0, Math.min(100, newX));
            newY = Math.max(0, Math.min(100, newY));

            if (type === 'qr') setQrSettings(p => ({ ...p, x: newX, y: newY }));
            else setDateSettings(p => ({ ...p, x: newX, y: newY }));
        };

        const upHandler = () => {
            document.removeEventListener('mousemove', moveHandler);
            document.removeEventListener('mouseup', upHandler);
            document.removeEventListener('touchmove', moveHandler);
            document.removeEventListener('touchend', upHandler);
        };

        document.addEventListener('mousemove', moveHandler);
        document.addEventListener('mouseup', upHandler);
        document.addEventListener('touchmove', moveHandler, { passive: false });
        document.addEventListener('touchend', upHandler);
    };

    const uploadFile = async (blob, filename = `capture_${Date.now()}.png`) => {
        const formData = new FormData();
        formData.append('file', blob, filename);
        try {
            const uploadBaseUrl = CLOUD_API_URL || API_URL;
            const res = await axios.post(`${uploadBaseUrl}/api/upload-cloud`, formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            return { url: res.data.url, public_id: res.data.public_id };
        } catch (error) {
            const message = error.response?.data?.error || error.message || 'Không rõ lỗi upload';
            throw new Error(message);
        }
    };

    const sendToPrinter = async (blob, copies = 1, printOptions = {}) => {
        const formData = new FormData();
        formData.append('file', blob, `TomatoPhotobooth_print_${Date.now()}.png`);
        formData.append('copies', String(Math.max(1, parseInt(copies, 10) || 1)));
        formData.append('print_mode', printOptions.printMode || 'grid_4x6');
        formData.append('cut_mode', printOptions.cutMode || 'none');
        if (printOptions.sessionId) formData.append('session_id', printOptions.sessionId);

        const res = await axios.post(`${API_URL}/api/print`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
            timeout: 30000,
        });

        return res.data;
    };

    const canvasToBlob = (canvas, type = 'image/png', quality) => new Promise((resolve) => {
        canvas.toBlob((blob) => resolve(blob), type, quality);
    });

    const drawImageContain = (ctx, imgCanvas, x, y, w, h) => {
        const sourceRatio = imgCanvas.width / imgCanvas.height;
        const targetRatio = w / h;
        let drawW = w;
        let drawH = h;
        let drawX = x;
        let drawY = y;

        if (sourceRatio > targetRatio) {
            drawH = w / sourceRatio;
            drawY = y + (h - drawH) / 2;
        } else {
            drawW = h * sourceRatio;
            drawX = x + (w - drawW) / 2;
        }

        ctx.drawImage(imgCanvas, drawX, drawY, drawW, drawH);
    };

    const buildPrintCanvas = (sourceCanvas, printMode = 'grid_4x6') => {
        const canvas = document.createElement('canvas');
        canvas.width = 1200;
        canvas.height = 1800;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        if (printMode === 'double_strip') {
            // Strip gốc là 600x1800 (tỉ lệ 1:3), đúng bằng mỗi nửa của giấy 4x6 (600x1800).
            // Vẽ tràn lề để GIỮ NGUYÊN tỉ lệ 1:3 và bỏ viền trắng thừa.
            ctx.drawImage(sourceCanvas, 0, 0, 600, 1800);
            ctx.drawImage(sourceCanvas, 600, 0, 600, 1800);
            return { canvas, cutMode: '2x6' };
        }

        if (printMode === 'single_strip') {
            // Căn giữa 1 strip 600x1800 trên giấy 1200x1800, giữ nguyên tỉ lệ 1:3.
            ctx.drawImage(sourceCanvas, 300, 0, 600, 1800);
            return { canvas, cutMode: 'none' };
        }

        drawImageContain(ctx, sourceCanvas, 0, 0, canvas.width, canvas.height);
        return { canvas, cutMode: 'none' };
    };

    const cloneCanvas = (sourceCanvas) => {
        const canvas = document.createElement('canvas');
        canvas.width = sourceCanvas.width;
        canvas.height = sourceCanvas.height;
        canvas.getContext('2d').drawImage(sourceCanvas, 0, 0);
        return canvas;
    };

    const applyPrintColorSettings = (canvas) => {
        const settings = {
            brightness: Number(configs?.print_brightness || 0),
            contrast: Number(configs?.print_contrast || 0),
            saturation: Number(configs?.print_saturation || 0),
            pink: Number(configs?.print_pink || 0),
            whitening: Number(configs?.print_skin_whitening || 0),
            warmth: Number(configs?.print_warmth || 0),
        };

        if (Object.values(settings).every((value) => !Number.isFinite(value) || value === 0)) return canvas;

        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        const clamp = (value) => Math.max(0, Math.min(255, value));
        const contrastValue = Math.max(-80, Math.min(80, settings.contrast * 2));
        const contrastFactor = (259 * (contrastValue + 255)) / (255 * (259 - contrastValue));
        const saturationFactor = 1 + (settings.saturation / 100);
        const whiteningAmount = Math.max(0, Math.min(0.3, settings.whitening / 100));
        const pinkAmount = Math.max(0, Math.min(30, settings.pink));

        for (let i = 0; i < data.length; i += 4) {
            let r = data[i];
            let g = data[i + 1];
            let b = data[i + 2];

            const originalR = r;
            const originalG = g;
            const originalB = b;
            const max = Math.max(originalR, originalG, originalB);
            const min = Math.min(originalR, originalG, originalB);
            const isSkinTone = originalR > 70
                && originalG > 40
                && originalB > 30
                && originalR > originalB
                && max - min > 12
                && originalR - originalG < 95;

            r += settings.brightness + settings.warmth;
            g += settings.brightness + (settings.warmth * 0.25);
            b += settings.brightness - settings.warmth;

            r = contrastFactor * (r - 128) + 128;
            g = contrastFactor * (g - 128) + 128;
            b = contrastFactor * (b - 128) + 128;

            const gray = 0.299 * r + 0.587 * g + 0.114 * b;
            r = gray + (r - gray) * saturationFactor;
            g = gray + (g - gray) * saturationFactor;
            b = gray + (b - gray) * saturationFactor;

            if (isSkinTone) {
                r = r + (255 - r) * whiteningAmount + pinkAmount * 0.9;
                g = g + (255 - g) * whiteningAmount * 0.8 + pinkAmount * 0.15;
                b = b + (255 - b) * whiteningAmount * 0.7 + pinkAmount * 0.55;
            }

            data[i] = clamp(r);
            data[i + 1] = clamp(g);
            data[i + 2] = clamp(b);
        }

        ctx.putImageData(imageData, 0, 0);
        return canvas;
    };

    const handlePrint = async () => {
        if (isUploading) return;
        setIsUploading(true);

        try {
            // 1. Generate Session ID (UUID) frontend-side for QR Code
            const sessionId = (window.crypto && typeof window.crypto.randomUUID === 'function')
                ? window.crypto.randomUUID()
                : `session-${Math.random().toString(36).substring(2, 11)}`;
            const albumBaseUrl = CLOUD_API_URL || window.location.origin;
            const downloadUrl = `${albumBaseUrl}/album/${sessionId}`;

            // 2. Setup Canvas
            const baseCanvas = document.createElement('canvas');
            const TARGET_HEIGHT = 1800;
            const isStrip = layout.type === 'strip';
            const isHorizontal = layout.type && layout.type.includes('horizontal');
            const ratio = isStrip ? 1 / 3 : (isHorizontal ? 3 / 2 : 2 / 3);
            baseCanvas.height = TARGET_HEIGHT;
            baseCanvas.width = TARGET_HEIGHT * ratio;

            const baseCtx = baseCanvas.getContext('2d');

            // 3. Background
            if (selectedFrame.color && !selectedFrame.url && !selectedFrame.image) {
                baseCtx.fillStyle = selectedFrame.color;
                baseCtx.fillRect(0, 0, baseCanvas.width, baseCanvas.height);
            } else {
                baseCtx.clearRect(0, 0, baseCanvas.width, baseCanvas.height);
            }

            // Helper to load image securely
            const imageCache = new Map();
            const loadImage = (src) => new Promise((resolve) => {
                if (!src) {
                    resolve(null);
                    return;
                }
                if (imageCache.has(src)) {
                    imageCache.get(src).then(resolve);
                    return;
                }
                const img = new Image();
                img.crossOrigin = 'anonymous'; // CRITICAL for toBlob
                img.onload = () => resolve(img);
                img.onerror = () => { console.warn("Load failed", src); resolve(null); };
                img.src = src;
            });
            const cachedLoadImage = (src) => {
                if (!imageCache.has(src)) imageCache.set(src, loadImage(src));
                return imageCache.get(src);
            };

            const photosToDraw = filteredPhotos.length > 0 ? filteredPhotos : photos;
            const preloadSources = new Set(photosToDraw.filter(Boolean));
            if (selectedFrame.url || selectedFrame.image) preloadSources.add(selectedFrame.url || selectedFrame.image);
            await Promise.all(Array.from(preloadSources).map(cachedLoadImage));

            const drawComposite = async (targetCanvas, targetCtx) => {
                // 4. Draw Photos (Custom vs Grid)
                if (frameConfig && frameConfig.boxes && frameConfig.boxes.length > 0) {
                    let implicitPhotoIndex = 0;
                    for (const box of frameConfig.boxes) {
                        if (box.type === 'qr') continue; // Handled by manual overlay

                        const targetIdx = box.photoIndex !== undefined ? box.photoIndex : (implicitPhotoIndex % photosToDraw.length);
                        if (box.photoIndex === undefined) implicitPhotoIndex++;

                        const photoSrc = photosToDraw[targetIdx];
                        const position = photoPositions[targetIdx] || { x: 0.5, y: 0.5 }; // Get position per photo
                        if (!photoSrc) continue;

                        const img = await cachedLoadImage(photoSrc);
                        if (img) {
                            const x = (box.x / 100) * targetCanvas.width;
                            const y = (box.y / 100) * targetCanvas.height;
                            const w = (box.width / 100) * targetCanvas.width;
                            const h = (box.height / 100) * targetCanvas.height;

                            targetCtx.save();
                            if (box.rotation) {
                                // Rotate around center of box
                                targetCtx.translate(x + w / 2, y + h / 2);
                                targetCtx.rotate((box.rotation * Math.PI) / 180);
                                targetCtx.translate(-(x + w / 2), -(y + h / 2));
                            }

                            if (frameConfig.borderRadius > 0) {
                                targetCtx.beginPath();
                                targetCtx.rect(x, y, w, h); // Clip in rotated space
                                targetCtx.clip();
                            }

                            if (box.innerRotation) {
                                targetCtx.save();
                                targetCtx.translate(x + w / 2, y + h / 2);
                                targetCtx.rotate((box.innerRotation * Math.PI) / 180);

                                let drawW = w;
                                let drawH = h;
                                const isRt = box.innerRotation === 90 || box.innerRotation === -90 || box.innerRotation === 270 || box.innerRotation === -270;
                                if (isRt) {
                                    drawW = h;
                                    drawH = w;
                                }

                                drawImageCover(targetCtx, img, -drawW / 2, -drawH / 2, drawW, drawH, position.x, position.y);
                                targetCtx.restore();
                            } else {
                                drawImageCover(targetCtx, img, x, y, w, h, position.x, position.y);
                            }

                            targetCtx.restore();
                        }
                    }
                } else {
                    // Default Grid
                    const cols = layout.cols || 1;
                    const rows = layout.rows || 1;
                    const padding = 48;
                    const gap = 36;
                    const totalGapW = (cols - 1) * gap;
                    const cellW = (targetCanvas.width - (padding * 2) - totalGapW) / cols;
                    const totalGapH = (rows - 1) * gap;
                    const cellH = (targetCanvas.height - (padding * 2) - totalGapH) / rows;

                    for (let i = 0; i < (cols * rows); i++) {
                        const mappedIndex = i % (photosToDraw.length || 1);
                        if (!photosToDraw[mappedIndex]) continue;
                        const img = await cachedLoadImage(photosToDraw[mappedIndex]);
                        const position = photoPositions[mappedIndex] || { x: 0.5, y: 0.5 };

                        if (img) {
                            const col = i % cols;
                            const row = Math.floor(i / cols);
                            const x = padding + col * (cellW + gap);
                            const y = padding + row * (cellH + gap);
                            drawImageCover(targetCtx, img, x, y, cellW, cellH, position.x, position.y);
                        }
                    }
                }

                // 5. Draw Frame Overlay
                if (selectedFrame.url || selectedFrame.image) {
                    const frameImg = await cachedLoadImage(selectedFrame.url || selectedFrame.image);
                    if (frameImg) targetCtx.drawImage(frameImg, 0, 0, targetCanvas.width, targetCanvas.height);
                }
            };

            // Draw photos + frame (clean version, no QR/date)
            await drawComposite(baseCanvas, baseCtx);

            // Clone clean canvas for composite upload (no QR, no date)
            const cleanCanvas = cloneCanvas(baseCanvas);

            // Now draw QR and Date on baseCanvas for print only
            const drawQrAndDate = (targetCanvas, targetCtx) => {
                // Draw QR Code
                // (QR is async, handle separately below)

                // Draw Date
                if (dateSettings.show) {
                    const today = new Date();
                    const dateStr = `${String(today.getDate()).padStart(2, '0')} . ${String(today.getMonth() + 1).padStart(2, '0')} . ${today.getFullYear()}`;
                    const fontSize = (dateSettings.fontSize / 1000) * targetCanvas.height;
                    const x = (dateSettings.x / 100) * targetCanvas.width;
                    const y = (dateSettings.y / 100) * targetCanvas.height;

                    targetCtx.save();
                    targetCtx.font = `bold ${fontSize}px Arial, sans-serif`;
                    targetCtx.fillStyle = dateSettings.color;
                    targetCtx.textAlign = 'center';
                    targetCtx.textBaseline = 'middle';
                    targetCtx.fillText(dateStr, x, y);
                    targetCtx.restore();
                }
            };

            // Draw QR on baseCanvas for print
            if (qrSettings.show) {
                const qrW = (qrSettings.size / 100) * baseCanvas.width;
                const qrX = (qrSettings.x / 100) * baseCanvas.width - (qrW / 2);
                const qrY = (qrSettings.y / 100) * baseCanvas.height - (qrW / 2);

                try {
                    const qrCode = new QRCodeStyling({
                        width: 500,
                        height: 500,
                        data: downloadUrl,
                        margin: 25,
                        qrOptions: { errorCorrectionLevel: 'L' },
                        dotsOptions: { color: "#000000", type: "square" },
                        cornersSquareOptions: { type: "extra-rounded", color: "#000000" },
                        cornersDotOptions: { type: "dot", color: "#000000" },
                        backgroundOptions: { color: "#ffffff" }
                    });
                    const buffer = await qrCode.getRawData("png");
                    const qrDataUrl = URL.createObjectURL(buffer);
                    const qrImg = await cachedLoadImage(qrDataUrl);
                    if (qrImg) {
                        baseCtx.drawImage(qrImg, qrX, qrY, qrW, qrW);
                    }
                    URL.revokeObjectURL(qrDataUrl);
                } catch (e) { console.warn("QR Gen failed", e); }
            }

            // Draw date on baseCanvas for print
            drawQrAndDate(baseCanvas, baseCtx);

            const printMode = layout.printMode || (layout.type === 'strip' ? 'double_strip' : 'grid_4x6');
            const printOutput = buildPrintCanvas(baseCanvas, printMode);
            const printCanvas = printOutput.canvas;
            const cutMode = printOutput.cutMode;
            const compositeCanvas = cleanCanvas;
            applyPrintColorSettings(printCanvas);
            const printBlob = await canvasToBlob(printCanvas, 'image/png');

            // 8. Upload & Create Session
            compositeCanvas.toBlob(async (blob) => {
                if (!blob || !printBlob) { setIsUploading(false); return; }
                try {
                    const compositeData = await uploadFile(blob);
                    const compositeUrl = compositeData.url;
                    const compositePublicId = compositeData.public_id;

                    // Upload originals and videos
                    // Upload originals and videos
                    const rawSource = sessionData.photos || [];
                    const uploadedPhotos = await mapWithConcurrency(photos, 2, async (photoUrl, index) => {
                        let finalPhotoUrl = photoUrl;
                        let finalPhotoPublicId = null;
                        let finalVideoUrl = null;
                        let finalVideoPublicId = null;
                        const originalData = rawSource[index];

                        try {
                            // 1. Upload Photo if it's a blob or temporary local URL
                            if (photoUrl) {
                                // If it's a blob OR it's a local LAN URL (not Cloudinary), upload it to Cloudinary
                                const isBlob = photoUrl.startsWith('blob:');
                                const isLocalHttp = photoUrl.startsWith('http') && !photoUrl.includes('res.cloudinary.com');

                                if (isBlob || isLocalHttp) {
                                    console.log(`☁️ Uploading photo to cloud: ${photoUrl}`);
                                    const f = await fetch(photoUrl);
                                    const b = await f.blob();
                                    const uploadData = await uploadFile(b, `raw_${index}_${Date.now()}.jpg`);
                                    finalPhotoUrl = uploadData.url;
                                    finalPhotoPublicId = uploadData.public_id;
                                }
                            }

                            // 2. Upload Video if available
                            if (originalData && typeof originalData === 'object' && originalData.videoUrl && originalData.videoUrl.startsWith('blob:')) {
                                console.log(`🎥 Uploading video for slot ${index}:`, originalData.videoUrl);
                                const f = await fetch(originalData.videoUrl);
                                const b = await f.blob();
                                const uploadData = await uploadFile(b, `motion_${index}_${Date.now()}.webm`);
                                finalVideoUrl = uploadData.url;
                                finalVideoPublicId = uploadData.public_id;
                                console.log(`✅ Video uploaded:`, finalVideoUrl);
                            } else {
                                console.log(`ℹ️ No video pending for slot ${index}`);
                            }

                            return {
                                url: finalPhotoUrl,
                                video_url: finalVideoUrl,
                                public_id: finalPhotoPublicId,
                                video_public_id: finalVideoPublicId,
                                type: 'raw'
                            };
                        } catch (e) {
                            console.error("Upload failed for item " + index, e);
                            // Return photo at least so session is valid
                            return {
                                url: finalPhotoUrl,
                                video_url: null,
                                public_id: finalPhotoPublicId,
                                video_public_id: null,
                                type: 'raw'
                            };
                        }
                    });

                    // Session phải được tạo ở cùng nơi mà QR album và trang doanh thu đọc
                    // (CLOUD_API_URL). Nếu chỉ lưu local thì quét QR / xem doanh thu sẽ không thấy.
                    const sessionBaseUrl = CLOUD_API_URL || API_URL;
                    const selectedPrintQuantity = Math.max(1, parseInt(sessionData.printQuantity, 10) || 1);
                    const printerCopies = printMode === 'double_strip'
                        ? Math.max(1, Math.ceil(selectedPrintQuantity / 2))
                        : selectedPrintQuantity;

                    const sessionRes = await axios.post(`${sessionBaseUrl}/api/sessions`, {
                        layout_id: layout.id || 'strip_4',
                        composite_url: compositeUrl,
                        composite_public_id: compositePublicId, // Send Public ID
                        photos: uploadedPhotos.filter(Boolean),
                        payment_method: sessionData.paymentMethod || 'cash',
                        amount: sessionData.printPrice || 60000,
                        session_id: sessionId, // Gửi UUID frontend xuống backend để lưu
                        meta_data: {
                            device_id: getDeviceId(),
                            frame_url: selectedFrame.url || selectedFrame.image,
                            frame_config: frameConfig,
                            photo_positions: photoPositions,
                            print_mode: printMode,
                            cut_mode: cutMode,
                            print_quantity: selectedPrintQuantity,
                            printer_copies: printerCopies,
                            payment_code: sessionData.paymentCode || null,
                            payment_code_value: sessionData.paymentCodeValue || null,
                            payment_code_applied: sessionData.paymentCodeApplied || null,
                            sepay_order_code: sessionData.sepayOrderCode || null,
                        }
                    });

                    updateSessionData('finalImage', compositeUrl);
                    updateSessionData('sessionId', sessionRes.data.uuid || sessionId);

                    try {
                        const printResult = await sendToPrinter(printBlob, printerCopies, {
                            printMode,
                            cutMode,
                            sessionId,
                        });
                        console.log('Print job queued:', printResult);
                    } catch (printError) {
                        const data = printError.response?.data;
                        const available = data?.available_printers?.length
                            ? ` Máy in hiện có: ${data.available_printers.join(', ')}.`
                            : '';
                        const message = data?.error || printError.message || 'Không thể gửi ảnh sang máy in.';
                        setErrorDialog({
                            show: true,
                            title: 'Không thể in ảnh',
                            message: `${message}${available}`,
                        });
                    }

                    nextStep();
                } catch (err) {
                    console.error("Upload process failed:", err);
                    setErrorDialog({
                        show: true,
                        title: 'Không thể lưu ảnh',
                        message: 'Có lỗi khi lưu ảnh, vui lòng thử lại.',
                    });
                } finally {
                    setIsUploading(false);
                }
            }, 'image/png');

        } catch (error) {
            console.error("Print logic failed:", error);
            setIsUploading(false);
        }
    };

    // --- RENDER HELPERS ---

    const renderPreviewBoxes = () => {
        if (!frameConfig || !frameConfig.boxes || frameConfig.boxes.length === 0) return null;

        let implicitPhotoIndex = 0;
        return frameConfig.boxes.map((box, i) => {
            if (box.type === 'qr') {
                return (
                    <div key={`box-${i}`}
                        className="absolute bg-white/50 border border-dashed border-gray-600 flex items-center justify-center pointer-events-none"
                        style={{
                            left: `${box.x}%`, top: `${box.y}%`, width: `${box.width}%`, height: `${box.height}%`,
                            transform: `rotate(${box.rotation}deg)`, borderRadius: `${frameConfig.borderRadius}px`, zIndex: 10
                        }}>
                        <span className="text-[10px] font-bold">QR PLACEHOLDER</span>
                    </div>
                );
            }

            const targetIdx = box.photoIndex !== undefined ? box.photoIndex : (implicitPhotoIndex % (filteredPhotos.length || photos.length || 1));
            if (box.photoIndex === undefined) implicitPhotoIndex++;
            const photo = filteredPhotos[targetIdx] || photos[targetIdx];

            return (
                <DraggablePhotoSlot
                    key={`box-${i}`}
                    photo={photo}
                    box={box}
                    index={targetIdx}
                    position={photoPositions[targetIdx] || { x: 0.5, y: 0.5 }}
                    onUpdatePosition={updatePhotoPosition}
                    frameConfig={frameConfig}
                />
            );
        });
    };

    return (
        <div
            className="flex flex-col h-full w-full p-6 bg-[#FFF8E7] relative bg-cover bg-center"
            style={{ backgroundImage: configs?.['bg_filter-adjustment'] ? `url('${configs['bg_filter-adjustment']}')` : 'none' }}
        >
            {/* Back Button */}
            <button
                onClick={prevStep}
                className="absolute top-6 left-6 flex items-center gap-2 px-6 py-3 bg-white rounded-full transition-none font-serif font-bold shadow-sm border border-[#D5B895]/20 z-20 active:scale-95"
                style={{ color: primaryTextColor }}
            >
                <ArrowLeft size={24} />
                <span>Quay Lại</span>
            </button>

            <motion.h2
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-5xl font-serif text-center mb-12 tracking-wider uppercase"
                style={{ color: primaryTextColor }}
            >
                Chọn Màu & Khung Ảnh
            </motion.h2>

            <div className="flex-1 flex gap-8 overflow-hidden px-4">
                {/* LEFT: Preview */}
                <div className="w-5/12 flex items-center justify-center p-8 bg-[#F6E6C9]/55 rounded-3xl ml-4">
                    <div ref={captureRef}
                        className="shadow-2xl relative transition-all duration-300"
                        style={{
                            // FIX SCALE:
                            // Vertical layouts (Strip/Grid 2:3) -> Limit by Height (height=100%, width=auto) to prevent vertical overflow
                            // Horizontal layouts (3:2) -> Limit by Width (width=100%, height=auto)
                            height: (layout.type === 'strip' || !layout.type?.includes('horizontal')) ? '100%' : 'auto',
                            width: (layout.type === 'strip' || !layout.type?.includes('horizontal')) ? 'auto' : '100%',
                            maxHeight: '100%', maxWidth: '100%',
                            backgroundColor: (selectedFrame.url || selectedFrame.image) ? 'transparent' : (selectedFrame.color || '#ffffff'),
                            aspectRatio: layout.type === 'strip' ? '1/3' : (layout.type?.includes('horizontal') ? '3/2' : '2/3'),
                        }}
                    >
                        {/* 1. Photos Layer */}
                        {frameConfig && frameConfig.boxes && frameConfig.boxes.length > 0 ? (
                            <div className="w-full h-full relative">
                                {renderPreviewBoxes()}
                            </div>
                        ) : (
                            <div className="w-full h-full grid p-4 gap-3"
                                style={{ gridTemplateColumns: `repeat(${layout.cols || 1}, 1fr)`, gridTemplateRows: `repeat(${layout.rows || 1}, 1fr)` }}>
                                {Array.from({ length: (layout.rows || 1) * (layout.cols || 1) }).map((_, i) => {
                                    const mappedIndex = i % (filteredPhotos.length || photos.length || 1);
                                    const photoSrc = filteredPhotos[mappedIndex] || photos[mappedIndex];
                                    if (!photoSrc) return <div key={i} className="w-full h-full overflow-hidden bg-gray-200" />;

                                    // For generic grid, calculate relative box
                                    const box = {
                                        x: 0, y: 0,
                                        width: 100, height: 100,
                                        rotation: 0
                                    };

                                    return (
                                        <div key={i} className="w-full h-full relative overflow-hidden bg-gray-200">
                                            <DraggablePhotoSlot
                                                photo={photoSrc}
                                                box={box}
                                                index={mappedIndex}
                                                position={photoPositions[mappedIndex] || { x: 0.5, y: 0.5 }}
                                                onUpdatePosition={updatePhotoPosition}
                                                frameConfig={{ borderRadius: 0 }}
                                            />
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {/* 2. Frame Overlay */}
                        {(selectedFrame.url || selectedFrame.image) && (
                            <div className="absolute inset-0 z-30 pointer-events-none">
                                <img src={selectedFrame.url || selectedFrame.image} className="w-full h-full object-fill" alt="Frame" onError={(e) => e.target.style.display = 'none'} />
                            </div>
                        )}

                        {/* 3. Draggable Overlays */}
                        {isFiltering && (
                            <div className="absolute inset-0 z-50 bg-white/40 backdrop-blur-[2px] flex items-center justify-center transition-all duration-300">
                                <div className="p-4 bg-white/90 rounded-2xl shadow-lg flex flex-col items-center gap-3">
                                    <div className="w-8 h-8 rounded-full border-4 border-[#D5B895]/30 border-t-[#7B5E43] animate-spin" />
                                    <span className="text-xs font-serif font-bold text-[#7B5E43] uppercase tracking-wider">Đang áp dụng...</span>
                                </div>
                            </div>
                        )}

                        {qrSettings.show && (
                            <div className="absolute cursor-move z-50 ring-blue-400"
                                style={{
                                    left: `${qrSettings.x}%`, top: `${qrSettings.y}%`,
                                    width: `${qrSettings.size}%`, aspectRatio: '1/1',
                                    transform: 'translate(-50%, -50%)'
                                }}
                                onMouseDown={(e) => handleDrag(e, 'qr')}
                                onTouchStart={(e) => handleDrag(e, 'qr')}
                            >
                                <img src={previewQrUrl || null} className="w-full h-full border-2 border-white bg-white" alt="QR" draggable={false} />
                            </div>
                        )}

                        {dateSettings.show && (
                            <div className="absolute cursor-move z-50 ring-blue-400 whitespace-nowrap select-none"
                                style={{
                                    left: `${dateSettings.x}%`, top: `${dateSettings.y}%`,
                                    transform: 'translate(-50%, -50%)',
                                    fontSize: `${dateSettings.fontSize / 10}cqh`, // Fallback could be needed
                                    fontWeight: 'bold', fontFamily: 'Arial', color: dateSettings.color
                                }}
                                onMouseDown={(e) => handleDrag(e, 'date')}
                                onTouchStart={(e) => handleDrag(e, 'date')}
                            >
                                {(() => {
                                    const t = new Date();
                                    return `${String(t.getDate()).padStart(2, '0')} . ${String(t.getMonth() + 1).padStart(2, '0')} . ${t.getFullYear()}`;
                                })()}
                            </div>
                        )}
                    </div>
                </div>

                {/* RIGHT: Controls */}
                <div className="flex-1 flex flex-col justify-center gap-6 items-center pl-8">
                    {/* Filter List */}
                    <div className="bg-[#F6E6C9]/70 p-4 rounded-[2rem] w-full max-w-4xl shadow-sm flex flex-col gap-4">
                        <div className="grid grid-cols-7 gap-2">
                            {FILTERS.map((filter) => (
                                <motion.div key={filter.id}
                                    onClick={() => !isFiltering && setSelectedFilter(filter)}
                                    className={`aspect-[4/5] rounded-xl flex flex-col items-center justify-center border-2 transition-all 
                                    ${isFiltering ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                                    ${selectedFilter.id === filter.id ? 'border-[#7B5E43] bg-[#FFF1D6]' : 'border-transparent bg-[#FFF4E3]/60'}`}>
                                    <span className="font-lora text-[#7B5E43] font-bold text-[0.6rem] uppercase text-center px-1">{filter.name}</span>
                                </motion.div>
                            ))}
                        </div>
                        {/* Options - Compact Side-by-Side Design */}
                        <div className="flex gap-3 pt-5 w-full border-t border-[#7B5E43]/20">

                            {/* QR Code Card */}
                            <div className={`flex-1 transition-all duration-300 rounded-xl border flex flex-col ${qrSettings.show ? 'bg-[#7B5E43]/5 border-[#7B5E43]/30' : 'bg-white/40 border-transparent grayscale brightness-95 opacity-60'}`}>
                                <div className="flex items-center justify-between px-2.5 py-2 cursor-pointer" onClick={() => setQrSettings({ ...qrSettings, show: !qrSettings.show })}>
                                    <div className="flex items-center gap-1.5">
                                        <div className={`p-1 rounded-md transition-colors ${qrSettings.show ? 'bg-[#7B5E43] text-white' : 'bg-gray-400 text-white'}`}>
                                            <Monitor size={12} />
                                        </div>
                                        <span className={`font-bold text-[10px] ${qrSettings.show ? 'text-[#7B5E43]' : 'text-gray-500'}`}>MÃ QR</span>
                                    </div>
                                    <div className={`w-7 h-3.5 rounded-full relative transition-colors ${qrSettings.show ? 'bg-[#7B5E43]' : 'bg-gray-300'}`}>
                                        <div className={`absolute top-0.5 w-2.5 h-2.5 bg-white rounded-full transition-all shadow-sm`} style={{ left: qrSettings.show ? 'calc(100% - 2.5px - 10px)' : '2px' }} />
                                    </div>
                                </div>

                                <div className={`px-2.5 pb-2 transition-all duration-300 flex-1 flex flex-col justify-center ${!qrSettings.show ? 'pointer-events-none' : ''}`}>
                                    <div className="flex items-center gap-2 pt-1.5 border-t border-[#7B5E43]/10">
                                        <span className="text-[8px] font-bold text-[#7B5E43]/70 w-5">SIZE</span>
                                        <input
                                            type="range" min="5" max="30" value={qrSettings.size}
                                            onClick={(e) => e.stopPropagation()}
                                            onChange={(e) => setQrSettings({ ...qrSettings, size: Number(e.target.value) })}
                                            className="flex-1 h-0.5 bg-[#7B5E43]/20 rounded-lg appearance-none cursor-pointer accent-[#7B5E43]"
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Date Stamp Card */}
                            <div className={`flex-1 transition-all duration-300 rounded-xl border flex flex-col ${dateSettings.show ? 'bg-[#7B5E43]/5 border-[#7B5E43]/30' : 'bg-white/40 border-transparent grayscale brightness-95 opacity-60'}`}>
                                <div className="flex items-center justify-between px-2.5 py-2 cursor-pointer" onClick={() => setDateSettings({ ...dateSettings, show: !dateSettings.show })}>
                                    <div className="flex items-center gap-1.5">
                                        <div className={`p-1 rounded-md transition-colors ${dateSettings.show ? 'bg-[#7B5E43] text-white' : 'bg-gray-400 text-white'}`}>
                                            <Edit2 size={12} />
                                        </div>
                                        <span className={`font-bold text-[10px] ${dateSettings.show ? 'text-[#7B5E43]' : 'text-gray-500'}`}>NGÀY</span>
                                    </div>
                                    <div className={`w-7 h-3.5 rounded-full relative transition-colors ${dateSettings.show ? 'bg-[#7B5E43]' : 'bg-gray-300'}`}>
                                        <div className={`absolute top-0.5 w-2.5 h-2.5 bg-white rounded-full transition-all shadow-sm`} style={{ left: dateSettings.show ? 'calc(100% - 2.5px - 10px)' : '2px' }} />
                                    </div>
                                </div>

                                <div className={`px-2.5 pb-2 transition-all duration-300 flex-1 flex flex-col justify-center gap-1.5 ${!dateSettings.show ? 'pointer-events-none' : ''}`}>
                                    <div className="flex items-center justify-between pt-1.5 border-t border-[#7B5E43]/10">
                                        <span className="text-[8px] font-bold text-[#7B5E43]/70">MÀU</span>
                                        <div className="flex gap-1">
                                            {['#000000', '#ffffff', '#7B5E43', '#e63946', '#457b9d', '#d4af37'].map(color => (
                                                <button
                                                    key={color}
                                                    onClick={(e) => { e.stopPropagation(); setDateSettings(p => ({ ...p, color })) }}
                                                    className={`w-3.5 h-3.5 rounded-full border border-gray-200 transition-transform ${dateSettings.color === color ? 'scale-110 ring-1 ring-[#7B5E43] ring-offset-1' : ''}`}
                                                    style={{ backgroundColor: color }}
                                                />
                                            ))}
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-2">
                                        <span className="text-[8px] font-bold text-[#7B5E43]/70 w-5">SIZE</span>
                                        <input
                                            type="range" min="10" max="40" value={dateSettings.fontSize}
                                            onClick={(e) => e.stopPropagation()}
                                            onChange={(e) => setDateSettings({ ...dateSettings, fontSize: Number(e.target.value) })}
                                            className="flex-1 h-0.5 bg-[#7B5E43]/20 rounded-lg appearance-none cursor-pointer accent-[#7B5E43]"
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Frame Selector */}
                    <div className="flex items-center justify-center w-full gap-4">
                        <button onClick={prevPage} disabled={totalPages <= 1} className="disabled:opacity-20 text-[#7B5E43] text-4xl font-bold p-2">‹</button>
                        <div className="grid grid-cols-5 grid-rows-2 gap-4 min-h-[208px]">
                            {displayedFrames.map((frame) => (
                                <motion.div key={frame.id} onClick={() => handleSelectFrame(frame)}
                                    className={`w-24 h-24 rounded-full border-[4px] cursor-pointer overflow-hidden ${selectedFrame.id === frame.id ? 'border-[#7B5E43]' : 'border-gray-300'}`}
                                    style={{ backgroundColor: frame.color || '#fff' }}
                                >
                                    {(frame.icon_url || frame.url) && (
                                        <img src={frame.icon_url || frame.url} className="w-full h-full object-cover" alt="frame" />
                                    )}
                                </motion.div>
                            ))}
                        </div>
                        <button onClick={nextPage} disabled={totalPages <= 1} className="disabled:opacity-20 text-[#7B5E43] text-4xl font-bold p-2">›</button>
                    </div>

                    <motion.button
                        onClick={handlePrint}
                        disabled={isUploading}
                        className={`bg-[#D5B895] text-white text-xl px-20 py-4 rounded-[2rem] shadow-xl font-bold font-serif uppercase tracking-widest transition-none ${isUploading ? 'opacity-70 cursor-not-allowed' : 'active:scale-95'}`}
                    >
                        {isUploading ? "Đang xử lý..." : "In Ảnh"}
                    </motion.button>
                </div>
            </div>

            {/* Fullscreen block overlay while printing */}
            {isUploading && (
                <div className="absolute inset-0 z-[100] flex items-center justify-center bg-[#FFF8E7]/80 backdrop-blur-md rounded-3xl">
                    <div className="flex flex-col items-center gap-5 bg-white/90 rounded-3xl px-16 py-12 shadow-2xl border border-[#D5B895]/30">
                        {/* Pulsing logo ring */}
                        <div className="relative flex items-center justify-center">
                            <div className="absolute w-24 h-24 rounded-full bg-[#7B5E43]/10 animate-ping" />
                            <div className="w-16 h-16 rounded-full border-4 border-[#D5B895]/30 border-t-[#7B5E43] animate-spin" />
                        </div>
                        <p className="text-[#3F3127] text-2xl font-serif font-bold tracking-widest uppercase mt-2">Đang in ảnh</p>
                        <div className="flex gap-1.5">
                            {[0, 1, 2].map(i => (
                                <div key={i} className="w-2 h-2 rounded-full bg-[#7B5E43]"
                                    style={{ animation: `bounce 1s ease-in-out ${i * 0.2}s infinite` }} />
                            ))}
                        </div>
                        <p className="text-[#7B5E43]/60 text-sm font-medium text-center w-full px-4 leading-relaxed whitespace-nowrap">Vui lòng không chạm vào màn hình</p>
                    </div>
                </div>
            )}

            {errorDialog.show && (
                <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/45 p-6">
                    <div className="w-full max-w-md rounded-3xl border border-[#E7D3B7] bg-white p-7 text-center shadow-2xl">
                        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-50 text-red-500">
                            <AlertCircle size={34} />
                        </div>
                        <h3 className="mb-3 text-2xl font-black text-[#3F3127]">{errorDialog.title}</h3>
                        <p className="mx-auto mb-6 max-w-sm whitespace-pre-line text-base font-semibold leading-relaxed text-[#7B5E43]">
                            {errorDialog.message}
                        </p>
                        <button
                            type="button"
                            onClick={() => setErrorDialog({ show: false, title: '', message: '' })}
                            className="min-h-12 rounded-2xl bg-[#D5B895] px-10 text-base font-extrabold text-white shadow-md active:scale-95"
                        >
                            Đã hiểu
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Edit;
