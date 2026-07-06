import { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react';
import { motion } from 'framer-motion';
import { useWorkflow, setPendingMediaUpload } from '../../context/WorkflowContext';
import axios from 'axios';
import { drawImageCover } from '../../utils/canvasUtils';
import { Monitor, Edit2, ArrowLeft, AlertCircle, Sticker, RotateCw, Trash2 } from 'lucide-react';
import QRCodeStyling from 'qr-code-styling';
import { LAYOUTS } from '../../data/layouts';
import { getDeviceId } from '../../utils/deviceId';

// Cấu hình URL API — dùng chung từ config/api
import { API_URL, CLOUD_API_URL, FRAME_API_URL } from '../../config/api';

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
    // 5 filter beauty (Natural, Soft Pink, Glass Skin, Korean Idol, Studio) được nạp động
    // từ /face-filters/ai-filters.json và chèn vào đây lúc chạy (xem state beautyFilters).
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
    const { nextStep, prevStep, sessionData, updateSessionData, isSessionActive, timeLeft, timedOut, configs } = useWorkflow();
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
    const [beautyFilters, setBeautyFilters] = useState([]); // 5 preset beauty nạp từ JSON
    const [filteredPhotos, setFilteredPhotos] = useState(photos); // Init with original photos

    // Nạp danh sách beauty preset (Natural / Soft Pink / Glass Skin / Korean Idol / Studio).
    useEffect(() => {
        let alive = true;
        import('../../faceFilter/ai/applyBeauty.js')
            .then(({ loadBeautyPresets }) => loadBeautyPresets())
            .then((list) => {
                if (!alive) return;
                setBeautyFilters(list.map((def) => ({ id: def.id, name: def.name, type: 'beauty', def })));
            })
            .catch((e) => console.error('Không tải được beauty preset:', e));
        return () => { alive = false; };
    }, []);

    // Danh sách filter hiển thị = base (Gốc, Đen Trắng) + 5 beauty.
    const allFilters = useMemo(() => [...FILTERS, ...beautyFilters], [beautyFilters]);

    // === STICKER: khách dán icon (từ cloud) lên ảnh khung, tự kéo/phóng/xoay ===
    const [stickerIcons, setStickerIcons] = useState([]);   // icon do admin quản lý
    const [stickers, setStickers] = useState([]);           // {id,url,ratio,x,y,size,rot} (x,y,size theo % khung)
    const [selectedSticker, setSelectedSticker] = useState(null);
    const [stickerPage, setStickerPage] = useState(0);
    const stickerDragRef = useRef(null);
    const stickerSeq = useRef(0);

    // Phân trang sticker: 1 hàng, dùng mũi tên ‹ › giống chọn frame.
    const STICKERS_PER_PAGE = 8;
    const totalStickerPages = Math.max(1, Math.ceil(stickerIcons.length / STICKERS_PER_PAGE));
    const displayedStickers = stickerIcons.slice(stickerPage * STICKERS_PER_PAGE, (stickerPage + 1) * STICKERS_PER_PAGE);
    const nextStickerPage = () => setStickerPage((p) => (p + 1) % totalStickerPages);
    const prevStickerPage = () => setStickerPage((p) => (p - 1 + totalStickerPages) % totalStickerPages);

    useEffect(() => {
        axios.get(`${CLOUD_API_URL}/api/frames?kind=sticker`)
            .then((res) => setStickerIcons(Array.isArray(res.data) ? res.data : []))
            .catch(() => {});
    }, []);

    const addSticker = (icon) => {
        const img = new Image();
        img.onload = () => {
            const ratio = (img.naturalHeight || 1) / (img.naturalWidth || 1);
            const id = `st${++stickerSeq.current}`;
            setStickers((p) => [...p, { id, url: icon.url, ratio, x: 50, y: 45, size: 22, rot: 0 }]);
            setSelectedSticker(id);
        };
        img.src = icon.url;
    };

    const removeSticker = (id) => {
        setStickers((p) => p.filter((s) => s.id !== id));
        setSelectedSticker((cur) => (cur === id ? null : cur));
    };

    const onStickerMove = useCallback((e) => {
        const d = stickerDragRef.current;
        if (!d) return;
        if (d.mode === 'move') {
            const nx = d.x + ((e.clientX - d.sx) / d.w) * 100;
            const ny = d.y + ((e.clientY - d.sy) / d.h) * 100;
            setStickers((p) => p.map((s) => s.id === d.id ? { ...s, x: Math.max(0, Math.min(100, nx)), y: Math.max(0, Math.min(100, ny)) } : s));
        } else {
            const dx = e.clientX - d.cx, dy = e.clientY - d.cy;
            const dist = Math.hypot(dx, dy);
            const diag = Math.sqrt(1 + d.ratio * d.ratio);
            const size = Math.max(4, Math.min(140, (2 * dist) / (d.w * diag) * 100));
            const rot = Math.atan2(dy, dx) * 180 / Math.PI - 45;
            setStickers((p) => p.map((s) => s.id === d.id ? { ...s, size, rot } : s));
        }
    }, []);

    const onStickerUp = useCallback(() => {
        stickerDragRef.current = null;
        window.removeEventListener('pointermove', onStickerMove);
        window.removeEventListener('pointerup', onStickerUp);
    }, [onStickerMove]);

    const startStickerDrag = (e, s, mode) => {
        e.stopPropagation();
        setSelectedSticker(s.id);
        const rect = captureRef.current.getBoundingClientRect();
        if (mode === 'move') {
            stickerDragRef.current = { mode, id: s.id, sx: e.clientX, sy: e.clientY, x: s.x, y: s.y, w: rect.width, h: rect.height };
        } else {
            stickerDragRef.current = { mode, id: s.id, cx: rect.left + (s.x / 100) * rect.width, cy: rect.top + (s.y / 100) * rect.height, w: rect.width, ratio: s.ratio };
        }
        window.addEventListener('pointermove', onStickerMove);
        window.addEventListener('pointerup', onStickerUp);
    };
    const [frames, setFrames] = useState([]);
    // Đã tải xong danh sách frame + áp frame mặc định chưa? Dùng để CHẶN nút In cho tới lúc đó,
    // tránh race "chụp xong ấn in luôn" khi selectedFrame còn = 'none' -> in/album mất frame.
    const [framesLoaded, setFramesLoaded] = useState(false);
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

    // Vuốt cảm ứng kéo trái/phải để đổi trang frame (vẫn giữ mũi tên ‹ ›). dragged: chặn chọn
    // nhầm frame khi thả tay sau khi vuốt.
    const frameSwipeRef = useRef({ x: 0, dragged: false });
    const onFrameSwipeStart = (e) => { frameSwipeRef.current = { x: e.touches[0].clientX, dragged: false }; };
    const onFrameSwipeMove = (e) => {
        if (Math.abs(e.touches[0].clientX - frameSwipeRef.current.x) > 10) frameSwipeRef.current.dragged = true;
    };
    const onFrameSwipeEnd = (e) => {
        if (totalPages <= 1) return;
        const dx = e.changedTouches[0].clientX - frameSwipeRef.current.x;
        if (Math.abs(dx) > 50) {
            if (dx < 0) nextPage();   // vuốt sang trái -> trang sau
            else prevPage();          // vuốt sang phải -> trang trước
        }
    };

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
                    // CHỜ áp xong frame mặc định (gồm cả config ô) rồi mới cho phép In -> ảnh in
                    // luôn có frame dù khách bấm in ngay.
                    await handleSelectFrame(allFrames[0]);
                }
            } catch (error) {
                console.error("Error fetching frames:", error);
                setFrames([]);
            } finally {
                setFramesLoaded(true); // cho phép In (có frame hoặc layout không có frame nào)
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

            // Beauty Filters (xử lý ngay trên máy: nhận diện mặt + warp + làm đẹp)
            if (selectedFilter.type === 'beauty') {
                setIsFiltering(true);
                try {
                    const { applyBeautyToImage } = await import('../../faceFilter/ai/applyBeauty.js');
                    const filtered = await mapWithConcurrency(photos, 1, async (photoSrc) => {
                        if (!photoSrc) return null;
                        const cacheKey = `${selectedFilter.id}:${photoSrc}`;
                        if (filterCacheRef.current.has(cacheKey)) return filterCacheRef.current.get(cacheKey);
                        try {
                            const url = await applyBeautyToImage(photoSrc, selectedFilter.def);
                            filterCacheRef.current.set(cacheKey, url);
                            return url;
                        } catch (e) {
                            console.error('Beauty filter error', e);
                            return photoSrc;
                        }
                    });
                    if (isMounted && filterRunRef.current === runId) setFilteredPhotos(filtered);
                } finally {
                    if (isMounted && filterRunRef.current === runId) setIsFiltering(false);
                }
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
        if (timedOut && !isPrintingRef.current) {
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
    }, [timedOut, frames]);


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
        const container = captureRef.current;
        if (!container) return;

        // Support both mouse and touch
        const getClientPos = (evt) => {
            if (evt.touches && evt.touches.length > 0) return { x: evt.touches[0].clientX, y: evt.touches[0].clientY };
            if (evt.changedTouches && evt.changedTouches.length > 0) return { x: evt.changedTouches[0].clientX, y: evt.changedTouches[0].clientY };
            return { x: evt.clientX, y: evt.clientY };
        };

        // Lệch giữa ngón tay và TÂM của QR/ngày lúc bắt đầu kéo -> giữ điểm cầm cố định dưới ngón
        // tay (không nhảy tâm về ngón tay khi chạm).
        const startPos = getClientPos(e);
        const startRect = container.getBoundingClientRect();
        const cur = type === 'qr' ? qrSettings : dateSettings;
        const offX = startPos.x - (startRect.left + (cur.x / 100) * startRect.width);
        const offY = startPos.y - (startRect.top + (cur.y / 100) * startRect.height);

        const moveHandler = (moveEvent) => {
            // Chặn cuộn trang/cử chỉ mặc định khi đang kéo -> hết giật, vị trí không lệch.
            if (moveEvent.cancelable) moveEvent.preventDefault();
            const pos = getClientPos(moveEvent);
            const rect = container.getBoundingClientRect(); // đọc lại mỗi lần -> đúng kể cả khi layout đổi
            let newX = ((pos.x - offX - rect.left) / rect.width) * 100;
            let newY = ((pos.y - offY - rect.top) / rect.height) * 100;

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

    // scale: hệ số phóng so với cỡ in native 1200x1800 (300 DPI). Nguồn (baseCanvas) render ở
    // cùng hệ số nên mọi drawImage là 1:1 (không nội suy thừa); backend sẽ LANCZOS thu nhỏ về
    // đúng pixel máy in -> supersampling, nét hơn. Truyền scale=1 giữ nguyên hành vi cũ.
    const buildPrintCanvas = (sourceCanvas, printMode = 'grid_4x6', scale = 1) => {
        const S = scale;
        const canvas = document.createElement('canvas');
        canvas.width = 1200 * S;
        canvas.height = 1800 * S;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        if (printMode === 'double_strip') {
            // Strip gốc là 600x1800 (tỉ lệ 1:3), đúng bằng mỗi nửa của giấy 4x6 (600x1800).
            // Vẽ tràn lề để GIỮ NGUYÊN tỉ lệ 1:3 và bỏ viền trắng thừa.
            ctx.drawImage(sourceCanvas, 0, 0, 600 * S, 1800 * S);
            ctx.drawImage(sourceCanvas, 600 * S, 0, 600 * S, 1800 * S);
            return { canvas, cutMode: '2x6' };
        }

        if (printMode === 'single_strip') {
            // Căn giữa 1 strip 600x1800 trên giấy 1200x1800, giữ nguyên tỉ lệ 1:3.
            ctx.drawImage(sourceCanvas, 300 * S, 0, 600 * S, 1800 * S);
            return { canvas, cutMode: 'none' };
        }

        if (printMode === 'double_strip_horizontal') {
            // Strip ngang gốc 1800x600 (6"x2", 3 ô). In 2 BẢN GIỐNG HỆT chồng dọc trên giấy 4x6
            // NẰM NGANG (1800x1200). Backend xoay 90° cho khớp giấy -> đường chia ngang giữa 2
            // strip thành đường dọc chính giữa tờ, đúng vị trí dao 2-inch cắt -> ra 2 strip y hệt.
            canvas.width = 1800 * S;
            canvas.height = 1200 * S;
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(sourceCanvas, 0, 0, 1800 * S, 600 * S);
            ctx.drawImage(sourceCanvas, 0, 600 * S, 1800 * S, 600 * S);
            return { canvas, cutMode: '2x6' };
        }

        // grid_4x6: khớp hướng giấy theo hướng ảnh ghép. Layout ngang (vd Layout 5)
        // phải in landscape lấp đầy 4x6, không letterbox vào khung dọc -> hết viền trắng to.
        // (Backend tự xoay 90° cho khớp hướng giấy của máy in.)
        if (sourceCanvas.width > sourceCanvas.height) {
            canvas.width = 1800 * S;
            canvas.height = 1200 * S;
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
        }
        drawImageContain(ctx, sourceCanvas, 0, 0, canvas.width, canvas.height);
        return { canvas, cutMode: 'none' };
    };

    // Chỉnh màu in ĐÃ chuyển sang backend (áp lúc gửi máy in, đọc config mới nhất mỗi lần) ->
    // in lại cũng theo slider hiện tại. Frontend không còn nung màu vào file in nữa.

    const handlePrint = async () => {
        if (isUploading) return;
        setIsUploading(true);

        try {
            // 1. Generate Session ID (UUID v4) frontend-side for QR Code.
            // Không dùng Math.random (dễ TRÙNG -> UUID đụng nhau -> IntegrityError 500 khi
            // tạo Session sau khi đã thu tiền). Fallback dùng crypto.getRandomValues.
            const genUuid = () => {
                if (window.crypto && typeof window.crypto.randomUUID === 'function') {
                    return window.crypto.randomUUID();
                }
                const b = new Uint8Array(16);
                window.crypto.getRandomValues(b);
                b[6] = (b[6] & 0x0f) | 0x40; // version 4
                b[8] = (b[8] & 0x3f) | 0x80; // variant
                const h = Array.from(b, (x) => x.toString(16).padStart(2, '0'));
                return `${h[0]}${h[1]}${h[2]}${h[3]}-${h[4]}${h[5]}-${h[6]}${h[7]}-${h[8]}${h[9]}-${h[10]}${h[11]}${h[12]}${h[13]}${h[14]}${h[15]}`;
            };
            const sessionId = genUuid();
            const albumBaseUrl = CLOUD_API_URL || window.location.origin;
            const downloadUrl = `${albumBaseUrl}/album/${sessionId}`;

            // 2. Setup Canvas
            // RENDER_SCALE: render composite ở ĐỘ PHÂN GIẢI CAO hơn cỡ in native (1200x1800 = 300
            // DPI của máy DNP). Gửi bản phóng xuống backend -> backend LANCZOS thu nhỏ (supersampling)
            // về đúng pixel máy in -> nét & mịn hơn, bù độ mềm cố hữu của máy dye-sub. Ảnh album QR
            // dùng chung baseCanvas này nên nét cao theo. Đổi 1 chỗ, áp cho cả in lẫn album.
            // 1.5 = cân bằng chất lượng/RAM cho máy yếu (i3, 8GB, GPU tích hợp). Máy mạnh (16GB+)
            // có thể nâng lên 2 để nét tối đa; >2 gần như không cải thiện thêm mà tốn RAM.
            const RENDER_SCALE = 1.5;
            const baseCanvas = document.createElement('canvas');
            const TARGET_HEIGHT = 1800 * RENDER_SCALE;
            const isStrip = layout.type === 'strip';
            const isStripHorizontal = layout.type === 'strip_horizontal';
            const isHorizontal = layout.type && layout.type.includes('horizontal');
            if (isStripHorizontal) {
                // 1 strip NGANG = 6"x2" -> 1800x600 (3 ô hàng ngang). Sẽ in 2 bản chồng nhau
                // ở buildPrintCanvas -> cắt ngang ra 2 strip GIỐNG HỆT.
                baseCanvas.width = 1800 * RENDER_SCALE;
                baseCanvas.height = 600 * RENDER_SCALE;
            } else {
                const ratio = isStrip ? 1 / 3 : (isHorizontal ? 3 / 2 : 2 / 3);
                baseCanvas.height = TARGET_HEIGHT;
                baseCanvas.width = TARGET_HEIGHT * ratio;
            }

            const baseCtx = baseCanvas.getContext('2d');
            // Ảnh R100 rất lớn (6000x4000) bị thu nhỏ ~10x vào ô -> BẮT BUỘC dùng nội suy chất
            // lượng cao, nếu không trình duyệt mặc định 'low' (bilinear 1 bước) gây răng cưa/rỗ
            // pixel ("vỡ nét") dính vào cả ảnh QR album lẫn ảnh in (đều lấy từ baseCanvas này).
            baseCtx.imageSmoothingEnabled = true;
            baseCtx.imageSmoothingQuality = 'high';

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

                // 6. Draw Stickers (dán lên ảnh khung — bake vào cả ảnh in lẫn ảnh album)
                for (const st of stickers) {
                    const stImg = await cachedLoadImage(st.url);
                    if (!stImg) continue;
                    const w = (st.size / 100) * targetCanvas.width;
                    const h = w * st.ratio;
                    targetCtx.save();
                    targetCtx.translate((st.x / 100) * targetCanvas.width, (st.y / 100) * targetCanvas.height);
                    targetCtx.rotate((st.rot * Math.PI) / 180);
                    targetCtx.drawImage(stImg, -w / 2, -h / 2, w, h);
                    targetCtx.restore();
                }
            };

            // Draw photos + frame (clean version, no QR/date)
            await drawComposite(baseCanvas, baseCtx);

            // Ảnh album QR = bản composite SẠCH (chưa QR/date). baseCanvas đã render ở độ phân
            // giải cao (RENDER_SCALE) nên album nét cao theo. TÔ NỀN TRẮNG trước rồi vẽ baseCanvas
            // lên: với frame ảnh PNG, nền baseCanvas trong suốt -> xuất JPEG sẽ thành ĐEN nếu không
            // tô trắng. Tô trắng cho khớp bản in (buildPrintCanvas cũng nền trắng).
            const cleanCanvas = document.createElement('canvas');
            cleanCanvas.width = baseCanvas.width;
            cleanCanvas.height = baseCanvas.height;
            const cleanCtx = cleanCanvas.getContext('2d');
            cleanCtx.imageSmoothingEnabled = true;
            cleanCtx.imageSmoothingQuality = 'high';
            cleanCtx.fillStyle = '#ffffff';
            cleanCtx.fillRect(0, 0, cleanCanvas.width, cleanCanvas.height);
            cleanCtx.drawImage(baseCanvas, 0, 0);

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
                        width: 1000,
                        height: 1000,
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
            const printOutput = buildPrintCanvas(baseCanvas, printMode, RENDER_SCALE);
            const printCanvas = printOutput.canvas;
            const cutMode = printOutput.cutMode;
            const compositeCanvas = cleanCanvas;
            // Màu in giờ được áp ở BACKEND lúc gửi máy in (đọc config mới nhất mỗi lần) -> in
            // lại cũng theo slider hiện tại, màu KHÔNG bị đóng băng vào file. Ở đây gửi ảnh in
            // GIỮ MÀU GỐC.
            const printBlob = await canvasToBlob(printCanvas, 'image/png');

            // === IN TRƯỚC, UPLOAD CLOUD SAU ===
            // Gửi lệnh in NGAY khi có ảnh in, KHÔNG chờ upload composite/ảnh gốc/tạo session
            // (các bước cloud có thể vài giây) -> máy in bắt đầu in liền, khách không phải đợi.
            const selectedPrintQuantity = Math.max(1, parseInt(sessionData.printQuantity, 10) || 1);
            const printerCopies = (printMode === 'double_strip' || printMode === 'double_strip_horizontal')
                ? Math.max(1, Math.ceil(selectedPrintQuantity / 2))
                : selectedPrintQuantity;
            try {
                const printResult = await sendToPrinter(printBlob, printerCopies, { printMode, cutMode, sessionId });
                console.log('Print job queued:', printResult);
            } catch (printError) {
                const data = printError.response?.data;
                const available = data?.available_printers?.length
                    ? ` Máy in hiện có: ${data.available_printers.join(', ')}.`
                    : '';
                const message = data?.error || printError.message || 'Không thể gửi ảnh sang máy in.';
                setErrorDialog({ show: true, title: 'Không thể in ảnh', message: `${message}${available}` });
            }

            // 8. Upload & Create Session (chạy SAU khi đã gửi lệnh in)
            compositeCanvas.toBlob(async (blob) => {
                if (!blob || !printBlob) { setIsUploading(false); return; }
                try {
                    const compositeData = await uploadFile(blob);
                    const compositeUrl = compositeData.url;
                    const compositePublicId = compositeData.public_id;

                    // Session phải được tạo ở cùng nơi mà QR album và trang doanh thu đọc
                    // (CLOUD_API_URL). Nếu chỉ lưu local thì quét QR / xem doanh thu sẽ không thấy.
                    const sessionBaseUrl = CLOUD_API_URL || API_URL;
                    const metaData = {
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
                    };
                    const buildSessionPayload = (photosArr) => ({
                        layout_id: layout.id || 'strip_4',
                        composite_url: compositeUrl,
                        composite_public_id: compositePublicId,
                        photos: photosArr,
                        payment_method: sessionData.paymentMethod || 'cash',
                        amount: sessionData.printPrice || 60000,
                        session_id: sessionId, // Gửi UUID frontend xuống backend để lưu
                        meta_data: metaData,
                    });

                    // 1) Tạo session NGAY với ảnh ghép (composite) -> album có ảnh để quét QR LIỀN,
                    //    KHÔNG phải chờ upload ảnh gốc + video motion (webm nặng) ở nền.
                    await axios.post(`${sessionBaseUrl}/api/sessions`, buildSessionPayload([]));

                    updateSessionData('finalImage', compositeUrl);
                    // Giữ NGUYÊN sessionId do FE tạo (đã vẽ vào QR + dùng cho PrintJob local).
                    updateSessionData('sessionId', sessionId);
                    nextStep(); // -> Result hiện QR ngay, không chờ video

                    // 2) Upload ảnh gốc + video motion Ở NỀN rồi cập nhật lại session (upsert cùng
                    //    uuid) -> album bổ sung ảnh lẻ + motion khi tải xong. KHÔNG chặn QR.
                    //    Đăng ký promise để resetSession chờ nó xong trước khi reload (không mất ảnh).
                    const rawSource = sessionData.photos || [];
                    const bgUpload = mapWithConcurrency(photos, 2, async (photoUrl, index) => {
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
                    })
                        .then((uploadedPhotos) => axios.post(`${sessionBaseUrl}/api/sessions`, buildSessionPayload(uploadedPhotos.filter(Boolean))))
                        .catch((bgErr) => console.error('Cập nhật ảnh gốc/video ở nền thất bại:', bgErr));
                    setPendingMediaUpload(bgUpload);
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
            }, 'image/jpeg', 0.95); // JPEG 95%: ảnh album 2400x3600 vẫn nhẹ hơn PNG cũ -> QR hiện nhanh

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
                <div className="w-5/12 flex items-center justify-center p-8 bg-[#F6E6C9]/55 rounded-3xl ml-4" onPointerDown={() => setSelectedSticker(null)}>
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
                            aspectRatio: layout.type === 'strip' ? '1/3' : (layout.type === 'strip_horizontal' ? '3/1' : (layout.type?.includes('horizontal') ? '3/2' : '2/3')),
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

                        {/* 2b. Sticker Layer (khách kéo/phóng/xoay) */}
                        {stickers.map((s) => (
                            <div
                                key={s.id}
                                onPointerDown={(e) => startStickerDrag(e, s, 'move')}
                                className="absolute z-40 cursor-move touch-none"
                                style={{ left: `${s.x}%`, top: `${s.y}%`, width: `${s.size}%`, transform: `translate(-50%, -50%) rotate(${s.rot}deg)` }}
                            >
                                <img src={s.url} crossOrigin="anonymous" className="pointer-events-none block w-full select-none" draggable={false} alt="sticker" />
                                {selectedSticker === s.id && (
                                    <>
                                        <span className="pointer-events-none absolute inset-0 rounded ring-2 ring-[#e63946]/70" />
                                        <button
                                            type="button"
                                            onPointerDown={(e) => { e.stopPropagation(); removeSticker(s.id); }}
                                            className="absolute -left-3 -top-3 flex h-7 w-7 items-center justify-center rounded-full bg-red-500 text-white shadow"
                                        ><Trash2 size={13} /></button>
                                        <button
                                            type="button"
                                            onPointerDown={(e) => startStickerDrag(e, s, 'transform')}
                                            className="absolute -bottom-3 -right-3 flex h-7 w-7 items-center justify-center rounded-full bg-[#987351] text-white shadow touch-none"
                                        ><RotateCw size={13} /></button>
                                    </>
                                )}
                            </div>
                        ))}

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
                                    transform: 'translate(-50%, -50%)',
                                    touchAction: 'none'
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
                                    touchAction: 'none',
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
                            {allFilters.map((filter) => (
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

                    {/* Sticker palette — thẻ cùng phong cách với khối filter/QR phía trên */}
                    <div className="w-full max-w-4xl bg-[#F6E6C9]/70 p-4 rounded-[2rem] shadow-sm">
                        <div className="flex items-center gap-2 mb-3">
                            <div className="p-1 rounded-md bg-[#7B5E43] text-white">
                                <Sticker size={12} />
                            </div>
                            <span className="font-bold text-[10px] uppercase tracking-wide text-[#7B5E43]">Sticker</span>
                            <span className="text-[10px] text-[#7B5E43]/60">· chạm để thêm · kéo di chuyển · nắm góc để xoay / phóng to</span>
                            {stickerIcons.length > 0 && (
                                <span className="ml-auto rounded-full bg-[#7B5E43]/10 px-2 py-0.5 text-[10px] font-bold text-[#7B5E43]">{stickerIcons.length}</span>
                            )}
                        </div>
                        {stickerIcons.length === 0 ? (
                            <p className="text-[11px] text-gray-400 px-1 py-1">Chưa có sticker. Thêm ở Admin → Quản lý khung hình → Icons.</p>
                        ) : (
                            // 1 HÀNG + mũi tên ‹ › phân trang (giống chọn frame), nút vuông giữ nguyên.
                            <div className="flex items-center justify-center gap-2">
                                <button type="button" onClick={prevStickerPage} disabled={totalStickerPages <= 1} className="shrink-0 p-1 text-3xl font-bold text-[#7B5E43] disabled:opacity-20">‹</button>
                                <div className="flex flex-1 justify-center gap-2.5">
                                    {displayedStickers.map((icon) => (
                                        <button
                                            key={icon.id}
                                            type="button"
                                            onClick={() => addSticker(icon)}
                                            title={icon.name}
                                            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-[#E7D3B7] bg-white p-1.5 shadow-sm transition-colors hover:border-[#7B5E43]/50 active:scale-95"
                                        >
                                            <img src={icon.url} alt={icon.name} className="max-h-full max-w-full object-contain" />
                                        </button>
                                    ))}
                                </div>
                                <button type="button" onClick={nextStickerPage} disabled={totalStickerPages <= 1} className="shrink-0 p-1 text-3xl font-bold text-[#7B5E43] disabled:opacity-20">›</button>
                            </div>
                        )}
                    </div>

                    {/* Frame Selector */}
                    <div
                        className="flex items-center justify-center w-full gap-4"
                        style={{ touchAction: 'pan-y' }}
                        onTouchStart={onFrameSwipeStart}
                        onTouchMove={onFrameSwipeMove}
                        onTouchEnd={onFrameSwipeEnd}
                    >
                        <button onClick={prevPage} disabled={totalPages <= 1} className="disabled:opacity-20 text-[#7B5E43] text-4xl font-bold p-2">‹</button>
                        <div className="grid grid-cols-5 grid-rows-2 gap-4 min-h-[208px]">
                            {displayedFrames.map((frame) => (
                                <motion.div key={frame.id} onClick={() => { if (frameSwipeRef.current.dragged) return; handleSelectFrame(frame); }}
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
                        disabled={isUploading || !framesLoaded}
                        className={`bg-[#D5B895] text-white text-xl px-20 py-4 rounded-[2rem] shadow-xl font-bold font-serif uppercase tracking-widest transition-opacity duration-300 ${isUploading ? 'opacity-70 cursor-not-allowed' : (!framesLoaded ? 'opacity-40 cursor-not-allowed' : 'active:scale-95')}`}
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
