import React, { useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Upload, CheckCircle, AlertCircle, Loader } from 'lucide-react';
import { motion } from 'framer-motion';
import { useWorkflow } from '../context/WorkflowContext';

const API_URL = import.meta.env.VITE_API_URL || '';

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
            setErrorMsg(`Bạn chỉ được chọn tối đa ${limit} ảnh. Các ảnh thừa đã bị loại bỏ.`);
            selectedFiles = selectedFiles.slice(0, limit);
        } else if (selectedFiles.length < limit) {
            setErrorMsg(`Vui lòng chọn thêm ảnh, cần đúng ${limit} ảnh.`);
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

                const response = await fetch(`${API_URL}/api/upload/mobile`, {
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
        <div className="flex min-h-screen flex-col items-center justify-center bg-[#F9FAF7] p-6 font-sans">
            <div className="w-full max-w-md overflow-hidden rounded-3xl border border-gray-100 bg-white shadow-xl">
                <div className="bg-[#B5C1B0] p-6 text-center text-white">
                    <img
                        src={logoUrl}
                        alt="Tomato Photobooth"
                        className="mx-auto mb-3 h-16 w-16 rounded-full object-contain"
                    />
                    <h1 className="font-serif text-2xl font-bold">Gửi ảnh lên Tomato Photobooth</h1>
                    <p className="mt-1 text-sm opacity-90">Phiên làm việc: {sessionId ? sessionId.substring(0, 8) : 'N/A'}</p>
                </div>

                <div className="flex flex-col items-center space-y-6 p-8">
                    {uploadStatus === 'success' && (
                        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="mb-4 flex flex-col items-center text-green-600">
                            <CheckCircle size={56} className="mb-4 text-[#52796f]" />
                            <p className="text-center font-serif text-2xl font-bold text-[#2f3e46]">Tải ảnh lên thành công!</p>
                            <div className="mt-4 space-y-2 rounded-xl border border-green-100 bg-green-50 p-4 text-center">
                                <p className="text-sm text-green-800">Ảnh của bạn đã được chuyển tới máy Photobooth.</p>
                                <p className="text-sm font-bold text-green-900">Vui lòng quay lại màn hình chính của máy để tiếp tục.</p>
                            </div>
                            <p className="mt-8 text-sm font-medium uppercase tracking-wide text-gray-500">Cảm ơn bạn đã sử dụng dịch vụ.</p>
                        </motion.div>
                    )}

                    {uploadStatus === 'error' && (
                        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="mb-4 flex flex-col items-center text-red-500">
                            <AlertCircle size={48} className="mb-2" />
                            <p className="text-center text-lg font-medium">Có lỗi xảy ra!</p>
                            <p className="mt-1 text-center text-sm opacity-80">Vui lòng thử lại sau.</p>
                        </motion.div>
                    )}

                    {!isUploading && uploadStatus !== 'success' && (
                        <div className="w-full">
                            <label className="relative flex h-40 w-full cursor-pointer flex-col items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-[#85937F] bg-gray-50 transition-none active:bg-[#F9FAF7]">
                                <div className="flex flex-col items-center justify-center pb-6 pt-5">
                                    <Upload size={40} className="mb-3 text-[#85937F] transition-none" />
                                    <p className="mb-2 text-sm text-gray-500">
                                        <span className="font-semibold text-gray-700">
                                            {files.length > 0 ? 'Chạm vào đây để chọn lại' : `Chạm để chọn ${limit} ảnh`}
                                        </span>
                                    </p>
                                    <p className="text-xs text-gray-400">PNG, JPG</p>
                                </div>
                                <input type="file" className="hidden" multiple accept="image/*" onChange={handleFileChange} />
                            </label>
                            {errorMsg && <p className="mt-3 rounded-xl border border-red-100 bg-red-50 p-2 text-center text-sm font-medium text-red-500">{errorMsg}</p>}
                        </div>
                    )}

                    {files.length > 0 && (
                        <div className="w-full">
                            <div className="mb-3 flex items-center justify-between">
                                <p className="text-sm font-bold text-gray-700">Đã chọn ({files.length}/{limit} ảnh):</p>
                                {!isUploading && uploadStatus !== 'success' && (
                                    <button
                                        type="button"
                                        onClick={() => { setFiles([]); setErrorMsg(''); }}
                                        className="rounded-lg border border-red-100 px-3 py-1.5 text-xs font-bold text-[#e63946] transition-none active:bg-red-50"
                                    >
                                        Hủy chọn tất cả
                                    </button>
                                )}
                            </div>
                            <div className="grid w-full grid-cols-2 gap-3">
                                {previews.map((src, i) => (
                                    <div key={src} className="relative aspect-[3/4] overflow-hidden rounded-xl border-2 border-gray-100 bg-gray-50 shadow-sm">
                                        <img src={src} alt={`Preview ${i + 1}`} className="h-full w-full object-cover" />
                                        <div className="absolute left-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-[#2f3e46]/80 text-xs font-bold text-white">
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
                            className={`w-full rounded-xl py-4 text-lg font-medium text-white shadow-md transition-none active:scale-95 ${
                                files.length === limit ? 'bg-[#6A7865]' : 'cursor-not-allowed bg-gray-300'
                            }`}
                        >
                            {files.length === limit ? 'Tải lên bây giờ' : `Vui lòng chọn đúng ${limit} ảnh`}
                        </button>
                    )}

                    {isUploading && (
                        <div className="flex flex-col items-center justify-center py-8">
                            <Loader className="mb-4 animate-spin text-[#85937F]" size={40} />
                            <p className="animate-pulse text-gray-600">Đang tải ảnh lên...</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default MobileUploadClient;
