import { useState, useEffect } from 'react';
import axios from 'axios';
import { Upload, Trash2, Plus, Filter, Settings, CheckSquare, Square, Wand2 as WandIcon, Loader2, BarChart2, Award, TrendingUp, Images } from 'lucide-react';
import { LAYOUTS } from '../../data/layouts';
import FrameConfigEditor from './FrameConfigEditor';
import { detectFrameSlots } from '../../utils/frameDetection';
import { makeThumbnailBlob } from '../../utils/imageThumb';
import ConfirmDialog from './ConfirmDialog';
import IconManager from './IconManager';

import { FRAME_API_URL } from '../../config/api';
const frameApiPath = (path) => `${FRAME_API_URL}${path}`;

// API MỚI luôn trả về trường 'thumb_url' (kể cả null). API CŨ (chưa deploy) KHÔNG có trường này.
// Dùng để KHÔNG gọi upload thumbnail nhầm vào API cũ — vì API cũ coi POST lạ là uploadFrame và sẽ
// tạo ra "frame rác" tên thumb.png.
const framesSupportThumb = (list) => list.length > 0 && Object.prototype.hasOwnProperty.call(list[0], 'thumb_url');

// Tạo thumbnail từ nguồn (File hoặc URL) rồi upload lên `/api/frames?resource=thumb`.
// Lỗi ở bước này KHÔNG được làm hỏng luồng chính (grid tự fallback về ảnh gốc) -> chỉ log.
async function uploadThumbFromSource(layout, name, source) {
    try {
        const blob = await makeThumbnailBlob(source, 400);
        const form = new FormData();
        form.append('file', blob, 'thumb.png');
        await axios.post(
            frameApiPath(`/api/frames?resource=thumb&layout=${encodeURIComponent(layout)}&name=${encodeURIComponent(name)}`),
            form,
            { headers: { 'Content-Type': 'multipart/form-data' } },
        );
        return true;
    } catch (err) {
        console.warn('[thumb] không tạo được thumbnail cho', name, err?.message || err);
        return false;
    }
}

