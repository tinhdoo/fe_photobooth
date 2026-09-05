import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { X, Save, RotateCw, RefreshCw, Copy, Clipboard, Wand2, CheckCircle, XCircle, Palette, Pipette, Loader2 } from 'lucide-react';
import { LAYOUTS } from '../../data/layouts';
import { motion, AnimatePresence } from 'framer-motion';
import { detectFrameSlots, analyzeColorFrame, samplePixelColor } from '../../utils/frameDetection';
import { makeThumbnailBlob } from '../../utils/imageThumb';
import ConfirmDialog from './ConfirmDialog';

import { FRAME_API_URL } from '../../config/api';
const frameApiPath = (path) => `${FRAME_API_URL}${path}`;

const FrameConfigEditor = ({ frame, onClose }) => {
    const handleCopyConfig = () => {
        localStorage.setItem('ptb_frame_clipboard', JSON.stringify(config));
        setNotification({ show: true, message: "Đã sao chép cấu hình vào bộ nhớ tạm!", type: 'success' });
    };

    const handlePasteConfig = () => {
        const saved = localStorage.getItem('ptb_frame_clipboard');
        if (!saved) {
            setNotification({ show: true, message: "Bộ nhớ tạm trống!", type: 'error' });
            return;
        }
        try {
            const parsed = JSON.parse(saved);
            if (parsed && Array.isArray(parsed.boxes)) {
                if (parsed.boxes.length !== layoutDef.photoCount) {
                    setConfirmDialog({
                        isOpen: true,
                        title: 'Dán cấu hình?',
                        message: `Số lượng ảnh không khớp. Đã sao chép: ${parsed.boxes.length}, hiện tại: ${layoutDef.photoCount}. Bạn vẫn muốn dán?`,
                        confirmText: 'Dán',
                        type: 'info',
                        onConfirm: () => {
                            setConfig(parsed);
                            setSelectedBoxIndices([]);
                            setNotification({ show: true, message: "Dán cấu hình thành công!", type: 'success' });
                            closeConfirmDialog();
                        },
                    });
                    return;
                }
                setConfig(parsed);
                setSelectedBoxIndices([]);
                setNotification({ show: true, message: "Dán cấu hình thành công!", type: 'success' });
            } else {
                setNotification({ show: true, message: "Dữ liệu cấu hình trong bộ nhớ tạm không hợp lệ.", type: 'error' });
            }
        } catch (e) {
            console.error(e);
            setNotification({ show: true, message: "Không thể phân tích dữ liệu từ bộ nhớ tạm.", type: 'error' });
        }
    };
    // boxes: Array of { x, y, width, height, rotation } in Percentages (except rotation is deg)
    const [config, setConfig] = useState({
        borderRadius: 0,
        boxes: []
    });
    const [selectedBoxIndices, setSelectedBoxIndices] = useState([]);
    const [notification, setNotification] = useState({ show: false, message: '', type: 'success' });
    const [confirmDialog, setConfirmDialog] = useState({
        isOpen: false,
        title: '',
        message: '',
        confirmText: 'Xác nhận',
        type: 'info',
        onConfirm: null,
    });
    const containerRef = useRef(null);
    const dragState = useRef(null);
    const hasDragged = useRef(false);

    // --- Chế độ dò ô ---
    const [detectMode, setDetectMode] = useState('transparent'); // 'transparent' | 'color'
    const [markerColor, setMarkerColor] = useState('#E6007E');   // màu đánh dấu ô (hồng độc)
    const [tolerance, setTolerance] = useState(30);              // dung sai màu 0..100
    const [sampling, setSampling] = useState(false);            // đang hút màu từ ảnh
    const [busy, setBusy] = useState(false);
    // Ảnh khung dùng để HIỂN THỊ overlay: đổi sang bản đã đục lỗ (blob) sau khi dò màu.
    const [overlayUrl, setOverlayUrl] = useState(frame.url);
    // Blob overlay đã đục lỗ chờ lưu (chỉ ghi đè lên server khi bấm Lưu).
    const punchedBlobRef = useRef(null);
    // Giữ URL ảnh GỐC (còn màu) để dò/hút màu lại được kể cả sau khi preview đã đục lỗ.
    const originalUrlRef = useRef(frame.url);

    const layoutDef = LAYOUTS.find(l => l.id === frame.layout) || LAYOUTS[0];

    const closeConfirmDialog = () => {
        setConfirmDialog(prev => ({ ...prev, isOpen: false }));
    };

    // Helper to calculate default grid positions (in %)
    const getDefaultBoxes = () => {
        const boxes = [];
        const gap = 2; // 2% gap
        const totalW = 100;
        const totalH = 100;

        // Bounds for each cell
        const cellW = (totalW - (gap * (layoutDef.cols + 1))) / layoutDef.cols;
        const cellH = (totalH - (gap * (layoutDef.rows + 1))) / layoutDef.rows;

        for (let i = 0; i < layoutDef.photoCount; i++) {
            const row = Math.floor(i / layoutDef.cols);
            const col = i % layoutDef.cols;

            // Force 3:2 Aspect Ratio (1.5)
            // Try fitting by width first
            let width = cellW;
            let height = width / 1.5;

            // If height exceeds cell height, fit by height
            if (height > cellH) {
                height = cellH;
                width = height * 1.5;
            }

            // Center in cell
            const x = gap + col * (cellW + gap) + (cellW - width) / 2;
            const y = gap + row * (cellH + gap) + (cellH - height) / 2;

            boxes.push({
                x, y,
                width, height,
                rotation: 0
            });
        }
        return boxes;
    };

    useEffect(() => {
        const fetchConfig = async () => {
            try {
                const res = await axios.get(frameApiPath('/api/frames'), {
                    params: { layout: frame.layout, name: frame.name, resource: 'config' }
                });
                // Check if current config matches new structure (has boxes)
                if (res.data && res.data.boxes && res.data.boxes.length > 0) {
                    setConfig(prev => ({ ...prev, ...res.data }));
                } else {
                    // Initialize default boxes
                    setConfig({ borderRadius: 0, boxes: getDefaultBoxes() });
                }
            } catch (error) {
                console.error("Error fetching config:", error);
                setConfig({ borderRadius: 0, boxes: getDefaultBoxes() });
            }
        };
        fetchConfig();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [frame]);

    // Dọn blob URL preview (overlay đã đục lỗ) khi đóng editor.
    useEffect(() => {
        return () => {
            if (overlayUrl && overlayUrl.startsWith('blob:')) URL.revokeObjectURL(overlayUrl);
        };
    }, [overlayUrl]);

    const handleSave = async () => {
        try {
            setBusy(true);
            // Chế độ màu: ghi ĐÈ ảnh khung bằng bản đã đục lỗ TRƯỚC khi lưu cấu hình,
            // để luồng chạy sau (Edit/Capture/In) thấy khung đã trong suốt.
            if (punchedBlobRef.current) {
                const fd = new FormData();
                fd.append('file', punchedBlobRef.current, 'overlay.png');
                await axios.post(
                    frameApiPath(`/api/frames?resource=overlay&layout=${encodeURIComponent(frame.layout)}&name=${encodeURIComponent(frame.name)}`),
                    fd
                );
                // Tạo LẠI thumbnail từ bản đã đục lỗ, nếu không grid vẫn hiện ảnh MÀU cũ.
                try {
                    const thumbBlob = await makeThumbnailBlob(punchedBlobRef.current);
                    const tf = new FormData();
                    tf.append('file', thumbBlob, 'thumb.png');
                    await axios.post(
                        frameApiPath(`/api/frames?resource=thumb&layout=${encodeURIComponent(frame.layout)}&name=${encodeURIComponent(frame.name)}`),
                        tf
                    );
                } catch (thumbErr) {
                    console.warn('Không tạo lại được thumbnail sau khi đục lỗ:', thumbErr);
                }
            }
            await axios.post(frameApiPath('/api/frames'), config, {
                params: { layout: frame.layout, name: frame.name, resource: 'config' }
            });
            setNotification({ show: true, message: "Lưu cấu hình thành công!", type: 'success' });
            setTimeout(() => onClose(), 1500); // Close after showing success message
        } catch (error) {
            console.error("Error saving config:", error);
            setNotification({ show: true, message: "Lưu cấu hình thất bại", type: 'error' });
        } finally {
            setBusy(false);
        }
    };

    const handleBoxChange = (index, key, value) => {
        const newBoxes = [...config.boxes];
        newBoxes[index] = { ...newBoxes[index], [key]: parseFloat(value) || 0 };
        setConfig({ ...config, boxes: newBoxes });
    };

    // --- DRAG LOGIC ---
    const handleDragStart = (e, index, mode) => {
        e.stopPropagation();
        hasDragged.current = false;

        // Multi-select logic
        let newSelection = [...selectedBoxIndices];
        if (e.shiftKey || e.ctrlKey || e.metaKey) {
            if (newSelection.includes(index)) {
                newSelection = newSelection.filter(i => i !== index);
            } else {
                newSelection.push(index);
            }
        } else {
            // If dragging an already selected item in a group, DON'T drop the group selection
            if (!newSelection.includes(index)) {
                newSelection = [index];
            }
            // Note: If clicking a single item without shift, the normal onClick handle will select just it.
            // That happens when you release the mouse button without dragging.
        }
        setSelectedBoxIndices(newSelection);

        // If the clicked box was deselected (e.g. shift-clicked out of a group), don't drag
        if (!newSelection.includes(index)) return;

        const rect = containerRef.current.getBoundingClientRect();

        // Handle both mouse and touch start
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;

        dragState.current = {
            startX: clientX,
            startY: clientY,
            startBoxes: newSelection.map(idx => ({ ...config.boxes[idx], originalIndex: idx })),
            containerW: rect.width,
            containerH: rect.height,
            mode, // 'move', 'resize-se', 'rotate'
            primaryIndex: index
        };

        window.addEventListener('mousemove', handleDragMove);
        window.addEventListener('mouseup', handleDragEnd);
        window.addEventListener('touchmove', handleDragMove, { passive: false });
        window.addEventListener('touchend', handleDragEnd);
    };

    const handleDragMove = (e) => {
        if (!dragState.current || !containerRef.current) return;

        // Handle both mouse and touch
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;

        // Prevent scrolling on mobile while dragging
        if (e.touches && e.cancelable) {
            e.preventDefault();
        }

        const { startX, startY, startBoxes, containerW, containerH, mode, primaryIndex } = dragState.current;

        const dxPx = clientX - startX;
        const dyPx = clientY - startY;

        // Mark as dragged if we move more than 3 pixels
        if (Math.abs(dxPx) > 3 || Math.abs(dyPx) > 3) {
            hasDragged.current = true;
        }

        // Prevent micro-movements on click from causing jumps (only for mouse usually)
        if (!e.touches && mode !== 'move' && Math.abs(dxPx) < 3 && Math.abs(dyPx) < 3) return;

        // Convert GLOBAL delta to PERCENTAGE delta
        const dx = (dxPx / containerW) * 100;
        const dy = (dyPx / containerH) * 100;

        const newBoxes = [...config.boxes];

        startBoxes.forEach(startBox => {
            let newBox = { ...startBox };
            const idx = startBox.originalIndex;

            if (mode === 'move') {
                newBox.x = startBox.x + dx;
                newBox.y = startBox.y + dy;
            } else if (mode.startsWith('resize')) {
                // Handle Rotation for Resize Directions
                // We need to project the global mouse delta onto the box's LOCAL axis
                const rad = (startBox.rotation * Math.PI) / 180;
                const sin = Math.sin(rad);
                const cos = Math.cos(rad);

                // Rotate the PIXEL delta vector to alignment with box
                const localDxPx = dxPx * cos + dyPx * sin;
                const localDyPx = -dxPx * sin + dyPx * cos;

                // Convert local pixels to percentages (Size is relative to container)
                const localDx = (localDxPx / containerW) * 100;
                const localDy = (localDyPx / containerH) * 100;

                // Ratio Lock
                const ratio = startBox.width / startBox.height;

                if (mode === 'resize-se') {
                    if (Math.abs(localDxPx) > Math.abs(localDyPx)) {
                        let newW = startBox.width + localDx;
                        newBox.width = Math.max(1, newW);
                        newBox.height = newBox.width / ratio;
                    } else {
                        let newH = startBox.height + localDy;
                        newBox.height = Math.max(1, newH);
                        newBox.width = newBox.height * ratio;
                    }
                }
            } else if (mode === 'rotate') {
                // Calculate angle based on primary handle
                const primaryBox = startBoxes.find(b => b.originalIndex === primaryIndex);
                if (primaryBox && idx === primaryIndex) {
                    const cx = (primaryBox.x + primaryBox.width / 2) / 100 * containerW;
                    const cy = (primaryBox.y + primaryBox.height / 2) / 100 * containerH;

                    const containerRect = containerRef.current.getBoundingClientRect();
                    const absCx = containerRect.left + cx;
                    const absCy = containerRect.top + cy;

                    const radians = Math.atan2(clientY - absCy, clientX - absCx);
                    let deg = radians * (180 / Math.PI);

                    newBox.rotation = deg + 90;
                }
            }
            newBoxes[idx] = newBox;
        });

        setConfig({ ...config, boxes: newBoxes });
    };

    const handleDragEnd = () => {
        dragState.current = null;
        window.removeEventListener('mousemove', handleDragMove);
        window.removeEventListener('mouseup', handleDragEnd);
        window.removeEventListener('touchmove', handleDragMove);
        window.removeEventListener('touchend', handleDragEnd);
    };

    const handleAutoDetect = async () => {
        setConfirmDialog({
            isOpen: true,
            title: 'Tự động phát hiện?',
            message: detectMode === 'color'
                ? `Sẽ dò các vùng tô màu ${markerColor} làm ô ảnh, tự đục lỗ trong suốt và thay thế toàn bộ ô hiện tại.`
                : 'Tính năng này sẽ thay thế tất cả hộp hiện tại dựa trên vùng ô ảnh sáng hoặc trong suốt của khung hình.',
            confirmText: 'Phát hiện',
            type: 'info',
            onConfirm: () => {
                closeConfirmDialog();
                if (detectMode === 'color') runColorDetect();
                else runAutoDetect();
            },
        });
    };

    const runAutoDetect = async () => {
        setBusy(true);
        try {
            const detectedBoxes = await detectFrameSlots(originalUrlRef.current, layoutDef.photoCount);
            if (detectedBoxes.length > 0) {
                // Just use detected boxes as photo slots
                const finalBoxes = detectedBoxes.map(b => ({
                    ...b,
                    rotation: 0
                }));
                setConfig({ ...config, boxes: finalBoxes });
                setSelectedBoxIndices([]);

                setNotification({ show: true, message: `Đã phát hiện ${detectedBoxes.length} ô ảnh.`, type: 'success' });
            } else {
                setNotification({ show: true, message: "Không tìm thấy ô ảnh. Hãy kiểm tra lại vùng đặt ảnh hoặc chỉnh thủ công.", type: 'error' });
            }
        } catch (error) {
            console.error("Auto detect failed", error);
            setNotification({ show: true, message: "Không thể tải hình ảnh để phân tich.", type: 'error' });
        } finally {
            setBusy(false);
        }
    };

    // Dò theo màu: phân tích ảnh GỐC (còn màu) -> ô + overlay đã đục lỗ để xem trước.
    // CHƯA ghi server; chỉ ghi đè khi bấm Lưu.
    const runColorDetect = async () => {
        setBusy(true);
        try {
            const { boxes, blob, previewUrl } = await analyzeColorFrame(
                originalUrlRef.current, markerColor, tolerance, layoutDef.photoCount
            );
            if (!boxes.length) {
                setNotification({ show: true, message: 'Không thấy ô nào khớp màu. Thử hút lại đúng màu ô hoặc tăng "Dung sai màu".', type: 'error' });
                return;
            }
            setConfig(prev => ({ ...prev, boxes }));
            setSelectedBoxIndices([]);
            punchedBlobRef.current = blob;
            setOverlayUrl(prev => {
                if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
                return previewUrl;
            });
            setNotification({ show: true, message: `Đã dò ${boxes.length} ô theo màu và đục lỗ (xem trước). Bấm Lưu để áp dụng.`, type: 'success' });
        } catch (error) {
            console.error("Color detect failed", error);
            setNotification({ show: true, message: "Không phân tích được khung theo màu.", type: 'error' });
        } finally {
            setBusy(false);
        }
    };

    const switchMode = (mode) => {
        setDetectMode(mode);
        setSampling(false);
        if (mode === 'transparent') {
            // Bỏ preview đục lỗ, quay lại ảnh gốc.
            punchedBlobRef.current = null;
            setOverlayUrl(prev => {
                if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
                return originalUrlRef.current;
            });
        }
    };

    const handleSampleClick = async (e) => {
        e.stopPropagation();
        if (!containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        const xPct = (clientX - rect.left) / rect.width;
        const yPct = (clientY - rect.top) / rect.height;
        try {
            const hex = await samplePixelColor(originalUrlRef.current, xPct, yPct);
            setMarkerColor(hex);
            setNotification({ show: true, message: `Đã hút màu ${hex}. Bấm "Tự động phát hiện" để dò ô.`, type: 'success' });
        } catch (err) {
            console.error(err);
            setNotification({ show: true, message: 'Không hút được màu tại điểm này.', type: 'error' });
        } finally {
            setSampling(false);
        }
    };

    const resetGrid = () => {
        setConfirmDialog({
            isOpen: true,
            title: 'Đặt lại vị trí?',
            message: 'Tất cả hộp ảnh sẽ được đưa về lưới mặc định của layout này.',
            confirmText: 'Đặt lại',
            type: 'info',
            onConfirm: () => {
                setConfig({ ...config, boxes: getDefaultBoxes() });
                setSelectedBoxIndices([]);
                closeConfirmDialog();
            },
        });
    };

    return (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-0 md:p-8 backdrop-blur-sm">
            <div className="bg-gray-50 w-full max-w-7xl h-full md:h-[90vh] md:rounded-3xl flex flex-col md:flex-row overflow-hidden shadow-2xl">

                {/* HEADER: Mobile Close Only */}
                <div className="md:hidden flex justify-between items-center p-4 bg-white border-b border-gray-200">
                    <h2 className="font-bold text-[#1a1a2e]">Cấu hình {frame.name}</h2>
                    <button onClick={() => onClose()} className="p-2 hover:bg-gray-100 rounded-full">
                        <X size={20} />
                    </button>
                </div>

                {/* TRÁI: thiết lập cho CẢ KHUNG. Trước đây mọi thứ dồn về một bảng bên phải
                    nên bảng dài quá khung, phải cuộn mới tới được nút Lưu. */}
                <div className="w-full md:w-[264px] md:shrink-0 order-2 md:order-1 bg-white md:border-r border-gray-200 p-4 md:p-5 flex flex-col overflow-y-auto max-h-[35vh] md:max-h-none">
                    <div className="hidden md:flex justify-between items-center mb-5">
                        <h2 className="text-xl font-bold text-[#1a1a2e]">Điều chỉnh</h2>
                        <button onClick={() => onClose()} className="p-2 hover:bg-gray-100 rounded-full">
                            <X size={20} />
                        </button>
                    </div>

                    <div className="flex-1 space-y-5">
                        <div className="bg-blue-50 p-3 rounded-lg border border-blue-100 text-[10px] md:text-xs text-blue-700">
                            <b>Cách dùng:</b> bấm vào một ô ảnh để chọn · kéo giữa ô để di chuyển · kéo góc để phóng to / thu nhỏ · kéo tay cầm phía trên để xoay.
                        </div>

                        {/* Global Config */}
                        <label className="flex flex-col gap-1">
                            <span className="flex items-baseline justify-between gap-2">
                                <span className="text-xs text-gray-600 font-bold uppercase tracking-wider">Bo góc mọi ô</span>
                                {/* Thanh trượt cũ KHÔNG hiện số -> kéo mà không biết đang ở mức nào. */}
                                <span className="text-xs font-bold text-[#e63946] tabular-nums">{config.borderRadius} px</span>
                            </span>
                            <input
                                type="range" min="0" max="100"
                                value={config.borderRadius}
                                onChange={e => setConfig({ ...config, borderRadius: parseInt(e.target.value) })}
                                className="w-full h-2 bg-gray-200 rounded-lg accent-[#e63946]"
                            />
                            <span className="text-[10px] text-gray-500 leading-snug">0 = góc vuông, kéo sang phải cho tròn dần. Áp cho tất cả ô cùng lúc.</span>
                        </label>

                        <hr className="border-gray-100" />

                            {/* Chọn kiểu ô ảnh: lỗ trong suốt (mặc định) hoặc dò theo màu */}
                            <div className="space-y-3 rounded-xl border border-gray-200 p-3">
                                <span className="text-[10px] md:text-xs text-gray-500 font-bold uppercase tracking-wider">Kiểu ô ảnh</span>
                                <div className="grid grid-cols-2 gap-2">
                                    <button
                                        onClick={() => switchMode('transparent')}
                                        className={`py-2 rounded-lg text-xs font-bold border transition-colors ${detectMode === 'transparent' ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}
                                    >
                                        Lỗ trong suốt
                                    </button>
                                    <button
                                        onClick={() => switchMode('color')}
                                        className={`py-2 rounded-lg text-xs font-bold border flex items-center justify-center gap-1 transition-colors ${detectMode === 'color' ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}
                                    >
                                        <Palette size={14} /> Theo màu
                                    </button>
                                </div>

                                {detectMode === 'color' && (
                                    <div className="space-y-3 pt-1">
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="color"
                                                value={markerColor}
                                                onChange={(e) => setMarkerColor(e.target.value)}
                                                className="h-9 w-11 rounded-lg border border-gray-300 bg-white p-0.5 cursor-pointer"
                                                title="Màu đánh dấu ô"
                                            />
                                            <button
                                                onClick={() => setSampling((s) => !s)}
                                                className={`flex-1 py-2 rounded-lg text-xs font-bold border flex items-center justify-center gap-1 transition-colors ${sampling ? 'bg-amber-500 text-white border-amber-500 animate-pulse' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}
                                            >
                                                <Pipette size={14} /> {sampling ? 'Chạm vào ô…' : 'Hút màu từ ảnh'}
                                            </button>
                                        </div>
                                        <label className="flex flex-col gap-1">
                                            <span className="text-[10px] md:text-xs text-gray-500 font-bold uppercase tracking-wider">Dung sai màu: {tolerance}</span>
                                            <input
                                                type="range" min="0" max="100"
                                                value={tolerance}
                                                onChange={(e) => setTolerance(parseInt(e.target.value))}
                                                className="w-full h-2 bg-gray-200 rounded-lg accent-purple-600"
                                            />
                                        </label>
                                        <p className="text-[10px] text-gray-400 leading-relaxed">
                                            Tô vùng đặt ảnh bằng 1 màu độc (mặc định hồng). Sau khi dò, phần mềm tự đục lỗ trong suốt; chi tiết trang trí màu khác vẫn giữ nguyên trên ảnh.
                                        </p>
                                    </div>
                                )}
                            </div>

                            <button onClick={handleAutoDetect} disabled={busy} className="w-full py-3 border border-purple-300 text-purple-700 bg-purple-50 hover:bg-purple-100 rounded-xl flex items-center justify-center gap-2 text-sm font-bold disabled:opacity-60 disabled:cursor-not-allowed">
                                {busy ? <Loader2 size={18} className="animate-spin" /> : <Wand2 size={18} />} Tự động phát hiện
                            </button>

                            <button onClick={resetGrid} className="w-full py-3 border border-gray-300 rounded-xl text-gray-600 hover:bg-gray-50 flex items-center justify-center gap-2 text-sm font-bold">
                                <RefreshCw size={18} /> Đặt lại vị trí
                            </button>
                    </div>
                </div>

                {/* GIỮA: ảnh xem trước. Không đặt bề rộng cố định -> ăn hết chỗ còn lại
                    giữa hai bảng điều khiển hai bên. */}
                <div className="flex-1 min-w-0 order-1 md:order-2 bg-[#1a1a2e] flex flex-col items-center justify-center relative overflow-hidden select-none p-2 md:p-10 min-h-[350px] md:min-h-0">
                    <div className="relative h-full w-full flex items-center justify-center">
                        <div
                            ref={containerRef}
                            className="relative shadow-2xl transition-all duration-300 bg-white"
                            style={{
                                aspectRatio: layoutDef.type === 'strip' ? '1/3' :
                                    layoutDef.type === 'strip_horizontal' ? '3/1' :
                                        layoutDef.type === 'grid_horizontal' ? '3/2' : '2/3',
                                height: layoutDef.type.includes('horizontal') ? 'auto' : '90%',
                                width: layoutDef.type.includes('horizontal') ? '90%' : 'auto',
                                maxHeight: '100%',
                                maxWidth: '100%'
                            }}
                            onClick={() => setSelectedBoxIndices([])}
                        >
                            {/* Photo Previews */}
                            {config.boxes.map((box, i) => {
                                const fallbackIndex = (i % (layoutDef.photoCount || 4)) + 1;
                                const displayNum = box.photoIndex !== undefined ? box.photoIndex + 1 : fallbackIndex;
                                return (
                                    <div
                                        key={`preview-${i}`}
                                        className="absolute bg-gray-200 border border-gray-300 flex items-center justify-center overflow-hidden"
                                        style={{
                                            left: `${box.x}%`,
                                            top: `${box.y}%`,
                                            width: `${box.width}%`,
                                            height: `${box.height}%`,
                                            transform: `rotate(${box.rotation}deg)`
                                        }}
                                    >
                                        <span
                                            className="text-gray-400 font-bold text-2xl md:text-4xl opacity-50 select-none transition-transform"
                                            style={{ transform: `rotate(${box.innerRotation || 0}deg)` }}
                                        >
                                            {displayNum}
                                        </span>
                                    </div>
                                );
                            })}

                            {/* Frame Overlay */}
                            <div className="absolute inset-0 z-20 pointer-events-none opacity-80">
                                <img src={overlayUrl} className="w-full h-full object-fill" alt="Frame" />
                            </div>

                            {/* Lớp bắt click khi ĐANG HÚT MÀU (phủ trên cùng) */}
                            {sampling && (
                                <div
                                    className="absolute inset-0 z-[55] cursor-crosshair"
                                    onClick={handleSampleClick}
                                    onTouchStart={handleSampleClick}
                                    title="Chạm vào ô ảnh để hút màu"
                                />
                            )}

                            {/* Interaction layer */}
                            {config.boxes.map((box, i) => (
                                <div
                                    key={`handle-${i}`}
                                    className={`absolute transition-colors cursor-move touch-none group ${selectedBoxIndices.includes(i) ? 'z-50 border-4 border-blue-500 bg-blue-500/20' : 'z-30 hover:bg-blue-500/10 border border-transparent hover:border-blue-300'}`}
                                    style={{
                                        left: `${box.x}%`,
                                        top: `${box.y}%`,
                                        width: `${box.width}%`,
                                        height: `${box.height}%`,
                                        transform: `rotate(${box.rotation}deg)`
                                    }}
                                    onMouseDown={(e) => handleDragStart(e, i, 'move')}
                                    onTouchStart={(e) => handleDragStart(e, i, 'move')}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        // Ignore click events if we just dragged
                                        if (hasDragged.current) {
                                            hasDragged.current = false;
                                            return;
                                        }

                                        if (e.shiftKey || e.ctrlKey || e.metaKey) {
                                            // Toggle is natively handled by onMouseDown for snappier feedback
                                        } else {
                                            setSelectedBoxIndices([i]);
                                        }
                                    }}
                                >
                                    {selectedBoxIndices.includes(i) && (
                                        <>
                                            <div
                                                className="absolute -top-8 left-1/2 -translate-x-1/2 w-8 h-8 flex items-center justify-center bg-white rounded-full shadow border border-gray-200 cursor-pointer touch-none"
                                                onMouseDown={(e) => handleDragStart(e, i, 'rotate')}
                                                onTouchStart={(e) => handleDragStart(e, i, 'rotate')}
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                <RotateCw size={14} className="text-blue-600" />
                                                <div className="absolute h-4 w-0.5 bg-blue-500 top-full left-1/2 -translate-x-1/2"></div>
                                            </div>
                                            <div
                                                className="absolute -bottom-2 -right-2 w-7 h-7 bg-blue-500 border-2 border-white rounded-full cursor-se-resize shadow touch-none"
                                                onMouseDown={(e) => handleDragStart(e, i, 'resize-se')}
                                                onTouchStart={(e) => handleDragStart(e, i, 'resize-se')}
                                                onClick={(e) => e.stopPropagation()}
                                            />
                                        </>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* PHẢI: chỉ những gì thuộc Ô ĐANG CHỌN. */}
                <div className="w-full md:w-[330px] md:shrink-0 order-3 bg-white md:border-l border-gray-200 p-4 md:p-5 flex flex-col overflow-y-auto max-h-[35vh] md:max-h-none">
                    <h2 className="hidden md:block text-sm font-bold uppercase tracking-wider text-gray-500 mb-4">Ô đang chọn</h2>
                    <div className="flex-1 space-y-5 pb-20 md:pb-0">
                        {/* Bulk Multi-Select Editor */}
                        {selectedBoxIndices.length > 0 ? (
                            (() => {
                                const primaryIdx = selectedBoxIndices[selectedBoxIndices.length - 1]; // Last selected is primary
                                const primaryBox = config.boxes[primaryIdx];
                                if (!primaryBox) return null;
                                const isMulti = selectedBoxIndices.length > 1;

                                return (
                                    <div className="space-y-4 animate-fadeIn">
                                        <div className="flex justify-between items-center">
                                            <h3 className="font-bold text-[#e63946] text-sm md:text-base">
                                                {isMulti ? `Đang chọn ${selectedBoxIndices.length} ô` : `Ảnh #${primaryIdx + 1}`}
                                            </h3>
                                        </div>
                                        <div className="space-y-5">
                                        <div className="space-y-2">
                                        <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500">Vị trí &amp; kích thước <span className="font-normal normal-case tracking-normal text-gray-400">— theo % khổ khung</span></p>
                                        <div className="grid grid-cols-2 gap-3">
                                            {/* Only show XY if single select */}
                                            {!isMulti && (
                                                <>
                                                    <label className="text-[11px] md:text-xs font-bold text-gray-600">
                                                        Cách trái <span className="text-gray-400">(X)</span>
                                                        <input type="number" className="w-full border border-gray-300 p-2 rounded-lg mt-1 font-normal text-gray-800" value={Math.round(primaryBox.x)} onChange={e => handleBoxChange(primaryIdx, 'x', e.target.value)} />
                                                    </label>
                                                    <label className="text-[11px] md:text-xs font-bold text-gray-600">
                                                        Cách trên <span className="text-gray-400">(Y)</span>
                                                        <input type="number" className="w-full border border-gray-300 p-2 rounded-lg mt-1 font-normal text-gray-800" value={Math.round(primaryBox.y)} onChange={e => handleBoxChange(primaryIdx, 'y', e.target.value)} />
                                                    </label>
                                                </>
                                            )}

                                            <label className="text-[11px] md:text-xs font-bold text-gray-600">
                                                Chiều rộng <span className="text-gray-400">(W)</span>
                                                <input type="number" className="w-full border border-gray-300 p-2 rounded-lg mt-1 font-normal text-gray-800" value={Math.round(primaryBox.width)} onChange={e => {
                                                    const val = e.target.value;
                                                    const newBoxes = [...config.boxes];
                                                    selectedBoxIndices.forEach(idx => newBoxes[idx].width = parseFloat(val) || 0);
                                                    setConfig({ ...config, boxes: newBoxes });
                                                }} />
                                            </label>
                                            <label className="text-[11px] md:text-xs font-bold text-gray-600">
                                                Chiều cao <span className="text-gray-400">(H)</span>
                                                <input type="number" className="w-full border border-gray-300 p-2 rounded-lg mt-1 font-normal text-gray-800" value={Math.round(primaryBox.height)} onChange={e => {
                                                    const val = e.target.value;
                                                    const newBoxes = [...config.boxes];
                                                    selectedBoxIndices.forEach(idx => newBoxes[idx].height = parseFloat(val) || 0);
                                                    setConfig({ ...config, boxes: newBoxes });
                                                }} />
                                            </label>

                                        </div>

                                        <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500 pt-1">Ảnh dùng cho ô</p>
                                        <label className="text-[11px] md:text-xs font-bold text-gray-600">
                                            Ô này lấy tấm ảnh nào?
                                            <select
                                                className="w-full border border-gray-300 p-2 rounded-lg mt-1 text-gray-800 font-normal"
                                                value={primaryBox.photoIndex ?? ''}
                                                onChange={e => {
                                                    const val = e.target.value;
                                                    const numVal = val === '' ? undefined : Number(val);
                                                    const newBoxes = [...config.boxes];
                                                    selectedBoxIndices.forEach(idx => newBoxes[idx].photoIndex = numVal);
                                                    setConfig({ ...config, boxes: newBoxes });
                                                }}
                                            >
                                                <option value="">Tự động (Theo thứ tự / Lặp lại)</option>
                                                {Array.from({ length: layoutDef.photoCount || 4 }).map((_, i) => (
                                                    <option key={i} value={i}>Ảnh chụp số {i + 1}</option>
                                                ))}
                                            </select>
                                            <span className="font-normal text-[10px] text-gray-500 block mt-1 leading-snug">
                                                Để "Tự động" thì các ô lần lượt lấy ảnh 1, 2, 3… Chọn một tấm cụ thể khi muốn ép ô này luôn lấy đúng tấm đó.
                                            </span>
                                        </label>
                                        </div>

                                        <div className="space-y-3">
                                            <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500">Xoay</p>
                                            <label className="text-[11px] md:text-xs font-bold text-gray-600">
                                                Xoay cả ô <span className="text-gray-400">(°)</span>
                                                <input type="number" className="w-full border border-gray-300 p-2 rounded-lg mt-1 font-normal text-gray-800" value={Math.round(primaryBox.rotation)} onChange={e => {
                                                    const val = e.target.value;
                                                    const newBoxes = [...config.boxes];
                                                    selectedBoxIndices.forEach(idx => newBoxes[idx].rotation = parseFloat(val) || 0);
                                                    setConfig({ ...config, boxes: newBoxes });
                                                }} />
                                                <span className="font-normal text-[10px] text-gray-500 block mt-1 leading-snug">Nghiêng NGUYÊN CÁI Ô trên khung — ô và ảnh nghiêng theo nhau.</span>
                                            </label>


                                            <label className="text-[11px] md:text-xs font-bold text-gray-600">
                                                Xoay ảnh BÊN TRONG ô <span className="text-gray-400">(°)</span>
                                                <input type="number" step="90" className="w-full border border-gray-300 p-2 rounded-lg mt-1 font-normal text-gray-800" value={Math.round(primaryBox.innerRotation || 0)} onChange={e => {
                                                    const val = e.target.value;
                                                    const newBoxes = [...config.boxes];
                                                    selectedBoxIndices.forEach(idx => newBoxes[idx].innerRotation = parseFloat(val) || 0);
                                                    setConfig({ ...config, boxes: newBoxes });
                                                }} />
                                                <span className="font-normal text-[10px] text-gray-500 block mt-1 leading-snug">
                                                    Ô đứng yên, chỉ tấm ảnh bên trong quay. Dùng khi lỗ khung nằm ngang mà ảnh chụp dọc — thường điền -90.
                                                </span>
                                            </label>

                                        </div>
                                        </div>
                                    </div>
                                );
                            })()
                        ) : (
                            <p className="text-sm text-gray-400 text-center py-4 bg-gray-50 rounded-xl border border-dashed">Hãy chọn một hộp để chỉnh sửa</p>
                        )}

                        <div className="mt-auto space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                                <button onClick={handleCopyConfig} className="py-2.5 border border-gray-300 rounded-xl text-gray-600 hover:bg-gray-50 flex items-center justify-center gap-2 text-xs font-bold">
                                    <Copy size={16} /> Sao chép
                                </button>
                                <button onClick={handlePasteConfig} className="py-2.5 border border-blue-200 text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-xl flex items-center justify-center gap-2 text-xs font-bold">
                                    <Clipboard size={16} /> Dán
                                </button>
                            </div>

                            <button onClick={handleSave} disabled={busy} className="w-full py-4 bg-[#e63946] text-white rounded-xl font-bold hover:bg-[#c1121f] flex items-center justify-center gap-2 shadow-lg shadow-[#e63946]/20 disabled:opacity-60 disabled:cursor-not-allowed">
                                {busy ? <Loader2 size={20} className="animate-spin" /> : <Save size={20} />} Lưu cấu hình
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Notification Modal */}
            <AnimatePresence>
                {notification.show && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/20 backdrop-blur-[2px]"
                    >
                        <motion.div
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.9, opacity: 0 }}
                            className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-8"
                        >
                            <div className="flex flex-col items-center text-center">
                                <div className={`mb-6 p-4 rounded-full ${notification.type === 'success' ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
                                    {notification.type === 'success' ? <CheckCircle size={40} /> : <XCircle size={40} />}
                                </div>

                                <h3 className="text-2xl font-bold text-[#1a1a2e] mb-2">
                                    {notification.type === 'success' ? 'Thành công' : 'Lỗi'}
                                </h3>

                                <p className="text-gray-500 mb-8 font-medium">
                                    {notification.message}
                                </p>

                                <button
                                    onClick={() => setNotification({ ...notification, show: false })}
                                    className={`w-full py-4 rounded-2xl font-bold text-white transition-all shadow-lg ${notification.type === 'success'
                                        ? 'bg-[#e63946] hover:bg-[#c1121f] shadow-[#e63946]/30'
                                        : 'bg-red-500 hover:bg-red-600 shadow-red-500/30'
                                        }`}
                                >
                                    Đã hiểu
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            <ConfirmDialog
                isOpen={confirmDialog.isOpen}
                title={confirmDialog.title}
                message={confirmDialog.message}
                type={confirmDialog.type}
                confirmText={confirmDialog.confirmText}
                onConfirm={confirmDialog.onConfirm}
                onCancel={closeConfirmDialog}
            />
        </div>
    );
};

export default FrameConfigEditor;
