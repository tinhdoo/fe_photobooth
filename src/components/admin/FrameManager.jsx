import { useState, useEffect } from 'react';
import axios from 'axios';
import { Upload, Trash2, Plus, Filter, Settings, CheckSquare, Square, Wand2 as WandIcon, Loader2, BarChart2, Award, TrendingUp } from 'lucide-react';
import { LAYOUTS } from '../../data/layouts';
import FrameConfigEditor from './FrameConfigEditor';
import { detectFrameSlots } from '../../utils/frameDetection';
import ConfirmDialog from './ConfirmDialog';

const API_URL = import.meta.env.VITE_API_URL || '';
const CLOUD_API_URL = import.meta.env.VITE_CLOUD_API_URL
    || (typeof window !== 'undefined'
        ? (window.location.hostname === 'localhost' ? 'https://tomatophotobooth.vercel.app' : window.location.origin)
        : '');
const FRAME_API_URL = CLOUD_API_URL || API_URL;
const frameApiPath = (path) => `${FRAME_API_URL}${path}`;

const FrameManager = () => {
    const [frames, setFrames] = useState([]);
    const [uploading, setUploading] = useState(false);
    const [selectedLayout, setSelectedLayout] = useState(LAYOUTS[0].id);
    const [editingFrame, setEditingFrame] = useState(null);

    const [selectedFrames, setSelectedFrames] = useState(new Set());
    const [isProcessing, setIsProcessing] = useState(false);
    const [notification, setNotification] = useState({ show: false, message: '', type: 'success' });
    const [activeTab, setActiveTab] = useState('photobooth'); // 'photobooth' | 'upload'
    const [isDraggingOver, setIsDraggingOver] = useState(false);
    const [topFrames, setTopFrames] = useState([]);
    const [topFramesLoading, setTopFramesLoading] = useState(true);

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
        fetchFrames();
        setSelectedFrames(new Set()); // Reset selection on layout change
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

    const fetchFrames = async () => {
        try {
            const res = await axios.get(frameApiPath('/api/frames'), {
                params: { layout: selectedLayout }
            });
            setFrames(Array.isArray(res.data) ? res.data : []);
        } catch (error) {
            console.error("Error fetching frames:", error);
        }
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
                    await axios.post(frameApiPath('/api/frames'), formData, {
                        headers: { 'Content-Type': 'multipart/form-data' }
                    });
                } catch (err) {
                    if (err.response?.status === 409) {
                        duplicates.push(file.name);
                    } else {
                        throw err;
                    }
                }
            });

            await Promise.all(uploadPromises);
            fetchFrames();

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
            fetchFrames();
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
                    const boxes = await detectFrameSlots(frame.url);

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
            fetchFrames();

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
                            <div key={frame.frame_url} className="flex items-center gap-1.5 bg-[#F9FAF7] border border-gray-100 rounded-xl px-2 py-1">
                                <span className="text-sm leading-none">{medals[idx]}</span>
                                <div className="w-7 h-7 rounded-lg overflow-hidden bg-white border border-gray-100 shrink-0">
                                    <img src={frame.frame_url} alt={frame.frame_name} className="w-full h-full object-contain" />
                                </div>
                                <span className="text-xs font-semibold text-[#2f3e46] max-w-[80px] truncate" title={frame.frame_name}>
                                    {frame.frame_name}
                                </span>
                                <span className="text-[10px] font-black text-[#52796f] bg-[#52796f]/10 px-1.5 py-0.5 rounded-full shrink-0">
                                    {frame.count}x
                                </span>
                            </div>
                        ));
                    })()}
                </div>
            )}

            <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center mb-6 gap-4 lg:gap-6">
                <div className="w-full lg:w-auto">
                    <h1 className="text-2xl md:text-3xl font-bold text-[#2f3e46] tracking-tight">Quản lý khung hình</h1>
                    <p className="text-[#52796f] mt-1 text-sm md:text-base">Quản lý khung viền cho máy ảnh của bạn</p>
                </div>

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full lg:w-auto">
                    {/* Tab Switcher */}
                    <div className="inline-flex bg-[#edf1ea] rounded-full p-1 shadow-inner">
                        <button
                            onClick={() => { setActiveTab('photobooth'); setSelectedLayout(LAYOUTS.find(l => !l.isMobileOnly)?.id || LAYOUTS[0].id); }}
                            className={`px-4 py-1.5 rounded-full text-sm font-semibold transition
                                ${activeTab === 'photobooth'
                                    ? 'bg-white shadow text-[#354f52]'
                                    : 'text-gray-500 hover:text-[#354f52]'
                                }`}
                        >
                            📷 Photobooth
                        </button>
                        <button
                            onClick={() => { setActiveTab('upload'); setSelectedLayout(LAYOUTS.find(l => l.isMobileOnly)?.id || LAYOUTS[0].id); }}
                            className={`px-4 py-1.5 rounded-full text-sm font-semibold transition
                                ${activeTab === 'upload'
                                    ? 'bg-white shadow text-[#354f52]'
                                    : 'text-gray-500 hover:text-[#354f52]'
                                }`}
                        >
                            📱 Upload
                        </button>
                    </div>
                </div>
            </div>

            {/* Layout Selector - Tabs */}
            <div className="border-b border-[#e6e8e3] mb-6">
                <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
                    {filteredLayouts.map(l => (
                        <button
                            key={l.id}
                            onClick={() => setSelectedLayout(l.id)}
                            className={`
                                relative px-5 py-3 text-sm font-semibold transition-all whitespace-nowrap
                                ${selectedLayout === l.id
                                    ? 'text-[#354f52]'
                                    : 'text-gray-400 hover:text-[#52796f]'
                                }
                            `}
                        >
                            {l.name}

                            {selectedLayout === l.id && (
                                <span className="absolute left-0 right-0 -bottom-[1px] h-[3px] bg-[#84a98c] rounded-full" />
                            )}
                        </button>
                    ))}
                </div>
            </div>

            {/* Sticky Toolbar / Layout Header & Upload */}
            <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-[#354f52] flex items-center">
                    {LAYOUTS.find(l => l.id === selectedLayout)?.name}
                    <span className="ml-2 text-gray-400 font-normal text-sm">
                        • {frames.length} khung
                    </span>
                </h2>

                <label className={`
                    ml-auto
                    bg-[#52796f] hover:bg-[#3a5a40]
                    text-white
                    px-5 py-2.5
                    rounded-lg
                    flex items-center gap-2
                    font-semibold
                    shadow-md hover:shadow-lg
                    transition
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
                        <span className="font-bold text-[#2f3e46] text-sm md:text-base whitespace-nowrap">{selectedFrames.size} đã chọn</span>
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
                            className="flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-[#52796f] transition-colors"
                        >
                            {selectedFrames.size === frames.length && frames.length > 0 ? (
                                <CheckSquare size={20} className="text-[#52796f]" />
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
                className={`relative rounded-2xl transition-all duration-200 ${isDraggingOver ? 'ring-4 ring-[#52796f]/40 bg-[#52796f]/5' : ''}`}
            >
                {isDraggingOver && (
                    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-[#52796f]/10 rounded-2xl border-2 border-dashed border-[#52796f] pointer-events-none">
                        <Upload size={48} className="text-[#52796f] mb-3" />
                        <p className="text-[#52796f] font-bold text-lg">Thả để tải lên</p>
                        <p className="text-[#52796f]/60 text-sm">Chỉ chấp nhận file PNG</p>
                    </div>
                )}

                {/* Upload Area */}
                {
                    frames.length === 0 && (
                        <div className="mb-8 bg-gradient-to-br from-[#F9FAF7] to-white border-2 border-dashed border-[#CAD2C5] rounded-3xl p-8">
                            <label className="flex flex-col items-center justify-center cursor-pointer group">
                                <div className="w-20 h-20 bg-[#A8B5A0]/10 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 group-hover:bg-[#A8B5A0]/20 transition-all">
                                    <Plus size={40} className="text-[#A8B5A0]" />
                                </div>
                                <h3 className="text-xl font-bold text-[#52796f] mb-2">Tải lên khung hình</h3>
                                <p className="text-sm text-gray-500 mb-4">Định dạng PNG có độ trong suốt</p>
                                <div className="bg-[#A8B5A0] hover:bg-[#84a98c] text-white px-6 py-2 rounded-full flex items-center gap-2 transition-colors">
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

                {/* Frames Grid */}
                {
                    frames.length > 0 ? (
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3 md:gap-4 mb-20 animate-fadeIn">
                            {frames.map((frame) => {
                                const isSelected = selectedFrames.has(frame.id);
                                return (
                                    <div
                                        key={frame.id}
                                        className={`group relative bg-white rounded-2xl overflow-hidden
                                            transition-all duration-300
                                            hover:-translate-y-1 hover:shadow-xl cursor-pointer
                                            ${isSelected ? 'ring-2 ring-[#84a98c] shadow-lg' : 'border border-gray-100 hover:border-[#cad2c5]'}
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
                                                    fetchFrames(); // Refresh to see new icon
                                                } catch (err) {
                                                    console.error("Icon upload failed", err);
                                                    setNotification({ show: true, message: "Tải lên biểu tượng thất bại.", type: 'error' });
                                                }
                                            }
                                        }}
                                    >
                                        {/* Selection Checkbox (Visible on hover or selected) */}
                                        <div className={`absolute top-2 left-2 z-30 transition-all duration-200 ${isSelected ? 'opacity-100 scale-100' : 'opacity-0 scale-90 group-hover:opacity-100 group-hover:scale-100'}`}>
                                            <div className={`w-5 h-5 rounded-md border flex items-center justify-center ${isSelected ? 'bg-[#52796f] border-[#52796f] text-white' : 'bg-white border-gray-300 text-transparent hover:border-[#52796f]'}`}>
                                                <CheckSquare size={14} fill="currentColor" />
                                            </div>
                                        </div>

                                        {/* ICON PREVIEW (If exists) */}
                                        {frame.icon_url && (
                                            <div className="absolute top-2 right-2 z-30 w-10 h-10 rounded-full border-2 border-white shadow-md bg-white overflow-hidden" title="Biểu tượng đã gán">
                                                <img src={frame.icon_url} className="w-full h-full object-cover" alt="Icon" />
                                            </div>
                                        )}

                                        {/* Frame Preview */}
                                        <div
                                            className="bg-[#F9FAF7] relative overflow-hidden"
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
                                                src={frame.url}
                                                alt={frame.name}
                                                className="relative z-10 w-full h-full object-contain p-2"
                                            />

                                            {/* Hover Actions Overlay */}
                                            <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px] opacity-100 md:opacity-0 md:group-hover:opacity-100 transition flex items-center justify-center gap-3 z-20">
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); setEditingFrame(frame); }}
                                                    className="bg-white/20 hover:bg-white/40 p-3 rounded-full text-white shadow-lg transition-all transform hover:scale-110"
                                                    title="Cấu hình lưới"
                                                >
                                                    <Settings size={20} />
                                                </button>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); confirmDelete(frame); }}
                                                    className="bg-red-500/80 hover:bg-red-500 p-3 rounded-full text-white shadow-lg transition-all transform hover:scale-110"
                                                    title="Xóa khung hình"
                                                >
                                                    <Trash2 size={20} />
                                                </button>
                                            </div>
                                        </div>

                                        {/* Frame Info */}
                                        <div className="p-3 border-t border-gray-100">
                                            <h3
                                                className="font-semibold text-[#2f3e46] truncate text-sm mb-1"
                                                title={frame.name}
                                            >
                                                {frame.name}
                                            </h3>
                                            <div className="flex items-center gap-2">
                                                <span className="text-[10px] bg-[#F0F2E9] text-[#52796f] px-1.5 py-0.5 rounded-full font-medium">
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
                            <p className="text-gray-400">Tải lên khung hình PNG cho bố cục <span className="font-semibold text-[#52796f]">{selectedLayout}</span> để bắt đầu!</p>
                        </div>
                    )
                }

                {/* Config Modal */}
                {
                    editingFrame && (
                        <FrameConfigEditor
                            frame={editingFrame}
                            onClose={() => setEditingFrame(null)}
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
        </div >
    );
};

export default FrameManager;