const FrameManager = () => {
    const [frames, setFrames] = useState([]);
    const [framesLoading, setFramesLoading] = useState(true);
    // Cache frame theo từng layout -> chuyển tab đã xem thì hiện lại NGAY (không tải lại/spinner),
    // đồng thời làm mới ngầm để dữ liệu vẫn cập nhật (stale-while-revalidate).
    const [framesByLayout, setFramesByLayout] = useState({});
    const [uploading, setUploading] = useState(false);
    const [selectedLayout, setSelectedLayout] = useState(LAYOUTS[0].id);
    const [editingFrame, setEditingFrame] = useState(null);

    const [selectedFrames, setSelectedFrames] = useState(new Set());
    const [isProcessing, setIsProcessing] = useState(false);
    const [notification, setNotification] = useState({ show: false, message: '', type: 'success' });

    // Tu tat moi thong bao sau vai giay. Truoc day moi cho goi setNotification phai TU dat setTimeout
    // rieng -> cho upload icon (keo tha) bi quen -> toast "Tai len bieu tuong thanh cong" hien mai.
    // Gom ve mot cho de khong bao gio sot nua. Moi lan message doi -> timer reset.
    useEffect(() => {
        if (!notification.show) return;
        // 'info' la trang thai "dang tai...", de lau hon phong khi request cham; con lai tat nhanh.
        const timeout = notification.type === 'info' ? 15000 : 3500;
        const timer = setTimeout(() => setNotification({ show: false, message: '', type: 'success' }), timeout);
        return () => clearTimeout(timer);
    }, [notification.show, notification.message, notification.type]);
    const [activeTab, setActiveTab] = useState('photobooth'); // 'photobooth' | 'upload'
    const [isDraggingOver, setIsDraggingOver] = useState(false);
    const [topFrames, setTopFrames] = useState([]);
    const [topFramesLoading, setTopFramesLoading] = useState(true);
    const [backfill, setBackfill] = useState({ running: false, done: 0, total: 0 });

    const filteredLayouts = LAYOUTS.filter(l => activeTab === 'upload' ? l.isMobileOnly : !l.isMobileOnly);

    // Confirmation Modal State
    const [confirmModal, setConfirmModal] = useState({
        isOpen: false,
        title: '',
        message: '',
        type: 'danger', // 'danger' | 'info'
        onConfirm: null
    });

    useEffect(() => {
        setSelectedFrames(new Set()); // Reset selection on layout change
        const cached = framesByLayout[selectedLayout];
        if (cached) {
            // Đã xem layout này -> hiện lại NGAY từ cache, KHÔNG gọi lại API (tiết kiệm request).
            // Dữ liệu vẫn đúng trong phiên vì mỗi lần upload/xoá/backfill đều cập nhật cache.
            setFrames(cached);
            setFramesLoading(false);
        } else {
            fetchFrames();                 // lần đầu vào layout này -> tải + spinner
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedLayout]);

    useEffect(() => {
        const fetchTopFrames = async () => {
            try {
                const res = await axios.get(frameApiPath('/api/stats/top-frames'), { params: { limit: 5 } });
                setTopFrames(Array.isArray(res.data) ? res.data : []);
            } catch (err) {
                console.error('Failed to fetch top frames', err);
            } finally {
                setTopFramesLoading(false);
            }
        };
        fetchTopFrames();
    }, []);

    const fetchFrames = async ({ showLoading = true } = {}) => {
        if (showLoading) setFramesLoading(true);
        try {
            const res = await axios.get(frameApiPath('/api/frames'), {
                params: { layout: selectedLayout }
            });
            const list = Array.isArray(res.data) ? res.data : [];
            setFrames(list);
            setFramesByLayout((prev) => ({ ...prev, [selectedLayout]: list })); // cập nhật cache layout này
        } catch (error) {
            console.error("Error fetching frames:", error);
        } finally {
            if (showLoading) setFramesLoading(false);
        }
    };

    // Tạo bù thumbnail cho frame CŨ (đã upload trước khi có tính năng này) của layout đang xem.
    // Chạy tuần tự trong trình duyệt: tải ảnh gốc -> thu nhỏ -> upload. Frame nào lỗi thì bỏ qua
    // (grid vẫn hiển thị bằng ảnh gốc). Chỉ cần bấm 1 lần cho mỗi layout.
    const handleBackfillThumbnails = async () => {
        if (!framesSupportThumb(frames)) {
            setNotification({ show: true, message: 'Cần deploy bản mới (API hỗ trợ thumbnail) trước đã.', type: 'info' });
            return;
        }
        const missing = frames.filter((f) => !f.thumb_url);
        if (missing.length === 0) {
            setNotification({ show: true, message: 'Tất cả frame ở layout này đã có thumbnail.', type: 'success' });
            return;
        }
        setBackfill({ running: true, done: 0, total: missing.length });
        let ok = 0;
        for (let i = 0; i < missing.length; i++) {
            const f = missing[i];
            // eslint-disable-next-line no-await-in-loop
            const success = await uploadThumbFromSource(f.layout || selectedLayout, f.name, f.url);
            if (success) ok += 1;
            setBackfill({ running: true, done: i + 1, total: missing.length });
        }
        setBackfill({ running: false, done: 0, total: 0 });
        await fetchFrames({ showLoading: false });
        setNotification({
            show: true,
            message: `Đã tạo thumbnail cho ${ok}/${missing.length} frame.`,
            type: ok === missing.length ? 'success' : 'info',
        });
    };

    const handleUpload = async (e) => {
        const files = Array.from(e.target.files);
        if (files.length === 0) return;

        setUploading(true);
        const duplicates = [];
        try {
            const uploadPromises = files.map(async file => {
                const formData = new FormData();
                formData.append('file', file);
                formData.append('layout', selectedLayout);

                try {
                    const res = await axios.post(frameApiPath('/api/frames'), formData, {
                        headers: { 'Content-Type': 'multipart/form-data' }
                    });
                    // Tạo thumbnail ngay từ chính file vừa chọn (không phải tải lại ảnh gốc).
                    // Chỉ làm khi API đã hỗ trợ thumbnail (tránh tạo frame rác trên API cũ).
                    if (framesSupportThumb(frames)) {
                        const savedName = res?.data?.name || file.name;
                        await uploadThumbFromSource(selectedLayout, savedName, file);
                    }
                } catch (err) {
                    if (err.response?.status === 409) {
                        duplicates.push(file.name);
                    } else {
                        throw err;
                    }
                }
            });

            await Promise.all(uploadPromises);
            fetchFrames({ showLoading: false });

            if (duplicates.length > 0) {
                setNotification({
                    show: true,
                    message: `${duplicates.length} khung đã tồn tại (bỏ qua): ${duplicates.join(', ')}`,
                    type: 'error'
                });
                setTimeout(() => setNotification({ show: false, message: '', type: 'success' }), 4000);
            }
        } catch (error) {
            console.error("Error uploading frames:", error);
            setNotification({ show: true, message: "Tải lên thất bại", type: 'error' });
            setTimeout(() => setNotification({ show: false, message: '', type: 'success' }), 3000);
        } finally {
            setUploading(false);
            e.target.value = null;
        }
    };

    const confirmDelete = (frame) => {
        setConfirmModal({
            isOpen: true,
            title: 'Xóa khung hình?',
            message: `Bạn có chắc chắn muốn xóa "${frame.name}"? Hành động này không thể hoàn tác.`,
            type: 'danger',
            confirmText: 'Xóa',
            onConfirm: () => handleDelete(frame)
        });
    };

    const handleDelete = async (frame) => {
        setConfirmModal(prev => ({ ...prev, isOpen: false })); // Close modal

        try {
            await axios.delete(frameApiPath('/api/frames'), {
                params: { layout: frame.layout, name: frame.name }
            });
            fetchFrames({ showLoading: false });
            // Remove from selection if exists
            if (selectedFrames.has(frame.id)) {
                toggleSelectFrame(frame.id);
            }
        } catch (error) {
            console.error("Error deleting frame:", error);
            setNotification({ show: true, message: "Xóa khung hình thất bại", type: 'error' });
            setTimeout(() => setNotification({ show: false, message: '', type: 'success' }), 3000);
        }
    };

    // Bulk selection handlers
    const toggleSelectFrame = (frameId) => {
        const newSelected = new Set(selectedFrames);
        if (newSelected.has(frameId)) {
            newSelected.delete(frameId);
        } else {
            newSelected.add(frameId);
        }
        setSelectedFrames(newSelected);
    };

    const toggleSelectAll = () => {
        if (selectedFrames.size === frames.length) {
            setSelectedFrames(new Set());
        } else {
            setSelectedFrames(new Set(frames.map(f => f.id)));
        }
    };

    const confirmBulkAutoDetect = () => {
        if (selectedFrames.size === 0) return;
        setConfirmModal({
            isOpen: true,
            title: `Tự động phát hiện ô ảnh (${selectedFrames.size})`,
            message: `Thao tác này sẽ ghi đè cấu hình ô ảnh hiện tại cho ${selectedFrames.size} khung hình đã chọn bằng cách phát hiện độ trong suốt. Tiếp tục?`,
            type: 'info',
            confirmText: 'Chạy tự động phát hiện',
            onConfirm: handleBulkAutoDetect
        });
    };

    const handleBulkAutoDetect = async () => {
        setConfirmModal(prev => ({ ...prev, isOpen: false }));

        setIsProcessing(true);
        let successCount = 0;
        let failCount = 0;

        try {
            const promises = Array.from(selectedFrames).map(async (frameId) => {
                const frame = frames.find(f => f.id === frameId);
                if (!frame) return;

                try {
                    // 1. Detect slots locally
                    const layoutDef = LAYOUTS.find(l => l.id === frame.layout);
                    const boxes = await detectFrameSlots(frame.url, layoutDef?.photoCount);

                    if (boxes.length > 0) {
                        // 2. Save config to backend
                        // Need existing config to preserve borderRadius? 
                        // For bulk, let's assume default borderRadius 0 or fetch?
                        // Fetching might be slow for many. Let's just save boxes and default radius 0.
                        const config = {
                            borderRadius: 0,
                            boxes: boxes
                        };
                        await axios.post(frameApiPath('/api/frames'), config, {
                            params: { layout: frame.layout, name: frame.name, resource: 'config' }
                        });
                        successCount++;
                    } else {
                        console.warn(`No slots found for ${frame.name}`);
                        failCount++;
                    }
                } catch (err) {
                    console.error(`Failed to process ${frame.name}`, err);
                    failCount++;
                }
            });

            await Promise.all(promises);
            setNotification({
                show: true,
                message: `Đã xử lý thành công ${successCount} khung hình. ${failCount > 0 ? `${failCount} thất bại.` : ''}`,
                type: successCount > 0 ? 'success' : 'error'
            });

        } catch (error) {
            console.error("Bulk process error", error);
            setNotification({ show: true, message: "Xử lý hàng loạt thất bại.", type: 'error' });
        } finally {
            setIsProcessing(false);
            setSelectedFrames(new Set()); // Clear selection
            setTimeout(() => setNotification({ show: false, message: '', type: 'success' }), 3000);
        }
    };

    const handleBulkDelete = async () => {
        setIsProcessing(true);
        let successCount = 0;
        let failCount = 0;

        try {
            const framesToDelete = Array.from(selectedFrames).map(id => frames.find(f => f.id === id)).filter(Boolean);

            const promises = framesToDelete.map(async (frame) => {
                try {
                    await axios.delete(frameApiPath('/api/frames'), {
                        params: { layout: frame.layout, name: frame.name }
                    });
                    successCount++;
                } catch (err) {
                    console.error(`Failed to delete ${frame.name}`, err);
                    failCount++;
                }
            });

            await Promise.all(promises);
            fetchFrames({ showLoading: false });

            setNotification({
                show: true,
                message: `Đã xóa ${successCount} khung hình. ${failCount > 0 ? `${failCount} thất bại.` : ''}`,
                type: successCount > 0 ? 'success' : 'error'
            });

        } catch (error) {
            console.error("Bulk delete error", error);
            setNotification({ show: true, message: "Xóa hàng loạt thất bại.", type: 'error' });
        } finally {
            setIsProcessing(false);
            setSelectedFrames(new Set());
            setTimeout(() => setNotification({ show: false, message: '', type: 'success' }), 3000);
        }
    };

    // Global drop zone handler for bulk frame upload
    const handleDropFiles = (e) => {
        e.preventDefault();
        setIsDraggingOver(false);
        const files = Array.from(e.dataTransfer.files).filter(f => f.type === 'image/png');
        if (files.length === 0) return;
        const dt = new DataTransfer();
        files.forEach(f => dt.items.add(f));
        handleUpload({ target: { files: dt.files, value: null } });
    };

    return (
        <div className="animate-fadeIn">

            {/* Top Frames Section — compact horizontal */}
            {(topFramesLoading || topFrames.length > 0) && (
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 px-4 py-3 mb-6 flex items-center gap-3 flex-wrap">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-amber-500 shrink-0 mr-1">
                        <Award size={14} />
                        <span className="uppercase tracking-wide">Top frame</span>
                    </div>

                    {topFramesLoading ? (
                        <Loader2 size={16} className="animate-spin text-gray-300" />
                    ) : (() => {
                        const medals = ['🥇', '🥈', '🥉', '4', '5'];
                        return topFrames.map((frame, idx) => (
                            <div key={frame.frame_url} className="flex items-center gap-1.5 bg-gray-50 border border-gray-100 rounded-xl px-2 py-1">
                                <span className="text-sm leading-none">{medals[idx]}</span>
                                <div className="w-7 h-7 rounded-lg overflow-hidden bg-white border border-gray-100 shrink-0">
                                    <img src={frame.frame_url} alt={frame.frame_name} loading="lazy" decoding="async" className="w-full h-full object-contain" />
                                </div>
                                <span className="text-xs font-semibold text-[#1a1a2e] max-w-[80px] truncate" title={frame.frame_name}>
                                    {frame.frame_name}
                                </span>
                                <span className="text-[10px] font-black text-[#e63946] bg-[#e63946]/10 px-1.5 py-0.5 rounded-full shrink-0">
                                    {frame.count}x
                                </span>
                            </div>
                        ));
                    })()}
                </div>
            )}

            <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center mb-6 gap-4 lg:gap-6">
                <div className="w-full lg:w-auto">
                    <h1 className="text-2xl md:text-3xl font-bold text-[#1a1a2e] tracking-tight">Quản lý khung hình</h1>
                    <p className="text-gray-500 mt-1 text-sm md:text-base">Quản lý khung viền cho máy ảnh của bạn</p>
                </div>

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full lg:w-auto">
                    {/* Tab Switcher */}
                    <div className="inline-flex bg-gray-100/80 rounded-full p-0.5 border border-gray-200/50">
                        <button
                            onClick={() => { setActiveTab('photobooth'); setSelectedLayout(LAYOUTS.find(l => !l.isMobileOnly)?.id || LAYOUTS[0].id); }}
                            className={`px-4 py-1.5 rounded-full text-xs sm:text-sm font-bold transition-all duration-200
                                ${activeTab === 'photobooth'
                                    ? 'bg-white shadow text-[#e63946]'
                                    : 'text-gray-500 hover:text-[#e63946]'
                                }`}
                        >
                            📷 Photobooth
                        </button>
                        <button
                            onClick={() => { setActiveTab('upload'); setSelectedLayout(LAYOUTS.find(l => l.isMobileOnly)?.id || LAYOUTS[0].id); }}
                            className={`px-4 py-1.5 rounded-full text-xs sm:text-sm font-bold transition-all duration-200
                                ${activeTab === 'upload'
                                    ? 'bg-white shadow text-[#e63946]'
                                    : 'text-gray-500 hover:text-[#e63946]'
                                }`}
                        >
                            📱 Upload
                        </button>
                        <button
                            onClick={() => setActiveTab('icons')}
                            className={`px-4 py-1.5 rounded-full text-xs sm:text-sm font-bold transition-all duration-200
                                ${activeTab === 'icons'
                                    ? 'bg-white shadow text-[#e63946]'
                                    : 'text-gray-500 hover:text-[#e63946]'
                                }`}
                        >
                            🎭 Icons
                        </button>
                    </div>
                </div>
            </div>

            {activeTab === 'icons' ? (
                <IconManager apiBase={FRAME_API_URL} />
            ) : (
              <>
            {/* Layout Selector - Tabs */}
            <div className="mb-6 overflow-hidden">
                <div className="flex items-center gap-2 overflow-x-auto pb-1.5 scrollbar-none -mx-4 px-4">
                    {filteredLayouts.map(l => (
                        <button
                            key={l.id}
                            onClick={() => setSelectedLayout(l.id)}
                            className={`
                                px-4 py-2 rounded-full text-xs sm:text-sm font-bold transition-all whitespace-nowrap border
                                ${selectedLayout === l.id
                                    ? 'bg-[#e63946] text-white border-[#e63946] shadow-sm shadow-[#e63946]/10'
                                    : 'bg-white text-gray-500 border-gray-100 hover:text-[#e63946] hover:border-red-100'
                                }
                            `}
                        >
                            {l.name}
                        </button>
                    ))}
                </div>
            </div>

            {/* Sticky Toolbar / Layout Header & Upload */}
            <div className="flex items-center justify-between mb-5">
                <h2 className="font-bold text-lg text-[#1a1a2e] flex items-center">
                    {LAYOUTS.find(l => l.id === selectedLayout)?.name}
                    <span className="ml-2 text-gray-400 font-semibold text-xs sm:text-sm">
                        • {framesLoading ? '…' : `${frames.length} khung`}
                    </span>
                </h2>

                <label className={`
                    ml-auto
                    bg-[#e63946] hover:bg-[#c1121f]
                    text-white
                    px-4 py-2 sm:px-5 sm:py-2.5
                    rounded-xl
                    flex items-center gap-2
                    font-bold text-sm
                    shadow-md hover:shadow-lg hover:shadow-[#e63946]/10
                    transition-all duration-200
                    active:scale-95
                    cursor-pointer
                    ${uploading ? 'opacity-70 pointer-events-none' : ''}
                `}>
                    {uploading ? (
                        <span className="animate-pulse text-sm">Đang tải...</span>
                    ) : (
                        <>
                            <Upload size={18} />
                            <span className="text-sm">Tải lên</span>
                        </>
                    )}
                    <input type="file" className="hidden" accept="image/png" multiple onChange={handleUpload} disabled={uploading} />
                </label>
            </div>

            {/* Bulk Toolbar */}
            {selectedFrames.size > 0 && (
                <div className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 bg-white shadow-2xl border border-gray-200 rounded-3xl md:rounded-full px-4 md:px-6 py-3 flex flex-col md:flex-row items-center gap-3 md:gap-4 z-40 animate-slideUp w-[95%] md:w-auto">
                    <div className="flex items-center gap-4 w-full md:w-auto justify-between md:justify-start">
                        <span className="font-bold text-[#1a1a2e] text-sm md:text-base whitespace-nowrap">{selectedFrames.size} đã chọn</span>
                        <button onClick={() => setSelectedFrames(new Set())} className="text-gray-500 hover:text-gray-700 text-sm md:hidden font-medium">
                            Hủy
                        </button>
                        <div className="hidden md:block h-6 w-px bg-gray-300"></div>
                    </div>

                    <div className="flex items-center gap-2 w-full md:w-auto justify-between">
                        <button
                            onClick={confirmBulkAutoDetect}
                            disabled={isProcessing}
                            className="flex-1 md:flex-none flex items-center justify-center gap-1.5 text-purple-600 hover:bg-purple-50 px-3 py-2.5 md:py-1.5 rounded-xl md:rounded-lg font-bold border border-purple-100 md:border-transparent transition-colors text-xs md:text-sm"
                        >
                            {isProcessing ? <Loader2 size={16} className="animate-spin" /> : <WandIcon size={16} />}
                            <span className="whitespace-nowrap">Tự động</span>
                        </button>

                        <button
                            className="flex-1 md:flex-none flex items-center justify-center gap-1.5 text-red-500 hover:bg-red-50 px-3 py-2.5 md:py-1.5 rounded-xl md:rounded-lg font-bold border border-red-100 md:border-transparent transition-colors text-xs md:text-sm"
                            onClick={() => {
                                setConfirmModal({
                                    isOpen: true,
                                    title: `Xóa ${selectedFrames.size} khung hình?`,
                                    message: `Bạn có chắc chắn muốn xóa ${selectedFrames.size} khung hình đã chọn? Hành động này không thể hoàn tác.`,
                                    type: 'danger',
                                    confirmText: 'Xóa',
                                    onConfirm: handleBulkDelete
                                });
                            }}
                        >
                            <Trash2 size={16} />
                            <span>Xóa</span>
                        </button>

                        <div className="hidden md:block h-6 w-px bg-gray-300"></div>
                        <button onClick={() => setSelectedFrames(new Set())} className="hidden md:block text-gray-500 hover:text-gray-700 text-sm">
                            Hủy
                        </button>
                    </div>
                </div>
            )
            }

            {/* Selection Header */}
            {
                frames.length > 0 && (
                    <div className="flex items-center gap-2 mb-4">
                        <button
                            onClick={toggleSelectAll}
                            className="flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-[#e63946] transition-colors"
                        >
                            {selectedFrames.size === frames.length && frames.length > 0 ? (
                                <CheckSquare size={20} className="text-[#e63946]" />
                            ) : (
                                <Square size={20} />
                            )}
                            Chọn tất cả
                        </button>
                    </div>
                )
            }


            {/* Drop Zone + Frames Grid */}
            <div
                onDragOver={(e) => { e.preventDefault(); setIsDraggingOver(true); }}
                onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setIsDraggingOver(false); }}
                onDrop={handleDropFiles}
                className={`relative rounded-2xl transition-all duration-200 ${isDraggingOver ? 'ring-4 ring-[#e63946]/40 bg-[#e63946]/5' : ''}`}
            >
                {isDraggingOver && (
                    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-[#e63946]/10 rounded-2xl border-2 border-dashed border-[#e63946] pointer-events-none">
                        <Upload size={48} className="text-[#e63946] mb-3" />
                        <p className="text-[#e63946] font-bold text-lg">Thả để tải lên</p>
                        <p className="text-[#e63946]/60 text-sm">Chỉ chấp nhận file PNG</p>
                    </div>
                )}

                {/* Upload Area */}
                {
                    frames.length === 0 && (
                        <div className="mb-8 bg-gradient-to-br from-[#FFF8F8] to-white border-2 border-dashed border-red-100 rounded-3xl p-8">
                            <label className="flex flex-col items-center justify-center cursor-pointer group">
                                <div className="w-20 h-20 bg-[#e63946]/10 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 group-hover:bg-[#e63946]/20 transition-all">
                                    <Plus size={40} className="text-[#e63946]" />
                                </div>
                                <h3 className="text-xl font-bold text-[#e63946] mb-2">Tải lên khung hình</h3>
                                <p className="text-sm text-gray-500 mb-4">Định dạng PNG có độ trong suốt</p>
                                <div className="bg-[#e63946] hover:bg-[#c1121f] text-white px-6 py-2 rounded-full flex items-center gap-2 transition-colors">
                                    <Upload size={18} />
                                    <span className="font-medium">Chọn tệp</span>
                                </div>
                                <input
                                    type="file"
                                    className="hidden"
                                    accept="image/png"
                                    multiple
                                    onChange={handleUpload}
                                    disabled={uploading}
                                />
                            </label>
                        </div>
                    )
                }

                {/* Banner tạo bù thumbnail — chỉ hiện khi API đã hỗ trợ thumbnail VÀ còn frame thiếu */}
                {!framesLoading && framesSupportThumb(frames) && frames.some((f) => !f.thumb_url) && (
                    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 animate-fadeIn">
                        <Images size={18} className="text-amber-600 shrink-0" />
                        <span className="text-sm font-medium text-amber-800">
                            {backfill.running
                                ? `Đang tạo thumbnail... ${backfill.done}/${backfill.total}`
                                : `${frames.filter((f) => !f.thumb_url).length} khung chưa có ảnh thu nhỏ nên tải chậm hơn.`}
                        </span>
                        <button
                            type="button"
                            onClick={handleBackfillThumbnails}
                            disabled={backfill.running}
                            className="ml-auto inline-flex items-center gap-2 rounded-full bg-amber-500 px-4 py-2 text-sm font-bold text-white shadow-sm transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {backfill.running ? <Loader2 size={16} className="animate-spin" /> : <Images size={16} />}
                            {backfill.running ? 'Đang xử lý...' : 'Tạo ảnh thu nhỏ'}
                        </button>
                    </div>
                )}

                {/* Frames Grid */}
                {
                    framesLoading ? (
                        <div className="bg-white rounded-3xl border border-gray-100 p-16 text-center animate-fadeIn">
                            <Loader2 size={48} className="text-[#e63946] animate-spin mx-auto mb-4" />
                            <p className="text-gray-400 font-medium">Đang tải khung hình...</p>
                        </div>
                    ) : frames.length > 0 ? (
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3 md:gap-4 mb-20 animate-fadeIn">
                            {frames.map((frame) => {
                                const isSelected = selectedFrames.has(frame.id);
                                return (
                                    <div
                                        key={frame.id}
                                        // content-visibility: bỏ qua giải mã/vẽ các card NGOÀI màn hình
                                        // -> mở grid nhiều frame nhẹ hơn hẳn. 'auto 340px' giữ chỗ để
                                        // thanh cuộn không nhảy.
                                        style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 340px' }}
                                        className={`group relative bg-white rounded-2xl overflow-hidden
                                            transition-all duration-300
                                            hover:-translate-y-1 hover:shadow-xl cursor-pointer
                                            ${isSelected ? 'ring-2 ring-[#e63946] shadow-lg' : 'border border-gray-100 hover:border-red-200'}
                                        `}
                                        onClick={() => toggleSelectFrame(frame.id)}
                                        onDragOver={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            e.currentTarget.classList.add('ring-4', 'ring-purple-400');
                                        }}
                                        onDragLeave={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            e.currentTarget.classList.remove('ring-4', 'ring-purple-400');
                                        }}
                                        onDrop={async (e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            e.currentTarget.classList.remove('ring-4', 'ring-purple-400');

                                            const files = Array.from(e.dataTransfer.files);
                                            if (files.length > 0 && files[0].type.startsWith('image/')) {
                                                const file = files[0];
                                                // Upload Icon
                                                const formData = new FormData();
                                                formData.append('file', file);

                                                try {
                                                    setNotification({ show: true, message: `Đang tải lên biểu tượng cho ${frame.name}...`, type: 'info' });
                                                    await axios.post(frameApiPath('/api/frames'), formData, {
                                                        params: { layout: frame.layout, name: frame.name, resource: 'icon' },
                                                        headers: { 'Content-Type': 'multipart/form-data' }
                                                    });
                                                    setNotification({ show: true, message: "Tải lên biểu tượng thành công!", type: 'success' });
                                                    fetchFrames({ showLoading: false }); // Refresh to see new icon
                                                } catch (err) {
                                                    console.error("Icon upload failed", err);
                                                    setNotification({ show: true, message: "Tải lên biểu tượng thất bại.", type: 'error' });
                                                }
                                            }
                                        }}
                                    >
                                        {/* Selection Checkbox (Visible on hover or selected) */}
                                        <div className={`absolute top-2 left-2 z-30 transition-all duration-200 ${isSelected ? 'opacity-100 scale-100' : 'opacity-0 scale-90 group-hover:opacity-100 group-hover:scale-100'}`}>
                                            <div className={`w-5 h-5 rounded-md border flex items-center justify-center ${isSelected ? 'bg-[#e63946] border-[#e63946] text-white' : 'bg-white border-gray-300 text-transparent hover:border-[#e63946]'}`}>
                                                <CheckSquare size={14} fill="currentColor" />
                                            </div>
                                        </div>

                                        {/* ICON PREVIEW (If exists) */}
                                        {frame.icon_url && (
                                            <div className="absolute top-2 right-2 z-30 w-10 h-10 rounded-full border-2 border-white shadow-md bg-white overflow-hidden" title="Biểu tượng đã gán">
                                                <img src={frame.icon_url} loading="lazy" decoding="async" className="w-full h-full object-cover" alt="Icon" />
                                            </div>
                                        )}

                                        {/* Frame Preview */}
                                        <div
                                            className="bg-gray-50 relative overflow-hidden"
                                            style={{
                                                aspectRatio: (() => {
                                                    const layoutDef = LAYOUTS.find(l => l.id === frame.layout);
                                                    return layoutDef?.type?.includes('horizontal') ? '3/2' : '2/3';
                                                })()
                                            }}
                                        >
                                            {/* Checkerboard background for transparency */}
                                            <div
                                                className="absolute inset-0 opacity-10"
                                                style={{
                                                    backgroundImage: 'linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)',
                                                    backgroundSize: '20px 20px',
                                                    backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px'
                                                }}
                                            />

                                            <img
                                                src={frame.thumb_url || frame.url}
                                                alt={frame.name}
                                                loading="lazy"
                                                decoding="async"
                                                className="relative z-10 w-full h-full object-contain p-2"
                                            />

                                            {/* Hover Actions Overlay */}
                                            <div className="absolute inset-0 bg-black/30 backdrop-blur-[1px] opacity-100 md:opacity-0 md:group-hover:opacity-100 transition flex items-center justify-center gap-4 z-20">
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); setEditingFrame(frame); }}
                                                    className="bg-white text-gray-700 hover:bg-[#e63946] hover:text-white p-3 rounded-full shadow-lg transition-all transform hover:scale-110 border border-gray-100 duration-200"
                                                    title="Cấu hình lưới"
                                                >
                                                    <Settings size={20} />
                                                </button>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); confirmDelete(frame); }}
                                                    className="bg-[#e63946] text-white hover:bg-[#c1121f] p-3 rounded-full shadow-lg transition-all transform hover:scale-110 duration-200"
                                                    title="Xóa khung hình"
                                                >
                                                    <Trash2 size={20} />
                                                </button>
                                            </div>
                                        </div>

                                        {/* Frame Info */}
                                        <div className="p-3 border-t border-gray-100">
                                            <h3
                                                className="font-semibold text-[#1a1a2e] truncate text-sm mb-1"
                                                title={frame.name}
                                            >
                                                {frame.name}
                                            </h3>
                                            <div className="flex items-center gap-2">
                                                <span className="text-[10px] bg-gray-50 text-[#e63946] px-1.5 py-0.5 rounded-full font-medium">
                                                    {frame.layout}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="bg-white rounded-3xl border-2 border-dashed border-gray-200 p-16 text-center">
                            <div className="w-24 h-24 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-6">
                                <Upload size={48} className="text-gray-300" />
                            </div>
                            <h3 className="text-xl font-bold text-gray-400 mb-2">Chưa có khung hình nào</h3>
                            <p className="text-gray-400">Tải lên khung hình PNG cho bố cục <span className="font-semibold text-[#e63946]">{selectedLayout}</span> để bắt đầu!</p>
                        </div>
                    )
                }

                {/* Config Modal */}
                {
                    editingFrame && (
                        <FrameConfigEditor
                            key={editingFrame.id || editingFrame.name}
                            frame={editingFrame}
                            onClose={() => { setEditingFrame(null); fetchFrames({ showLoading: false }); }}
                        />
                    )
                }

                {/* Confirm Dialog */}
                <ConfirmDialog
                    isOpen={confirmModal.isOpen}
                    title={confirmModal.title}
                    message={confirmModal.message}
                    type={confirmModal.type}
                    confirmText={confirmModal.confirmText}
                    onConfirm={confirmModal.onConfirm}
                    onCancel={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
                />

                {/* Notification */}
                {
                    notification.show && (
                        <div className="fixed top-6 right-6 z-50 animate-fadeInRight">
                            <div className={`px-6 py-4 rounded-xl shadow-2xl flex items-center gap-3 border ${notification.type === 'success' ? 'bg-white border-green-200 text-green-700' : 'bg-white border-red-200 text-red-700'}`}>
                                <div className={`p-2 rounded-full ${notification.type === 'success' ? 'bg-green-100' : 'bg-red-100'}`}>
                                    {/* Simplify icon */}
                                    <CheckSquare size={20} />
                                </div>
                                <p className="font-medium">{notification.message}</p>
                            </div>
                        </div>
                    )
                }
            </div>
              </>
            )}
        </div >
    );
};

export default FrameManager;
