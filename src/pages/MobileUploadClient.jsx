import React, { useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Upload, CheckCircle, AlertCircle, Loader, ImagePlus, RotateCcw } from 'lucide-react';
import { motion } from 'framer-motion';
import { useWorkflow } from '../context/WorkflowContext';

const CLOUD_API_URL = import.meta.env.VITE_CLOUD_API_URL || '';
const CREAM = '#FFF8E7';
const BEIGE = '#D5B895';
const BEIGE_DARK = '#8E6B4D';
const TEXT_PRIMARY = '#7B5E43';
const TEXT_SECONDARY = '#5E6B78';
const MAX_UPLOAD_DIMENSION = 1800;
const JPEG_QUALITY = 0.86;
const UPLOAD_TIMEOUT_MS = 45000;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const formatBytes = (bytes) => {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const canvasToBlob = (canvas, type = 'image/jpeg', quality = JPEG_QUALITY) => new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
});

const loadImageFromFile = (file) => new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
    };
    img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Không đọc được ảnh trên thiết bị này.'));
    };
    img.src = url;
});

const compressImageFile = async (file, index) => {
    if (!file.type.startsWith('image/')) return file;

    try {
        const img = await loadImageFromFile(file);
        const scale = Math.min(1, MAX_UPLOAD_DIMENSION / Math.max(img.naturalWidth, img.naturalHeight));

        if (scale >= 1 && file.type === 'image/jpeg' && file.size <= 3 * 1024 * 1024) {
            return file;
        }

        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
        const ctx = canvas.getContext('2d', { alpha: false });
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        const blob = await canvasToBlob(canvas);
        if (!blob) return file;

        return new File([blob], `mobile_${index + 1}.jpg`, { type: 'image/jpeg' });
    } catch (error) {
        console.warn('Image compression skipped:', error);
        return file;
    }
};

const uploadWithRetry = async (url, formData, retries = 2) => {
    let lastError = null;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);

        try {
            const response = await fetch(url, {
                method: 'POST',
                body: formData,
                signal: controller.signal,
            });

            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                const error = new Error(data.error || 'Upload thất bại');
                error.status = response.status;
                error.data = data;
                throw error;
            }

            return data;
        } catch (error) {
            lastError = error;
            if (attempt === retries || error.status === 409) break;
            await wait(800 * (attempt + 1));
        } finally {
            window.clearTimeout(timeout);
        }
    }

    throw lastError || new Error('Upload thất bại');
};

