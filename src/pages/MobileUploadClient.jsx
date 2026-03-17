import React, { useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Upload, CheckCircle, AlertCircle, Loader, Facebook, Instagram } from 'lucide-react';
import { motion } from 'framer-motion';

const MobileUploadClient = () => {
    const { sessionId } = useParams();
    const [searchParams] = useSearchParams();
    const limit = parseInt(searchParams.get('limit')) || 4;

    const [files, setFiles] = useState([]);
    const [previews, setPreviews] = React.useState([]);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadStatus, setUploadStatus] = useState(null); // 'success' | 'error' | null
    const [errorMsg, setErrorMsg] = useState("");

    React.useEffect(() => {
        // Check if this session was already uploaded successfully
        if (localStorage.getItem(`uploaded_session_${sessionId}`) === 'true') {
            setUploadStatus('success');
        }

        const objectUrls = files.map(file => URL.createObjectURL(file));
        setPreviews(objectUrls);

        // Cleanup URLs to avoid memory leaks
        return () => objectUrls.forEach(url => URL.revokeObjectURL(url));
    }, [files, sessionId]);

    const handleFileChange = (e) => {
        if (e.target.files && e.target.files.length > 0) {
            let selectedFiles = Array.from(e.target.files);
            if (selectedFiles.length > limit) {
                setErrorMsg(`Bạn chỉ được chọn tối đa ${limit} ảnh. Các ảnh thừa đã bị loại bỏ.`);
                selectedFiles = selectedFiles.slice(0, limit);
            } else if (selectedFiles.length < limit) {
                setErrorMsg(`Vui lòng chọn thêm ảnh (cần đúng ${limit} ảnh).`);
            } else {
                setErrorMsg("");
            }
            setFiles(selectedFiles);
        }
    };

    const handleUpload = async () => {
        if (files.length !== limit) return;
        setIsUploading(true);
        setUploadStatus(null);

        try {
            // Upload từng file một
            for (const file of files) {
                const formData = new FormData();
                formData.append('file', file);
                formData.append('session_id', sessionId);

                const backendUploadUrl = `http://${window.location.hostname}:5000/api/upload/mobile`;
                const response = await fetch(backendUploadUrl, {
                    method: 'POST',
                    body: formData,
                });

                if (!response.ok) {
                    throw new Error('Upload thất bại');
                }
            }

            setUploadStatus('success');
            setFiles([]); // Xoá danh sách sau khi upload thành công
            localStorage.setItem(`uploaded_session_${sessionId}`, 'true'); // Save success state to prevent re-upload on reload
        } catch (error) {
            console.error("Lỗi upload:", error);
            setUploadStatus('error');
        } finally {
            setIsUploading(false);
        }
    };

    return (
        <div className="min-h-screen bg-[#F9FAF7] p-6 flex flex-col items-center justify-center font-sans">
            <div className="max-w-md w-full bg-white rounded-3xl shadow-xl overflow-hidden border border-gray-100">

                {/* Header */}
                <div className="bg-[#B5C1B0] p-6 text-center text-white">
                    <h1 className="text-2xl font-serif font-semibold">Gửi ảnh lên Photobooth</h1>
                    <p className="opacity-80 text-sm mt-1">Phiên làm việc: {sessionId ? sessionId.substring(0, 8) : 'N/A'}</p>
                </div>

                <div className="p-8 flex flex-col items-center space-y-6">

                    {/* Status Messages */}
                    {uploadStatus === 'success' && (
                        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center text-green-600 mb-4">
                            <CheckCircle size={56} className="mb-4 text-[#52796f]" />
                            <p className="text-2xl font-serif font-bold text-center text-[#2f3e46]">Tải ảnh lên thành công!</p>
                            <div className="mt-4 p-4 bg-green-50 rounded-xl border border-green-100 text-center space-y-2">
                                <p className="text-sm text-green-800">Ảnh của bạn đã được chuyển tới máy Photobooth.</p>
                                <p className="text-sm font-bold text-green-900">Vui lòng quay lại màn hình chính của máy để tiếp tục cài đặt khung ảnh.</p>
                            </div>

                            {/* Social Media Links */}
                            <div className="mt-8 flex flex-col items-center space-y-4">
                                <p className="text-sm text-gray-500 font-medium tracking-wide uppercase">Theo dõi Tomato Photobooth tại</p>
                                <div className="flex gap-6">
                                    <a href="https://www.facebook.com/profile.php?id=61583398170126" target="_blank" rel="noopener noreferrer" className="p-3 bg-[#1877F2]/10 text-[#1877F2] rounded-full hover:bg-[#1877F2]/20 hover:scale-110 transition-all duration-300">
                                        <Facebook size={24} />
                                    </a>
                                    <a href="https://www.tiktok.com/@tomato.photobooth" target="_blank" rel="noopener noreferrer" className="p-3 bg-black/5 text-black rounded-full hover:bg-black/10 hover:scale-110 transition-all duration-300">
                                        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                                            <path d="M12.525.02c1.31-.02 2.61-.01 3.91 0 .08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.24-2.34.69-4.7 2.37-6.28 1.34-1.29 3.19-2 5.09-1.92v4.06c-1.12-.04-2.22.35-3 .92-.79.57-1.25 1.51-1.2 2.49.03 1.05.57 2.01 1.44 2.53.84.5 1.9.59 2.82.26 1.05-.33 1.83-1.23 2.05-2.29.13-.57.14-1.16.12-1.74-.06-3.82-.03-7.65-.03-11.47 0-1.26.01-2.52.01-3.78z" />
                                        </svg>
                                    </a>
                                    <a href="https://www.instagram.com/tomato.photobooth" target="_blank" rel="noopener noreferrer" className="p-3 bg-[#E1306C]/10 text-[#E1306C] rounded-full hover:bg-[#E1306C]/20 hover:scale-110 transition-all duration-300">
                                        <Instagram size={24} />
                                    </a>
                                </div>
                            </div>
                        </motion.div>
                    )}

                    {uploadStatus === 'error' && (
                        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center text-red-500 mb-4">
                            <AlertCircle size={48} className="mb-2" />
                            <p className="text-lg font-medium text-center">Có lỗi xảy ra!</p>
                            <p className="text-sm text-center opacity-80 mt-1">Vui lòng thử lại sau.</p>
                        </motion.div>
                    )}

                    {/* File Input */}
                    {!isUploading && uploadStatus !== 'success' && (
                        <div className="w-full">
                            <label className="flex flex-col items-center justify-center w-full h-40 border-2 border-dashed border-[#85937F] rounded-2xl cursor-pointer bg-gray-50 hover:bg-[#F9FAF7] transition-colors relative group overflow-hidden">
                                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                                    <Upload size={40} className="text-[#85937F] mb-3 group-hover:scale-110 transition-transform" />
                                    <p className="mb-2 text-sm text-gray-500">
                                        <span className="font-semibold text-gray-700">
                                            {files.length > 0 ? `Chạm vào đây để chọn lại` : `Chạm để chọn ${limit} ảnh`}
                                        </span>
                                    </p>
                                    <p className="text-xs text-gray-400">PNG, JPG</p>
                                </div>
                                <input type="file" className="hidden" multiple accept="image/*" onChange={handleFileChange} />
                            </label>
                            {errorMsg && <p className="text-red-500 text-sm mt-3 text-center bg-red-50 p-2 rounded-xl border border-red-100 font-medium">{errorMsg}</p>}
                        </div>
                    )}

                    {/* File Preview List */}
                    {files.length > 0 && (
                        <div className="w-full">
                            <div className="flex justify-between items-center mb-3">
                                <p className="text-sm font-bold text-gray-700">Đã chọn ({files.length}/{limit} ảnh):</p>
                                {!isUploading && uploadStatus !== 'success' && (
                                    <button
                                        onClick={() => { setFiles([]); setErrorMsg(""); }}
                                        className="text-xs font-bold text-[#e63946] hover:bg-red-50 px-3 py-1.5 rounded-lg border border-red-100 transition-colors"
                                    >
                                        Hủy chọn tất cả
                                    </button>
                                )}
                            </div>
                            <div className="grid grid-cols-2 gap-3 w-full">
                                {previews.map((src, i) => (
                                    <div key={i} className="relative aspect-[3/4] rounded-xl overflow-hidden border-2 border-gray-100 shadow-sm bg-gray-50">
                                        <img src={src} alt={`Preview ${i + 1}`} className="w-full h-full object-cover" />
                                        <div className="absolute top-2 left-2 bg-[#2f3e46]/80 text-white text-xs font-bold w-6 h-6 flex items-center justify-center rounded-full backdrop-blur-sm">
                                            {i + 1}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Upload Button */}
                    {!isUploading && uploadStatus !== 'success' && (
                        <button
                            onClick={handleUpload}
                            disabled={files.length !== limit}
                            className={`w-full py-4 rounded-xl font-medium text-lg text-white transition-all transform active:scale-95 shadow-md ${files.length === limit ? 'bg-[#6A7865] hover:bg-[#5A6855]' : 'bg-gray-300 cursor-not-allowed'
                                }`}
                        >
                            {files.length === limit ? 'Tải Lên Bây Giờ' : `Vui lòng chọn đúng ${limit} ảnh`}
                        </button>
                    )}

                    {/* Loading State */}
                    {isUploading && (
                        <div className="flex flex-col items-center justify-center py-8">
                            <Loader className="animate-spin text-[#85937F] mb-4" size={40} />
                            <p className="text-gray-600 animate-pulse">Đang tải ảnh lên...</p>
                        </div>
                    )}

                    {/* Upload button only shows when not loaded or not success */}

                </div>
            </div>
        </div>
    );
};

export default MobileUploadClient;
