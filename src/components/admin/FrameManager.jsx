import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { Upload, Trash2, Plus, Filter, Settings, CheckSquare, Square, Wand2 as WandIcon, Loader2, BarChart2, Award, TrendingUp, Images, Download, Camera, IdCard, Smile, ArrowUpDown, GripVertical } from 'lucide-react';
import { LAYOUTS } from '../../data/layouts';
import FrameConfigEditor from './FrameConfigEditor';
import { detectFrameSlots } from '../../utils/frameDetection';
import { makeThumbnailBlob } from '../../utils/imageThumb';
import ConfirmDialog from './ConfirmDialog';
import IconManager from './IconManager';

import { FRAME_API_URL } from '../../config/api';
import { authHeader } from '../../utils/auth';
import { veToMau } from '../../idPhoto/toAnhThe';
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
    const [activeTab, setActiveTab] = useState('photobooth'); // 'photobooth' | 'idphoto' | 'icons' ('upload' đã ẩn nút)
    const [isDraggingOver, setIsDraggingOver] = useState(false);
    const [topFrames, setTopFrames] = useState([]);
    const [topFramesLoading, setTopFramesLoading] = useState(true);
    const [backfill, setBackfill] = useState({ running: false, done: 0, total: 0 });

    // Sắp xếp thứ tự hiển thị khung (booth hiện khung theo đúng thứ tự này, khung đầu là mặc định).
    // Chế độ riêng: bật "Sắp xếp" -> kéo thả thẻ (chuột hoặc ngón tay) -> "Lưu". Tách chế độ để kéo không
    // đụng chọn khung / cuộn trang trên điện thoại.
    const [sapXep, setSapXep] = useState(false);
    const [keoId, setKeoId] = useState(null);
    const [dangLuuThuTu, setDangLuuThuTu] = useState(false);
    const banGocRef = useRef([]);
    const luoiRef = useRef(null);
    const keoRef = useRef(null); // { id, x, y, cuon, raf }

    const batDauSapXep = () => { banGocRef.current = frames; setSelectedFrames(new Set()); setSapXep(true); };
    const huySapXep = () => { setFrames(banGocRef.current); setSapXep(false); };
    const luuThuTu = async () => {
        setDangLuuThuTu(true);
        try {
            await axios.post(
                frameApiPath(`/api/frames?resource=order&layout=${encodeURIComponent(selectedLayout)}`),
                { names: frames.map((f) => f.name) },
                { headers: authHeader() },
            );
            setFramesByLayout((prev) => ({ ...prev, [selectedLayout]: frames }));
            setSapXep(false);
            setNotification({ show: true, message: 'Đã lưu thứ tự khung.', type: 'success' });
        } catch (err) {
            const st = err?.response?.status;
            setNotification({ show: true, message: st === 401 || st === 403 ? 'Cần đăng nhập tài khoản admin để lưu thứ tự.' : 'Lưu thứ tự thất bại, thử lại.', type: 'error' });
        } finally {
            setDangLuuThuTu(false);
        }
    };

    // Kéo bằng Pointer Events (chạy cả chuột lẫn cảm ứng; drag & drop HTML5 không chạy trên điện thoại).
    // Rê qua thẻ nào thì đổi chỗ luôn với thẻ đó; sát mép trên/dưới khung cuộn thì tự cuộn.
    const batDauKeo = (e, id) => {
        if (!sapXep || (e.pointerType === 'mouse' && e.button !== 0)) return;
        e.preventDefault();
        let cuon = luoiRef.current?.parentElement;
        while (cuon && !/(auto|scroll)/.test(getComputedStyle(cuon).overflowY)) cuon = cuon.parentElement;
        const k = { id, x: e.clientX, y: e.clientY, cuon: cuon || document.scrollingElement, raf: 0 };
        keoRef.current = k;
        setKeoId(id);

        const doiCho = () => {
            const dich = document.elementFromPoint(k.x, k.y)?.closest('[data-frame-id]')?.getAttribute('data-frame-id');
            if (!dich || dich === String(k.id)) return;
            setFrames((prev) => {
                const tu = prev.findIndex((f) => String(f.id) === String(k.id));
                const den = prev.findIndex((f) => String(f.id) === dich); // data-* luôn là chuỗi
                if (tu < 0 || den < 0) return prev;
                const next = [...prev];
                const [m] = next.splice(tu, 1);
                next.splice(den, 0, m);
                return next;
            });
        };
        const di = (ev) => { k.x = ev.clientX; k.y = ev.clientY; doiCho(); };
        const tuCuon = () => {
            const r = k.cuon === document.scrollingElement ? { top: 0, bottom: window.innerHeight } : k.cuon.getBoundingClientRect();
            const v = k.y < r.top + 70 ? -12 : k.y > r.bottom - 110 ? 12 : 0;
            if (v) { k.cuon.scrollTop += v; doiCho(); }
            k.raf = requestAnimationFrame(tuCuon);
        };
        const tha = () => {
            cancelAnimationFrame(k.raf);
            keoRef.current = null;
            setKeoId(null);
            window.removeEventListener('pointermove', di);
            window.removeEventListener('pointerup', tha);
            window.removeEventListener('pointercancel', tha);
        };
        window.addEventListener('pointermove', di);
        window.addEventListener('pointerup', tha);
        window.addEventListener('pointercancel', tha);
        k.raf = requestAnimationFrame(tuCuon);
    };

    // Tab Ảnh thẻ: một loại duy nhất (id_photo_mixed) — cho ô mặc định + ảnh mẫu. Ô thật của từng khung dò / đục lỗ /
    // chỉnh ở Cấu hình lưới như khung photobooth, chỉ là không giới hạn số ô.
    const filteredLayouts = LAYOUTS.filter(l => (activeTab === 'upload' ? l.isMobileOnly
        : activeTab === 'idphoto' ? l.idPhoto
            : !l.isMobileOnly && !l.idPhoto));
    const isIdTab = activeTab === 'idphoto';
    const selectedLayoutDef = LAYOUTS.find(l => l.id === selectedLayout);
    const taiToMau = () => {
        const a = document.createElement('a');
        a.href = veToMau(selectedLayoutDef).toDataURL('image/png');
        a.download = `mau_khung_${selectedLayout}.png`;
        a.click();
    };

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
        setSapXep(false);
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

        // Vercel serverless giới hạn body ~4.5MB -> chặn sớm + báo RÕ file nào quá lớn (frame 4x6
        // PNG trong suốt độ phân giải cao rất dễ vượt). Chỉ upload các file trong giới hạn.
        const MAX_BYTES = 4.4 * 1024 * 1024;
        const mb = (n) => (n / 1024 / 1024).toFixed(1);
        const tooBig = files.filter((f) => f.size > MAX_BYTES);
        if (tooBig.length > 0) {
            setNotification({
                show: true,
                type: 'error',
                message: `Frame quá lớn (giới hạn 4.5MB): ${tooBig.map((f) => `${f.name} (${mb(f.size)}MB)`).join(', ')}. Hãy giảm dung lượng/độ phân giải rồi thử lại.`,
            });
            setTimeout(() => setNotification({ show: false, message: '', type: 'success' }), 8000);
        }
        const okFiles = files.filter((f) => f.size <= MAX_BYTES);
        if (okFiles.length === 0) { e.target.value = null; return; }

        setUploading(true);
        const duplicates = [];
        try {
            const uploadPromises = okFiles.map(async file => {
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
            const status = error.response?.status;
            let reason;
            if (status === 413) reason = "Frame quá lớn — vượt giới hạn 4.5MB của máy chủ. Hãy giảm dung lượng ảnh.";
            else if (status === 401 || status === 403) reason = "Phiên đăng nhập hết hạn hoặc không đủ quyền. Hãy đăng nhập lại.";
            else reason = error.response?.data?.error || error.message || "không rõ lý do";
            setNotification({ show: true, message: `Tải frame thất bại: ${reason}`, type: 'error' });
            setTimeout(() => setNotification({ show: false, message: '', type: 'success' }), 7000);
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
                    // Khung ảnh thẻ: bao nhiêu lỗ trong suốt thì bấy nhiêu ô.
                    const boxes = await detectFrameSlots(frame.url, layoutDef?.idPhoto ? null : layoutDef?.photoCount);

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

            <h1 className="mb-4 text-2xl md:text-3xl font-bold text-[#1a1a2e] tracking-tight">Khung hình</h1>

            {/* Top frame: một hàng cuộn ngang (điện thoại không bị xuống nhiều dòng) */}
            {activeTab !== 'icons' && (topFramesLoading || topFrames.length > 0) && (
                <div className="mb-4 flex items-center gap-2 overflow-x-auto rounded-2xl border border-gray-100 bg-white px-3 py-2.5 shadow-sm [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    <div className="flex shrink-0 items-center gap-1.5 pr-1 text-xs font-bold text-amber-500">
                        <Award size={14} />
                        <span>Top</span>
                    </div>
                    {topFramesLoading ? (
                        <Loader2 size={16} className="animate-spin text-gray-300" />
                    ) : topFrames.map((frame, idx) => (
                        <div key={frame.frame_url} className="flex shrink-0 items-center gap-1.5 rounded-xl border border-gray-100 bg-gray-50 py-1 pl-1 pr-2">
                            <div className="relative h-8 w-8 shrink-0 overflow-hidden rounded-lg border border-gray-100 bg-white">
                                <img src={frame.frame_url} alt={frame.frame_name} loading="lazy" decoding="async" className="h-full w-full object-contain" />
                                <span className="absolute left-0 top-0 rounded-br-md bg-[#1a1a2e] px-1 text-[9px] font-bold leading-[14px] text-white">{idx + 1}</span>
                            </div>
                            <span className="max-w-[90px] truncate text-xs font-semibold text-[#1a1a2e]" title={frame.frame_name}>{frame.frame_name}</span>
                            <span className="shrink-0 text-[11px] font-black text-[#e63946]">{frame.count}×</span>
                        </div>
                    ))}
                </div>
            )}

            <nav className="mb-4 grid grid-cols-3 gap-1 rounded-2xl bg-gray-100 p-1 sm:inline-grid sm:min-w-[420px]">
                {[
                    ['photobooth', 'Photobooth', Camera, () => setSelectedLayout(LAYOUTS.find(l => !l.isMobileOnly && !l.idPhoto)?.id || LAYOUTS[0].id)],
                    ['idphoto', 'Ảnh thẻ', IdCard, () => setSelectedLayout(LAYOUTS.find(l => l.idPhoto)?.id || LAYOUTS[0].id)],
                    // Tab "Upload" (khung isMobileOnly cho luồng tải ảnh từ điện thoại) đã ẩn: tính năng không còn dùng;
                    // khung vẫn còn trên máy chủ, activeTab === 'upload' vẫn xử lý đủ nếu muốn bật lại.
                    ['icons', 'Icons', Smile, null],
                ].map(([k, ten, Icon, chonLayout]) => (
                    <button
                        key={k}
                        type="button"
                        onClick={() => { setActiveTab(k); chonLayout?.(); setSelectedFrames(new Set()); }}
                        className={`flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-bold transition-all ${activeTab === k ? 'bg-white text-[#e63946] shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                        <Icon size={16} /> {ten}
                    </button>
                ))}
            </nav>

            {activeTab === 'icons' ? (
                <IconManager apiBase={FRAME_API_URL} />
            ) : (
              <>
            {/* Layout Selector - Tabs (tab Ảnh thẻ chỉ có một loại -> không cần) */}
            {!isIdTab && <div className="mb-4 overflow-hidden">
                <div className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {filteredLayouts.map(l => (
                        <button
                            key={l.id}
                            onClick={() => setSelectedLayout(l.id)}
                            className={`
                                px-3.5 py-1.5 rounded-full text-xs sm:text-sm font-bold transition-all whitespace-nowrap border
                                ${selectedLayout === l.id
                                    ? 'bg-[#1a1a2e] text-white border-[#1a1a2e]'
                                    : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                                }
                            `}
                        >
                            {l.name}
                        </button>
                    ))}
                </div>
            </div>}

            {/* Thanh công cụ: tên bố cục + số khung | chọn tất cả | (tải mẫu) | tải lên */}
            <div className="mb-4 flex items-center gap-2">
                <h2 className="min-w-0 flex-1 truncate text-base font-bold text-[#1a1a2e]">
                    {isIdTab ? 'Khung ảnh thẻ' : selectedLayoutDef?.name}
                    <span className="ml-1.5 text-xs font-semibold text-gray-400">{framesLoading ? '…' : frames.length}</span>
                </h2>
                {sapXep ? (
                    <>
                        <button
                            type="button"
                            onClick={huySapXep}
                            disabled={dangLuuThuTu}
                            className="flex h-10 shrink-0 items-center rounded-xl border border-gray-200 bg-white px-4 text-sm font-semibold text-gray-600 transition-colors hover:border-gray-300"
                        >
                            Huỷ
                        </button>
                        <button
                            type="button"
                            onClick={luuThuTu}
                            disabled={dangLuuThuTu}
                            className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-[#1a1a2e] px-4 text-sm font-bold text-white transition-all active:scale-95 disabled:opacity-60"
                        >
                            {dangLuuThuTu && <Loader2 size={16} className="animate-spin" />}
                            Lưu thứ tự
                        </button>
                    </>
                ) : (
                    <>
                        {frames.length > 1 && (
                            <button
                                type="button"
                                onClick={batDauSapXep}
                                title="Sắp xếp thứ tự hiển thị"
                                className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-600 transition-colors hover:border-gray-300"
                            >
                                <ArrowUpDown size={16} />
                                <span className="hidden sm:inline">Sắp xếp</span>
                            </button>
                        )}
                        {frames.length > 0 && (
                            <button
                                type="button"
                                onClick={toggleSelectAll}
                                title="Chọn tất cả"
                                className={`flex h-10 shrink-0 items-center gap-1.5 rounded-xl border px-3 text-sm font-semibold transition-colors ${selectedFrames.size === frames.length ? 'border-[#e63946] text-[#e63946]' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'}`}
                            >
                                {selectedFrames.size === frames.length ? <CheckSquare size={16} /> : <Square size={16} />}
                                <span className="hidden sm:inline">Chọn tất cả</span>
                            </button>
                        )}
                        {isIdTab && (
                            <button
                                type="button"
                                onClick={taiToMau}
                                className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 text-sm font-bold text-gray-600 transition-colors hover:border-gray-300"
                                title="Ảnh mẫu 1200×1800 có sẵn các ô ảnh trong suốt để thiết kế khung"
                            >
                                <Download size={16} />
                                <span>Mẫu</span>
                            </button>
                        )}
                        <label className={`flex h-10 shrink-0 cursor-pointer items-center gap-1.5 rounded-xl bg-[#e63946] px-4 text-sm font-bold text-white shadow-md shadow-[#e63946]/15 transition-all hover:bg-[#c1121f] active:scale-95 ${uploading ? 'pointer-events-none opacity-70' : ''}`}>
                            {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                            <span>{uploading ? 'Đang tải' : 'Tải lên'}</span>
                            <input type="file" className="hidden" accept="image/png" multiple onChange={handleUpload} disabled={uploading} />
                        </label>
                    </>
                )}
            </div>

            {isIdTab && (
                <p className="mb-4 text-xs text-gray-500">PNG 1200×1800 px, ô ảnh để trong suốt.</p>
            )}

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

                {/* Banner tạo bù thumbnail — chỉ hiện khi API đã hỗ trợ thumbnail VÀ còn frame thiếu */}
                {!framesLoading && framesSupportThumb(frames) && frames.some((f) => !f.thumb_url) && (
                    <div className="mb-3 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 py-2 pl-3 pr-2 animate-fadeIn">
                        <Images size={16} className="text-amber-600 shrink-0" />
                        <span className="min-w-0 flex-1 text-xs font-medium text-amber-800 sm:text-sm">
                            {backfill.running
                                ? `Đang tạo thumbnail... ${backfill.done}/${backfill.total}`
                                : `${frames.filter((f) => !f.thumb_url).length} khung chưa có ảnh thu nhỏ (tải chậm)`}
                        </span>
                        <button
                            type="button"
                            onClick={handleBackfillThumbnails}
                            disabled={backfill.running}
                            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {backfill.running ? <Loader2 size={14} className="animate-spin" /> : <Images size={14} />}
                            {backfill.running ? 'Đang tạo…' : 'Tạo ngay'}
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
                        <div ref={luoiRef} className={`grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2 sm:gap-3 mb-20 animate-fadeIn ${sapXep ? 'select-none' : ''}`}>
                            {frames.map((frame) => {
                                const isSelected = selectedFrames.has(frame.id);
                                return (
                                    <div
                                        key={frame.id}
                                        // content-visibility: bỏ qua giải mã/vẽ các card NGOÀI màn hình
                                        // -> mở grid nhiều frame nhẹ hơn hẳn. 'auto 340px' giữ chỗ để
                                        // thanh cuộn không nhảy.
                                        data-frame-id={frame.id}
                                        style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 340px', touchAction: sapXep ? 'none' : undefined }}
                                        className={`group relative bg-white rounded-2xl overflow-hidden transition-shadow
                                            ${sapXep ? 'cursor-grab border border-dashed border-gray-300 active:cursor-grabbing' : 'cursor-pointer'}
                                            ${keoId === frame.id ? 'z-10 scale-[1.03] opacity-80 shadow-xl ring-2 ring-[#1a1a2e]' : ''}
                                            ${!sapXep && isSelected ? 'ring-2 ring-[#e63946] shadow-md' : ''}
                                            ${!sapXep && !isSelected ? 'border border-gray-100 hover:shadow-md' : ''}
                                        `}
                                        onPointerDown={(e) => batDauKeo(e, frame.id)}
                                        // Ảnh trong thẻ mặc định kéo được kiểu HTML5 -> trình duyệt nuốt pointermove, thẻ không đổi chỗ.
                                        onDragStart={(e) => { if (sapXep) e.preventDefault(); }}
                                        onClick={() => { if (!sapXep) toggleSelectFrame(frame.id); }}
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
                                        <div className={`absolute top-1.5 left-1.5 z-30 transition-all duration-200 ${sapXep ? 'hidden' : isSelected || selectedFrames.size > 0 ? 'opacity-100 scale-100' : 'opacity-0 scale-90 group-hover:opacity-100 group-hover:scale-100'}`}>
                                            <div className={`w-5 h-5 rounded-md border flex items-center justify-center ${isSelected ? 'bg-[#e63946] border-[#e63946] text-white' : 'bg-white border-gray-300 text-transparent hover:border-[#e63946]'}`}>
                                                <CheckSquare size={14} fill="currentColor" />
                                            </div>
                                        </div>

                                        {/* ICON PREVIEW (If exists) */}
                                        {frame.icon_url && (
                                            <div className="absolute top-1.5 right-1.5 z-30 w-7 h-7 rounded-full border-2 border-white shadow bg-white overflow-hidden" title="Biểu tượng đã gán">
                                                <img src={frame.icon_url} loading="lazy" decoding="async" className="w-full h-full object-cover" alt="Icon" />
                                            </div>
                                        )}

                                        {/* Frame Preview */}
                                        <div
                                            className="bg-gray-50/70 relative overflow-hidden"
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
                                                className="relative z-10 w-full h-full object-contain p-1"
                                            />

                                        </div>

                                        {/* Chân thẻ: tên + nút cấu hình lưới / xoá (luôn hiện, không phủ lên ảnh khung) */}
                                        <div className="flex items-center border-t border-gray-100 py-1 pl-2 pr-0.5 sm:pl-3 sm:pr-1">
                                            <p className="min-w-0 flex-1 truncate text-[11px] font-semibold text-[#1a1a2e] sm:text-xs" title={frame.name}>{frame.name}</p>
                                            {sapXep ? (
                                                <span className="grid h-8 w-7 shrink-0 place-items-center text-gray-400"><GripVertical size={16} /></span>
                                            ) : (<>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); setEditingFrame(frame); }}
                                                className="grid h-8 w-7 shrink-0 place-items-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-[#1a1a2e]"
                                                title="Cấu hình lưới"
                                            >
                                                <Settings size={15} />
                                            </button>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); confirmDelete(frame); }}
                                                className="grid h-8 w-7 shrink-0 place-items-center rounded-lg text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
                                                title="Xóa khung hình"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                            </>)}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-gray-200 bg-white p-10 text-center text-sm font-semibold text-gray-400 transition-colors hover:border-[#e63946]/40 hover:text-[#e63946]">
                            <Upload size={28} />
                            Chưa có khung nào
                            <input type="file" className="hidden" accept="image/png" multiple onChange={handleUpload} disabled={uploading} />
                        </label>
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