const MobileUploadClient = () => {
    const { sessionId } = useParams();
    const { configs } = useWorkflow();
    const logoUrl = configs?.logo_main || '/logo_tomato.png';
    const [searchParams] = useSearchParams();
    const limit = parseInt(searchParams.get('limit'), 10) || 4;

    const [files, setFiles] = useState([]);
    const [previews, setPreviews] = useState([]);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadStatus, setUploadStatus] = useState(null);
    const [errorMsg, setErrorMsg] = useState('');
    const [currentUpload, setCurrentUpload] = useState(null);

    React.useEffect(() => {
        if (localStorage.getItem(`uploaded_session_${sessionId}`) === 'true') {
            setUploadStatus('success');
        }

        const objectUrls = files.map((file) => URL.createObjectURL(file));
        setPreviews(objectUrls);

        return () => objectUrls.forEach((url) => URL.revokeObjectURL(url));
    }, [files, sessionId]);

    // Kiosk khóa cuộn toàn cục (body overflow:hidden) -> trang mobile này cần bật lại
    // để cuộn được, nếu không nút "Tải lên" bị thanh trình duyệt che. Khôi phục khi rời trang.
    React.useEffect(() => {
        const html = document.documentElement;
        const body = document.body;
        const prev = {
            ho: html.style.overflow, bo: body.style.overflow,
            hh: html.style.height, bh: body.style.height,
        };
        html.style.overflow = 'auto';
        body.style.overflow = 'auto';
        html.style.height = 'auto';
        body.style.height = 'auto';
        return () => {
            html.style.overflow = prev.ho;
            body.style.overflow = prev.bo;
            html.style.height = prev.hh;
            body.style.height = prev.bh;
        };
    }, []);

    const handleFileChange = (e) => {
        if (!e.target.files || e.target.files.length === 0) return;

        let selectedFiles = Array.from(e.target.files);
        const invalidFile = selectedFiles.find((file) => !file.type.startsWith('image/'));

        if (invalidFile) {
            setErrorMsg('Vui lòng chỉ chọn file ảnh.');
            return;
        }

        if (selectedFiles.length > limit) {
            setErrorMsg(`Bạn chỉ được chọn tối đa ${limit} ảnh. Các ảnh thừa đã được bỏ qua.`);
            selectedFiles = selectedFiles.slice(0, limit);
        } else if (selectedFiles.length < limit) {
            setErrorMsg(`Vui lòng chọn đủ ${limit} ảnh để gửi lên Photobooth.`);
        } else {
            setErrorMsg('');
        }

        setUploadStatus(null);
        setFiles(selectedFiles);
    };

    const handleUpload = async () => {
        if (files.length !== limit || isUploading) return;

        setIsUploading(true);
        setUploadStatus(null);
        setErrorMsg('');
        setCurrentUpload({ index: 0, total: files.length, phase: 'Đang chuẩn bị ảnh...' });

        try {
            for (let index = 0; index < files.length; index += 1) {
                const file = files[index];
                setCurrentUpload({ index: index + 1, total: files.length, phase: `Đang nén ảnh ${index + 1}/${files.length}...` });
                const uploadFile = await compressImageFile(file, index);

                const formData = new FormData();
                formData.append('file', uploadFile);
                formData.append('session_id', sessionId);
                formData.append('slot_index', String(index));
                formData.append('expected_count', String(limit));

                setCurrentUpload({
                    index: index + 1,
                    total: files.length,
                    phase: `Đang tải ảnh ${index + 1}/${files.length} (${formatBytes(uploadFile.size)})...`,
                });
                await uploadWithRetry(`${CLOUD_API_URL}/api/upload/mobile`, formData);
            }

            setUploadStatus('success');
            setFiles([]);
            localStorage.setItem(`uploaded_session_${sessionId}`, 'true');
        } catch (error) {
            console.error('Lỗi upload:', error);
            setUploadStatus('error');

            if (error.status === 409) {
                setErrorMsg(error.data?.error || 'Phiên này đã nhận đủ ảnh. Vui lòng quay lại màn hình photobooth.');
            } else if (error.name === 'AbortError') {
                setErrorMsg('Mạng yếu hoặc ảnh quá nặng, upload bị quá thời gian. Vui lòng thử lại gần WiFi hơn.');
            } else {
                setErrorMsg(error.message || 'Upload thất bại. Vui lòng thử lại.');
            }
        } finally {
            setIsUploading(false);
            setCurrentUpload(null);
        }
    };

    return (
        <div
            className="px-4 pt-6 font-sans"
            style={{
                backgroundColor: CREAM,
                minHeight: '100dvh',
                // Đệm dưới rộng + safe-area: đảm bảo trang luôn cuộn được để thanh Safari
                // thu lại và nút "Tải lên" không bị che. KHÔNG ép căn giữa để cuộn ổn định trên iOS.
                paddingBottom: 'calc(env(safe-area-inset-bottom) + 6rem)',
            }}
        >
            <div className="mx-auto w-full max-w-md">
                <div className="w-full overflow-hidden rounded-3xl border border-[#E7D3B7] bg-white shadow-[0_18px_50px_rgba(142,107,77,0.18)]">
                    <div className="border-b border-[#E7D3B7] p-6 text-center" style={{ backgroundColor: '#F7E8CF' }}>
                        <img
                            src={logoUrl}
                            onError={(e) => { if (!e.currentTarget.src.endsWith('/logo_tomato.png')) e.currentTarget.src = '/logo_tomato.png'; }}
                            alt="Tomato Photobooth"
                            className="mx-auto mb-3 h-16 w-16 object-contain"
                        />
                        <h1 className="font-serif text-3xl font-extrabold leading-tight" style={{ color: TEXT_PRIMARY }}>
                            Gửi ảnh lên Tomato Photobooth
                        </h1>
                        <p className="mt-2 text-sm font-semibold" style={{ color: TEXT_SECONDARY }}>
                            Chọn đúng {limit} ảnh yêu thích của bạn
                        </p>
                    </div>

                    <div className="flex flex-col items-center space-y-6 p-6">
                        {uploadStatus === 'success' && (
                            <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="mb-2 flex flex-col items-center">
                                <CheckCircle size={56} className="mb-4" style={{ color: TEXT_PRIMARY }} />
                                <p className="text-center font-serif text-2xl font-extrabold" style={{ color: TEXT_PRIMARY }}>
                                    Tải ảnh lên thành công!
                                </p>
                                <div className="mt-4 space-y-2 rounded-2xl border border-[#E7D3B7] bg-[#FFF8E7] p-4 text-center">
                                    <p className="text-sm" style={{ color: TEXT_SECONDARY }}>
                                        Ảnh của bạn đã được chuyển tới máy Photobooth.
                                    </p>
                                    <p className="text-sm font-bold" style={{ color: TEXT_PRIMARY }}>
                                        Vui lòng quay lại màn hình chính để tiếp tục.
                                    </p>
                                </div>
                                <p className="mt-6 text-center text-sm font-semibold" style={{ color: TEXT_SECONDARY }}>
                                    Cảm ơn bạn đã sử dụng dịch vụ.
                                </p>
                            </motion.div>
                        )}

                        {uploadStatus === 'error' && (
                            <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="mb-4 flex flex-col items-center text-red-500">
                                <AlertCircle size={48} className="mb-2" />
                                <p className="text-center text-lg font-bold">Có lỗi xảy ra!</p>
                                <p className="mt-1 text-center text-sm opacity-80">{errorMsg || 'Vui lòng thử lại sau.'}</p>
                            </motion.div>
                        )}

                        {!isUploading && uploadStatus !== 'success' && (
                            <div className="w-full">
                                <label className="relative flex h-44 w-full cursor-pointer flex-col items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-[#D5B895] bg-[#FFF8E7] transition-none active:bg-[#F7E8CF]">
                                    <div className="flex flex-col items-center justify-center pb-6 pt-5">
                                        <ImagePlus size={42} className="mb-3 transition-none" style={{ color: TEXT_PRIMARY }} />
                                        <p className="mb-2 text-center text-base" style={{ color: TEXT_SECONDARY }}>
                                            <span className="font-bold" style={{ color: TEXT_PRIMARY }}>
                                                {files.length > 0 ? 'Chạm để chọn lại ảnh' : `Chạm để chọn ${limit} ảnh`}
                                            </span>
                                        </p>
                                        <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: TEXT_SECONDARY }}>
                                            PNG, JPG, HEIC
                                        </p>
                                    </div>
                                    <input type="file" className="hidden" multiple accept="image/*" onChange={handleFileChange} />
                                </label>
                                {errorMsg && (
                                    <p className="mt-3 rounded-xl border border-[#F0B6A8] bg-[#FFF4F1] p-3 text-center text-sm font-semibold text-[#B6503A]">
                                        {errorMsg}
                                    </p>
                                )}
                            </div>
                        )}

                        {files.length > 0 && (
                            <div className="w-full">
                                <div className="mb-3 flex items-center justify-between">
                                    <p className="text-sm font-bold" style={{ color: TEXT_PRIMARY }}>
                                        Đã chọn ({files.length}/{limit} ảnh)
                                    </p>
                                    {!isUploading && uploadStatus !== 'success' && (
                                        <button
                                            type="button"
                                            onClick={() => { setFiles([]); setErrorMsg(''); }}
                                            className="inline-flex items-center gap-1 rounded-xl border border-[#E7D3B7] px-3 py-1.5 text-xs font-bold transition-none active:bg-[#FFF8E7]"
                                            style={{ color: TEXT_PRIMARY }}
                                        >
                                            <RotateCcw size={14} />
                                            Chọn lại
                                        </button>
                                    )}
                                </div>
                                <div className="grid w-full grid-cols-2 gap-3">
                                    {previews.map((src, i) => (
                                        <div key={src} className="relative aspect-[3/4] overflow-hidden rounded-2xl border-2 border-[#F1DDBE] bg-[#FFF8E7] shadow-sm">
                                            <img src={src} alt={`Preview ${i + 1}`} className="h-full w-full object-cover" />
                                            <div className="absolute left-2 top-2 flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold text-white" style={{ backgroundColor: TEXT_PRIMARY }}>
                                                {i + 1}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {!isUploading && uploadStatus !== 'success' && (
                            <button
                                type="button"
                                onClick={handleUpload}
                                disabled={files.length !== limit}
                                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-lg font-bold text-white shadow-[0_12px_24px_rgba(142,107,77,0.2)] transition-none active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-55"
                                style={{ backgroundColor: files.length === limit ? BEIGE_DARK : BEIGE }}
                            >
                                <Upload size={20} />
                                {files.length === limit ? 'Tải lên bây giờ' : `Chọn đủ ${limit} ảnh`}
                            </button>
                        )}

                        {isUploading && (
                            <div className="flex flex-col items-center justify-center py-8">
                                <Loader className="mb-4 animate-spin" style={{ color: TEXT_PRIMARY }} size={40} />
                                <p className="animate-pulse text-center font-semibold" style={{ color: TEXT_SECONDARY }}>
                                    {currentUpload?.phase || 'Đang tải ảnh lên...'}
                                </p>
                                {currentUpload && (
                                    <p className="mt-2 text-sm font-bold" style={{ color: TEXT_PRIMARY }}>
                                        {currentUpload.index}/{currentUpload.total}
                                    </p>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default MobileUploadClient;
