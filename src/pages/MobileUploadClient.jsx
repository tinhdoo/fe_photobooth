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

    React.useEffect(() => {
        if (localStorage.getItem(`uploaded_session_${sessionId}`) === 'true') {
            setUploadStatus('success');
        }

        const objectUrls = files.map((file) => URL.createObjectURL(file));
        setPreviews(objectUrls);

        return () => objectUrls.forEach((url) => URL.revokeObjectURL(url));
    }, [files, sessionId]);

    const handleFileChange = (e) => {
        if (!e.target.files || e.target.files.length === 0) return;

        let selectedFiles = Array.from(e.target.files);
        if (selectedFiles.length > limit) {
            setErrorMsg(`Bạn chỉ được chọn tối đa ${limit} ảnh. Các ảnh thừa đã được bỏ qua.`);
            selectedFiles = selectedFiles.slice(0, limit);
        } else if (selectedFiles.length < limit) {
            setErrorMsg(`Vui lòng chọn đủ ${limit} ảnh để gửi lên Photobooth.`);
        } else {
            setErrorMsg('');
        }
        setFiles(selectedFiles);
    };

    const handleUpload = async () => {
        if (files.length !== limit) return;
        setIsUploading(true);
        setUploadStatus(null);

        try {
            for (const file of files) {
                const formData = new FormData();
                formData.append('file', file);
                formData.append('session_id', sessionId);

                const response = await fetch(`${CLOUD_API_URL}/api/upload/mobile`, {
                    method: 'POST',
                    body: formData,
                });

                if (!response.ok) {
                    throw new Error('Upload thất bại');
                }
            }

            setUploadStatus('success');
            setFiles([]);
            localStorage.setItem(`uploaded_session_${sessionId}`, 'true');
        } catch (error) {
            console.error('Lỗi upload:', error);
            setUploadStatus('error');
        } finally {
            setIsUploading(false);
        }
    };

    return (
        <div className="min-h-screen overflow-y-auto px-4 py-6 font-sans" style={{ backgroundColor: CREAM }}>
            <div className="mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-md flex-col justify-center">
                <div className="w-full overflow-hidden rounded-3xl border border-[#E7D3B7] bg-white shadow-[0_18px_50px_rgba(142,107,77,0.18)]">
                    <div className="border-b border-[#E7D3B7] p-6 text-center" style={{ backgroundColor: '#F7E8CF' }}>
                        <img
                            src={logoUrl}
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
                                <p className="mt-1 text-center text-sm opacity-80">Vui lòng thử lại sau.</p>
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
                                <p className="animate-pulse font-semibold" style={{ color: TEXT_SECONDARY }}>
                                    Đang tải ảnh lên...
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default MobileUploadClient;
