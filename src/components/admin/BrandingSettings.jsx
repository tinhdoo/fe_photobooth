import React, { useEffect, useState } from 'react';
import { Upload, Image as ImageIcon, Loader2, Palette, CheckCircle2, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { useWorkflow } from '../../context/WorkflowContext';

const API_URL = import.meta.env.VITE_API_URL || '';
const CLOUD_API_URL = import.meta.env.VITE_CLOUD_API_URL
    || (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
        ? 'https://tomatophotobooth.vercel.app'
        : '');
const apiPath = (path) => `${CLOUD_API_URL || API_URL}${path}`;

const pageBackgrounds = [
    { id: 'source-selection', label: 'Chọn nguồn ảnh (source-selection)' },
    { id: 'choose-slot', label: 'Chọn loại khung (choose-slot)' },
    { id: 'select-photo-number', label: 'Chọn số lượng ảnh (select-photo-number)' },
    { id: 'payment', label: 'Thanh toán (payment)' },
    { id: 'payment-wait', label: 'Thanh toán hoàn tất (payment-wait)' },
    { id: 'select-photo', label: 'Chọn ảnh yêu thích (select-photo)' },
    { id: 'filter-adjustment', label: 'Chọn màu filter (filter-adjustment)' },
    { id: 'preview-when', label: 'Chọn kiểu khung (preview-when)' },
    { id: 'print-photo', label: 'In ảnh (print-photo)' },
    { id: 'wait-print-photo', label: 'Chờ in ảnh (wait-print-photo)' },
    { id: 'qr-photo', label: 'QR code ảnh (qr-photo)' },
];

const colorControls = [
    { key: 'brand_text_primary', label: 'Màu chữ chính', fallback: '#7B5E43' },
    { key: 'brand_text_secondary', label: 'Màu chữ mô tả', fallback: '#5E6B78' },
];

const isVideoUrl = (url = '') => /\.(mp4|webm|mov)(\?|$)/i.test(url);
const MAX_BRANDING_UPLOAD_MB = 100;
const MAX_BRANDING_UPLOAD_BYTES = MAX_BRANDING_UPLOAD_MB * 1024 * 1024;

const MediaPreview = ({ src, alt, contain = false }) => {
    if (isVideoUrl(src)) {
        return (
            <video
                src={src}
                className={`h-full w-full ${contain ? 'object-contain' : 'object-cover'}`}
                muted
                loop
                playsInline
                autoPlay
                preload="metadata"
            />
        );
    }

    return <img src={src} alt={alt} className={`h-full w-full ${contain ? 'object-contain' : 'object-cover'}`} />;
};

const StatusBanner = ({ message }) => {
    if (!message) return null;

    const styles = {
        loading: 'border-[#F1DDBE] bg-[#FFF8E7] text-[#7B5E43]',
        success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
        error: 'border-red-200 bg-red-50 text-red-700',
    };

    const Icon = message.type === 'loading' ? Loader2 : message.type === 'success' ? CheckCircle2 : AlertCircle;

    return (
        <div className={`flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm font-bold ${styles[message.type]}`}>
            <Icon size={18} className={message.type === 'loading' ? 'animate-spin' : ''} />
            <span>{message.text}</span>
        </div>
    );
};

const BrandingSettings = () => {
    const { configs, refreshConfigs, applyConfigs } = useWorkflow();
    const [localConfigs, setLocalConfigs] = useState({});
    const [uploadingKey, setUploadingKey] = useState(null);
    const [savingColors, setSavingColors] = useState(false);
    const [statusMessage, setStatusMessage] = useState(null);

    useEffect(() => {
        setLocalConfigs((prev) => ({ ...prev, ...configs }));
    }, [configs]);

    const showLoading = (message) => setStatusMessage({ type: 'loading', text: message });

    const showSuccess = (message) => {
        setStatusMessage({ type: 'success', text: message });
        toast.success(message);
    };

    const showError = (message) => {
        setStatusMessage({ type: 'error', text: message });
        toast.error(message);
    };

    const saveConfigs = async (payload, successMessage = 'Đã cập nhật cấu hình.') => {
        const response = await fetch(apiPath('/api/config'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw new Error(data.error || `Không thể lưu cấu hình (${response.status}).`);
        }

        applyConfigs?.(data);
        setLocalConfigs((prev) => ({ ...prev, ...data }));
        await refreshConfigs?.();
        showSuccess(successMessage);
    };

    const handleFileChange = async (key, event) => {
        const file = event.target.files?.[0];
        if (!file) return;

        if (file.size > MAX_BRANDING_UPLOAD_BYTES) {
            showError(`File quá lớn. Vui lòng chọn file dưới ${MAX_BRANDING_UPLOAD_MB}MB.`);
            event.target.value = '';
            return;
        }

        setUploadingKey(key);
        showLoading(`Đang tải lên ${file.name}...`);

        try {
            const prepareResponse = await fetch(apiPath('/api/upload-branding'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'prepare',
                    key,
                    filename: file.name,
                    mimetype: file.type,
                }),
            });
            const prepared = await prepareResponse.json().catch(() => ({}));

            if (!prepareResponse.ok) {
                throw new Error(prepared.error || `Không thể chuẩn bị upload (${prepareResponse.status}).`);
            }

            showLoading(`Đang gửi ${file.name} lên Supabase...`);
            const uploadResponse = await fetch(prepared.signedUrl, {
                method: 'PUT',
                headers: {
                    'x-upsert': 'true',
                },
                body: (() => {
                    const data = new FormData();
                    data.append('cacheControl', '3600');
                    data.append('', file);
                    return data;
                })(),
            });

            if (!uploadResponse.ok) {
                const errorText = await uploadResponse.text().catch(() => '');
                throw new Error(errorText || `Không thể upload file lên Supabase (${uploadResponse.status}).`);
            }

            showLoading('Đang lưu cấu hình background...');
            const finalizeResponse = await fetch(apiPath('/api/upload-branding'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'finalize',
                    key,
                    objectPath: prepared.objectPath,
                }),
            });
            const data = await finalizeResponse.json().catch(() => ({}));

            if (!finalizeResponse.ok) {
                throw new Error(data.error || `Không thể lưu cấu hình (${finalizeResponse.status}).`);
            }

            const nextConfig = { [key]: data.url };
            setLocalConfigs((prev) => ({ ...prev, ...nextConfig }));
            applyConfigs?.(nextConfig);
            await refreshConfigs?.();
            showSuccess('Tải lên thành công.');
        } catch (error) {
            console.error('Branding upload failed:', error);
            showError(error.message || 'Lỗi kết nối máy chủ.');
        } finally {
            setUploadingKey(null);
            event.target.value = '';
        }
    };

    const handleColorChange = (key, value) => {
        setLocalConfigs((prev) => ({ ...prev, [key]: value }));
    };

    const handleSaveColors = async () => {
        setSavingColors(true);
        showLoading('Đang lưu màu chữ...');
        try {
            const payload = colorControls.reduce((acc, item) => {
                acc[item.key] = localConfigs[item.key] || item.fallback;
                return acc;
            }, {});
            await saveConfigs(payload, 'Đã cập nhật màu chữ.');
        } catch (error) {
            console.error('Brand color save failed:', error);
            showError(error.message || 'Không thể lưu màu chữ.');
        } finally {
            setSavingColors(false);
        }
    };

    const UploadInput = ({ configKey }) => (
        <input
            type="file"
            className="absolute inset-0 z-20 h-full w-full cursor-pointer opacity-0"
            accept="image/*,video/mp4,video/webm"
            onChange={(event) => handleFileChange(configKey, event)}
            disabled={uploadingKey === configKey}
        />
    );

    const renderPreviewBox = (key, label, contain = false) => {
        const mediaUrl = localConfigs[key];
        const isUploading = uploadingKey === key;

        return (
            <div className="relative flex aspect-video w-full cursor-pointer flex-col items-center justify-center overflow-hidden rounded-3xl border-2 border-dashed border-[#F1DDBE] bg-[#FFF8E7] p-4">
                <UploadInput configKey={key} />
                {mediaUrl ? (
                    <MediaPreview src={mediaUrl} alt={label} contain={contain} />
                ) : (
                    <>
                        <ImageIcon className="mb-2 h-10 w-10 text-[#D5B895]" />
                        <span className="text-sm font-medium text-[#8E6B4D]">Tải lên {label.toLowerCase()}</span>
                    </>
                )}

                {isUploading && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/80 backdrop-blur-sm">
                        <Loader2 className="h-8 w-8 animate-spin text-[#7B5E43]" />
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="mx-auto max-w-6xl space-y-8 pb-12">
            <StatusBanner message={statusMessage} />

            <section className="rounded-2xl border border-[#F1DDBE] bg-white p-6 shadow-sm">
                <div className="mb-6">
                    <h2 className="mb-1 text-xl font-bold text-[#3F3127]">Thương hiệu</h2>
                    <p className="text-sm text-[#7A5A3B]">Hình ảnh hiển thị trên giao diện booth.</p>
                </div>

                <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
                    <div>
                        <h3 className="mb-3 text-sm font-semibold text-[#3F3127]">Logo hệ thống</h3>
                        {renderPreviewBox('logo_main', 'Logo', true)}
                    </div>
                    <div>
                        <div className="mb-3 flex items-center justify-between gap-3">
                            <h3 className="text-sm font-semibold text-[#3F3127]">Background chính (Welcome)</h3>
                            <span className="text-[11px] text-[#A88763]">Hỗ trợ .jpg / .png / .mp4</span>
                        </div>
                        {renderPreviewBox('bg_welcome', 'Background chính')}
                    </div>
                </div>
            </section>

            <section className="rounded-2xl border border-[#F1DDBE] bg-white p-6 shadow-sm">
                <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div>
                        <h2 className="mb-1 text-xl font-bold text-[#3F3127]">Màu chữ giao diện</h2>
                        <p className="text-sm text-[#7A5A3B]">Áp dụng cho các tiêu đề và mô tả trong luồng photobooth.</p>
                    </div>
                    <button
                        type="button"
                        onClick={handleSaveColors}
                        disabled={savingColors}
                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#D5B895] px-5 py-3 text-sm font-bold text-white shadow-sm transition-none active:scale-95 disabled:opacity-60"
                    >
                        {savingColors ? <Loader2 size={16} className="animate-spin" /> : <Palette size={16} />}
                        Lưu màu
                    </button>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                    {colorControls.map((item) => {
                        const value = localConfigs[item.key] || item.fallback;
                        return (
                            <label key={item.key} className="flex items-center justify-between gap-4 rounded-2xl border border-[#F1DDBE] bg-[#FFF8E7] p-4">
                                <div>
                                    <span className="block text-sm font-bold text-[#3F3127]">{item.label}</span>
                                    <span className="block text-xs font-semibold uppercase text-[#8E6B4D]">{value}</span>
                                </div>
                                <input
                                    type="color"
                                    value={value}
                                    onChange={(event) => handleColorChange(item.key, event.target.value)}
                                    className="h-12 w-16 cursor-pointer rounded-xl border border-[#F1DDBE] bg-white p-1"
                                />
                            </label>
                        );
                    })}
                </div>
            </section>

            <section className="rounded-2xl border border-[#F1DDBE] bg-white p-6 shadow-sm">
                <div className="mb-6">
                    <h2 className="mb-1 text-xl font-bold text-[#3F3127]">Hình nền từng trang</h2>
                    <p className="text-sm text-[#7A5A3B]">Cấu hình ảnh nền riêng cho từng màn hình trong luồng chụp.</p>
                </div>

                <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {pageBackgrounds.map((page) => {
                        const configKey = `bg_${page.id}`;
                        const mediaUrl = localConfigs[configKey];
                        const isUploading = uploadingKey === configKey;

                        return (
                            <article key={page.id} className="flex flex-col items-center rounded-2xl border border-[#F1DDBE] bg-[#FFF8E7] p-4">
                                <h3 className="mb-3 self-start text-xs font-bold text-[#3F3127]">{page.label}</h3>

                                <div className="relative mb-4 flex aspect-video w-full items-center justify-center overflow-hidden rounded-xl border border-dashed border-[#F1DDBE] bg-white">
                                    <UploadInput configKey={configKey} />
                                    {mediaUrl ? (
                                        <MediaPreview src={mediaUrl} alt={page.label} />
                                    ) : (
                                        <>
                                            <span className="text-xs font-bold text-[#C66F5A] opacity-75">Chưa cấu hình</span>
                                            <div className="absolute inset-x-0 bottom-0 flex h-4 items-center justify-center bg-[#D5B895]/25">
                                                <div className="h-1 w-1/2 rounded-full bg-white/70" />
                                            </div>
                                        </>
                                    )}

                                    {isUploading && (
                                        <div className="absolute inset-0 z-10 flex cursor-wait items-center justify-center bg-white/80 backdrop-blur-sm">
                                            <Loader2 className="h-6 w-6 animate-spin text-[#7B5E43]" />
                                        </div>
                                    )}
                                </div>

                                <label className={`relative flex w-full items-center justify-center gap-2 rounded-xl bg-[#D5B895] py-2 text-sm font-bold text-white ${isUploading ? 'opacity-50' : 'cursor-pointer'}`}>
                                    <UploadInput configKey={configKey} />
                                    <Upload size={16} strokeWidth={2.5} />
                                    {isUploading ? 'Đang tải...' : 'Cập nhật'}
                                </label>
                            </article>
                        );
                    })}
                </div>
            </section>
        </div>
    );
};

export default BrandingSettings;
