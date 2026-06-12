import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { X, Save, RotateCw, RefreshCw, Copy, Clipboard, Wand2, CheckCircle, XCircle } from 'lucide-react';
import { LAYOUTS } from '../../data/layouts';
import { motion, AnimatePresence } from 'framer-motion';
import { detectFrameSlots } from '../../utils/frameDetection';

const API_URL = import.meta.env.VITE_API_URL || '';
const CLOUD_API_URL = import.meta.env.VITE_CLOUD_API_URL
    || (typeof window !== 'undefined'
        ? (window.location.hostname === 'localhost' ? 'https://tomatophotobooth.vercel.app' : window.location.origin)
        : '');
const FRAME_API_URL = CLOUD_API_URL || API_URL;
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
                    if (!confirm(`Số lượng ảnh không khớp (Đã sao chép: ${parsed.boxes.length}, Hiện tại: ${layoutDef.photoCount}). Vẫn dán?`)) {
                        return;
                    }
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
    const containerRef = useRef(null);
    const dragState = useRef(null);
    const hasDragged = useRef(false);

    const layoutDef = LAYOUTS.find(l => l.id === frame.layout) || LAYOUTS[0];

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

    const handleSave = async () => {
        try {
            await axios.post(frameApiPath('/api/frames'), config, {
                params: { layout: frame.layout, name: frame.name, resource: 'config' }
            });
            setNotification({ show: true, message: "Lưu cấu hình thành công!", type: 'success' });
            setTimeout(() => onClose(), 1500); // Close after showing success message
        } catch (error) {
            console.error("Error saving config:", error);
            setNotification({ show: true, message: "Lưu cấu hình thất bại", type: 'error' });
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
        if (!confirm("Tự động phát hiện sẽ thay thế tất cả các hộp hiện tại dựa trên vùng trong suốt của khung hình. Tiếp tục?")) return;

        try {
            const detectedBoxes = await detectFrameSlots(frame.url);
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
                setNotification({ show: true, message: "Không tìm thấy ô ảnh trong suốt. Hãy đảm bảo khung hình PNG của bạn có độ trong suốt.", type: 'error' });
            }
        } catch (error) {
            console.error("Auto detect failed", error);
            setNotification({ show: true, message: "Không thể tải hình ảnh để phân tich.", type: 'error' });
        }
    };

    const resetGrid = () => {
        if (confirm("Đặt lại tất cả các hộp về lưới mặc định?")) {
            setConfig({ ...config, boxes: getDefaultBoxes() });
            setSelectedBoxIndices([]);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-0 md:p-8 backdrop-blur-sm">
            <div className="bg-[#F9FAF7] w-full max-w-7xl h-full md:h-[90vh] md:rounded-3xl flex flex-col md:flex-row overflow-hidden shadow-2xl">

                {/* HEADER: Mobile Close Only */}
                <div className="md:hidden flex justify-between items-center p-4 bg-white border-b border-gray-200">
                    <h2 className="font-bold text-[#2f3e46]">Cấu hình {frame.name}</h2>
                    <button onClick={() => onClose()} className="p-2 hover:bg-gray-100 rounded-full">
                        <X size={20} />
                    </button>
                </div>

                {/* TOP (Mobile) / RIGHT (Desktop): Preview */}
                <div className="flex-1 md:w-3/4 bg-[#2f3e46] flex flex-col items-center justify-center relative overflow-hidden select-none p-2 md:p-10 min-h-[350px] md:min-h-0">
                    <div className="relative h-full w-full flex items-center justify-center">
                        <div
                            ref={containerRef}
                            className="relative shadow-2xl transition-all duration-300 bg-white"
                            style={{
                                aspectRatio: layoutDef.type === 'strip' ? '1/3' :
                                    layoutDef.type === 'strip_horizontal' ? '3/2' :
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
                                <img src={frame.url} className="w-full h-full object-fill" alt="Frame" />
                            </div>

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

                {/* BOTTOM (Mobile) / LEFT (Desktop): Controls */}
                <div className="w-full md:w-1/4 bg-white md:border-r border-gray-200 p-4 md:p-6 flex flex-col overflow-y-auto max-h-[50vh] md:max-h-none">
                    <div className="hidden md:flex justify-between items-center mb-6">
                        <h2 className="text-xl font-bold text-[#2f3e46]">Điều chỉnh</h2>
                        <button onClick={() => onClose()} className="p-2 hover:bg-gray-100 rounded-full">
                            <X size={20} />
                        </button>
                    </div>

                    <div className="flex-1 space-y-6 pb-20 md:pb-0">
                        <div className="bg-blue-50 p-3 rounded-lg border border-blue-100 text-[10px] md:text-xs text-blue-700">
                            Nhấp vào hộp ảnh để chọn. Kéo để di chuyển. Kéo góc để thay đổi kích thước. Kéo tay cầm trên để xoay.
                        </div>

                        {/* Global Config */}
                        <label className="flex flex-col gap-1">
                            <span className="text-xs text-gray-500 font-bold uppercase tracking-wider">Bo góc toàn bộ (px)</span>
                            <input
                                type="range" min="0" max="100"
                                value={config.borderRadius}
                                onChange={e => setConfig({ ...config, borderRadius: parseInt(e.target.value) })}
                                className="w-full h-2 bg-gray-200 rounded-lg accent-[#52796f]"
                            />
                        </label>

                        <hr className="border-gray-100" />

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
                                            <h3 className="font-bold text-[#52796f] text-sm md:text-base">
                                                {isMulti ? `Đang chọn ${selectedBoxIndices.length} ô` : `Ảnh #${primaryIdx + 1}`}
                                            </h3>
                                        </div>
                                        <div className="grid grid-cols-2 gap-3">
                                            {/* Only show XY if single select */}
                                            {!isMulti && (
                                                <>
                                                    <label className="text-[10px] md:text-xs font-bold text-gray-400">
                                                        X (%) <input type="number" className="w-full border p-2 rounded-lg mt-1" value={Math.round(primaryBox.x)} onChange={e => handleBoxChange(primaryIdx, 'x', e.target.value)} />
                                                    </label>
                                                    <label className="text-[10px] md:text-xs font-bold text-gray-400">
                                                        Y (%) <input type="number" className="w-full border p-2 rounded-lg mt-1" value={Math.round(primaryBox.y)} onChange={e => handleBoxChange(primaryIdx, 'y', e.target.value)} />
                                                    </label>
                                                </>
                                            )}

                                            <label className="text-[10px] md:text-xs font-bold text-gray-400">
                                                W (%) <input type="number" className="w-full border p-2 rounded-lg mt-1" value={Math.round(primaryBox.width)} onChange={e => {
                                                    const val = e.target.value;
                                                    const newBoxes = [...config.boxes];
                                                    selectedBoxIndices.forEach(idx => newBoxes[idx].width = parseFloat(val) || 0);
                                                    setConfig({ ...config, boxes: newBoxes });
                                                }} />
                                            </label>
                                            <label className="text-[10px] md:text-xs font-bold text-gray-400">
                                                H (%) <input type="number" className="w-full border p-2 rounded-lg mt-1" value={Math.round(primaryBox.height)} onChange={e => {
                                                    const val = e.target.value;
                                                    const newBoxes = [...config.boxes];
                                                    selectedBoxIndices.forEach(idx => newBoxes[idx].height = parseFloat(val) || 0);
                                                    setConfig({ ...config, boxes: newBoxes });
                                                }} />
                                            </label>

                                            <label className="text-[10px] md:text-xs font-bold text-gray-400 col-span-2">
                                                Xoay lưới (°) <input type="number" className="w-full border p-2 rounded-lg mt-1" value={Math.round(primaryBox.rotation)} onChange={e => {
                                                    const val = e.target.value;
                                                    const newBoxes = [...config.boxes];
                                                    selectedBoxIndices.forEach(idx => newBoxes[idx].rotation = parseFloat(val) || 0);
                                                    setConfig({ ...config, boxes: newBoxes });
                                                }} />
                                            </label>

                                            <label className="text-[10px] md:text-xs font-bold text-gray-400 col-span-2 mt-2">
                                                Ảnh ưu tiên (Index):
                                                <select
                                                    className="w-full border p-2 rounded-lg mt-1 text-gray-700 font-normal"
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
                                                <span className="font-normal text-[10px] text-gray-400 block mt-1">
                                                    (Ép ô chọn lấy chính xác góc ảnh số mấy. Vd: gán tất cả ưu tiên lấy Ảnh 1)
                                                </span>
                                            </label>

                                            <label className="text-[10px] md:text-xs font-bold text-gray-400 col-span-2 mt-2">
                                                Xoay ảnh bên trong (°) <input type="number" step="90" className="w-full border p-2 rounded-lg mt-1" value={Math.round(primaryBox.innerRotation || 0)} onChange={e => {
                                                    const val = e.target.value;
                                                    const newBoxes = [...config.boxes];
                                                    selectedBoxIndices.forEach(idx => newBoxes[idx].innerRotation = parseFloat(val) || 0);
                                                    setConfig({ ...config, boxes: newBoxes });
                                                }} />
                                                <span className="font-normal text-[10px] text-gray-400 block mt-1">
                                                    (Dùng khi lỗ template nằm ngang. Ảnh dọc được xoay lấp đầy ô. VD: -90)
                                                </span>
                                            </label>
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

                            <button onClick={handleAutoDetect} className="w-full py-3 border border-purple-300 text-purple-700 bg-purple-50 hover:bg-purple-100 rounded-xl flex items-center justify-center gap-2 text-sm font-bold">
                                <Wand2 size={18} /> Tự động phát hiện
                            </button>

                            <button onClick={resetGrid} className="w-full py-3 border border-gray-300 rounded-xl text-gray-600 hover:bg-gray-50 flex items-center justify-center gap-2 text-sm font-bold">
                                <RefreshCw size={18} /> Đặt lại vị trí
                            </button>

                            <button onClick={handleSave} className="w-full py-4 bg-[#52796f] text-white rounded-xl font-bold hover:bg-[#3f6158] flex items-center justify-center gap-2 shadow-lg shadow-[#52796f]/20">
                                <Save size={20} /> Lưu cấu hình
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

                                <h3 className="text-2xl font-bold text-[#2f3e46] mb-2">
                                    {notification.type === 'success' ? 'Thành công' : 'Lỗi'}
                                </h3>

                                <p className="text-gray-500 mb-8 font-medium">
                                    {notification.message}
                                </p>

                                <button
                                    onClick={() => setNotification({ ...notification, show: false })}
                                    className={`w-full py-4 rounded-2xl font-bold text-white transition-all shadow-lg ${notification.type === 'success'
                                        ? 'bg-[#52796f] hover:bg-[#3f6158] shadow-[#52796f]/30'
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
        </div>
    );
};

export default FrameConfigEditor;
