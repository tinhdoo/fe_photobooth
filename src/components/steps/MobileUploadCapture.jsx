import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useWorkflow } from '../../context/WorkflowContext';
import QRCodeStyling from 'qr-code-styling';
import io from 'socket.io-client';
import { getDeviceId } from '../../utils/deviceId';
import { Smartphone, CheckCircle, Image as ImageIcon } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || '';
const isLocalHost = (hostname) => (
    hostname === 'localhost'
    || hostname === '127.0.0.1'
    || /^192\.168\./.test(hostname)
    || /^10\./.test(hostname)
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
);

const MobileUploadCapture = () => {
    const { nextStep, sessionData, updateSessionData, configs } = useWorkflow();
    const primaryTextColor = configs?.brand_text_primary || '#7B5E43';
    const secondaryTextColor = configs?.brand_text_secondary || '#5E6B78';
    const [qrUrl, setQrUrl] = useState('');
    const [sessionId] = useState(`session-${Math.random().toString(36).substring(2, 10)}`);
    const [photosTaken, setPhotosTaken] = useState(sessionData.photos || []);

    const layout = sessionData.layout;
    const TOTAL_PHOTOS = layout ? layout.photoCount : 4; // Default to 4
    const qrRef = useRef(null);

    useEffect(() => {
        if (qrUrl && qrRef.current) {
            qrRef.current.innerHTML = '';
            const qrCode = new QRCodeStyling({
                width: 240,
                height: 240,
                data: qrUrl,
                margin: 15,
                qrOptions: { errorCorrectionLevel: 'L' },
                dotsOptions: {
                    color: "#2D3748",
                    type: "rounded"
                },
                backgroundOptions: {
                    color: "#ffffff"
                },
                cornersSquareOptions: { type: "extra-rounded", color: "#7B5E43" }
            });
            qrCode.append(qrRef.current);
        }
    }, [qrUrl]);

    useEffect(() => {
        // 1. Generate QR Code pointing to Mobile Client
        const initQr = async () => {
            const publicUploadUrl = `${window.location.origin}/m/upload/${sessionId}?limit=${TOTAL_PHOTOS}`;
            if (!isLocalHost(window.location.hostname)) {
                setQrUrl(publicUploadUrl);
                return;
            }

            try {
                const res = await fetch(`${API_URL}/api/network/ip`);
                if (res.ok) {
                    const data = await res.json();
                    const port = window.location.port ? `:${window.location.port}` : '';
                    const uploadUrl = `http://${data.ip}${port}/m/upload/${sessionId}?limit=${TOTAL_PHOTOS}`;
                    setQrUrl(uploadUrl);
                    console.log("QR URL Generated:", uploadUrl);
                }
            } catch (error) {
                console.error("Failed to get LAN IP", error);
                // Fallback to localhost (only works if testing on same machine)
                setQrUrl(publicUploadUrl);
            }
        };
        initQr();

        // Socket.IO remains as a fast local path; polling below is the cloud-safe source of truth.
        if (!isLocalHost(window.location.hostname)) {
            return undefined;
        }

        const backendSocketUrl = `http://${window.location.hostname}:5000`;
        const socket = io(backendSocketUrl, {
            transports: ['websocket', 'polling'], // Add polling fallback
            auth: { deviceId: getDeviceId() }
        });

        socket.on('connect', () => {
            console.log('MobileUploadCapture: Connected to Socket.IO');
        });

        socket.on('mobile_photo_uploaded', (data) => {
            console.log('Received socket event mobile_photo_uploaded:', data);
            if (data.session_id === sessionId && data.url) {
                setPhotosTaken(prev => [...prev, data.url]);
            }
        });

        return () => {
            socket.disconnect();
        };
    }, []);

    useEffect(() => {
        let stopped = false;
        const pollUploads = async () => {
            try {
                const res = await fetch(`${API_URL}/api/mobile-uploads/${sessionId}`);
                if (!res.ok) return;
                const uploads = await res.json();
                if (stopped || !Array.isArray(uploads)) return;
                setPhotosTaken(uploads.slice(0, TOTAL_PHOTOS).map((item) => item.url));
            } catch (error) {
                console.error('Failed to poll mobile uploads:', error);
            }
        };

        pollUploads();
        const interval = setInterval(pollUploads, 1000);
        return () => {
            stopped = true;
            clearInterval(interval);
        };
    }, [sessionId, TOTAL_PHOTOS]);

    // Sync photosTaken to session context
    useEffect(() => {
        if (photosTaken.length === 0) return;
        updateSessionData('photos', photosTaken);
        updateSessionData('capturedPhotos', photosTaken);
        if (photosTaken.length >= TOTAL_PHOTOS) {
            const timer = setTimeout(() => nextStep(), 1500);
            return () => clearTimeout(timer);
        }
    }, [photosTaken]);

    // Helper: auto fill empty slots with placeholder
    const renderSlots = () => {
        const slots = [];
        for (let i = 0; i < TOTAL_PHOTOS; i++) {
            const photoUrl = photosTaken[i];
            const isCurrent = i === photosTaken.length; // Slot is waiting

            slots.push(
                <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.1 }}
                    className={`
                        w-24 h-24 md:w-32 md:h-32 rounded-2xl flex flex-col items-center justify-center text-xl font-serif transition-all duration-500 overflow-hidden relative
                        ${photoUrl
                            ? 'bg-[#D5B895] border-4 border-white shadow-xl'
                            : 'bg-gray-50/80 border-2 border-dashed border-[#EAD3B2] text-[#A9825F]'}
                        ${isCurrent ? 'scale-110 !border-solid border-[#8E6B4D] shadow-2xl ring-4 ring-[#8E6B4D]/20 animate-pulse bg-white' : ''}
                    `}
                >
                    {photoUrl ? (
                        <div className="relative w-full h-full group">
                            <motion.img
                                initial={{ opacity: 0, scale: 0.9 }}
                                animate={{ opacity: 1, scale: 1 }}
                                src={typeof photoUrl === 'object' ? photoUrl.url : photoUrl}
                                className="w-full h-full object-cover"
                            />
                            <div className="absolute inset-0 bg-black/20 flex items-center justify-center opacity-100 transition-none">
                                <CheckCircle className="text-white drop-shadow-md" size={32} />
                            </div>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center opacity-60">
                            {isCurrent ? (
                                <ImageIcon size={28} className="text-[#8E6B4D] mb-2" />
                            ) : (
                                <span className="text-sm mb-1 uppercase tracking-widest font-sans">Ảnh</span>
                            )}
                            <span className={`font-bold text-3xl ${isCurrent ? 'text-[#8E6B4D]' : ''}`}>{i + 1}</span>
                        </div>
                    )}
                </motion.div>
            );
        }
        return slots;
    };

    return (
        <div className="relative w-full h-full flex flex-col items-center justify-center bg-[#FFF8E7] p-4 md:p-8">
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="w-full max-w-6xl bg-white rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col md:flex-row border border-[#FFF1D6]"
            >

                {/* Left Side: Instructions & QR Code */}
                <div className="flex-1 bg-gradient-to-br from-[#f4f6f3] to-[#e8ece6] p-12 flex flex-col items-center justify-center border-b md:border-b-0 md:border-r border-[#D9DFD5] relative overflow-hidden">
                    {/* Decorative Background Elements */}
                    <div className="absolute top-0 left-0 w-64 h-64 bg-[#DFC39F]/10 rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2"></div>
                    <div className="absolute bottom-0 right-0 w-80 h-80 bg-[#A9825F]/10 rounded-full blur-3xl translate-x-1/3 translate-y-1/3"></div>

                    <div className="bg-white p-5 rounded-full shadow-md mb-8 z-10 relative" style={{ color: primaryTextColor }}>
                        <Smartphone size={40} strokeWidth={1.5} />
                    </div>

                    <h2 className="text-4xl font-serif mb-5 text-center tracking-wide z-10 relative" style={{ color: primaryTextColor }}>Quét mã để tải ảnh</h2>
                    <p className="text-center mb-10 max-w-sm leading-relaxed text-lg z-10 relative font-medium" style={{ color: secondaryTextColor }}>
                        Dùng điện thoại quét mã QR để tải lên 2 ảnh yêu thích của bạn.
                    </p>

                    <div className="bg-white p-6 rounded-3xl shadow-xl border border-white relative group z-10 transition-none">
                        {qrUrl ? (
                            <div ref={qrRef} className="rounded-xl overflow-hidden" />
                        ) : (
                            <div className="w-[240px] h-[240px] flex items-center justify-center bg-[#FFF8E7] text-gray-400 rounded-xl border border-dashed border-gray-200">
                                Đang chuẩn bị mã QR...
                            </div>
                        )}
                    </div>
                </div>

                {/* Right Side: Photo Slots Status */}
                <div className="flex-[1.3] p-12 flex flex-col justify-between bg-white/80 backdrop-blur-sm relative">
                    <div>
                        <div className="flex items-center justify-between mb-3 border-b border-gray-100 pb-4">
                            <div className="flex items-center gap-3">
                                <ImageIcon size={28} style={{ color: primaryTextColor }} />
                                <h3 className="text-3xl font-semibold font-serif tracking-wide" style={{ color: primaryTextColor }}>Trạng thái nhận ảnh</h3>
                            </div>
                            <span className="text-lg font-bold text-white px-5 py-1.5 rounded-full shadow-sm" style={{ backgroundColor: primaryTextColor }}>
                                {photosTaken.length} / {TOTAL_PHOTOS}
                            </span>
                        </div>
                        <p className="text-base mb-10 font-medium" style={{ color: secondaryTextColor }}>Ảnh sẽ tự động xuất hiện ở đây sau khi bạn tải lên thành công từ điện thoại.</p>
                    </div>

                    <div className="flex-1 flex items-center justify-center">
                        <div className="grid grid-cols-2 gap-8 w-full max-w-md place-items-center">
                            {renderSlots()}
                        </div>
                    </div>

                    {photosTaken.length === TOTAL_PHOTOS && (
                        <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="mt-10 bg-[#FFF8E7] border border-[#EAD3B2] p-5 rounded-2xl flex justify-center items-center font-semibold text-lg shadow-sm"
                            style={{ color: primaryTextColor }}
                        >
                            <CheckCircle className="mr-3" size={24} /> Đã nhận đủ ảnh. Đang chuyển sang bước tiếp theo...
                        </motion.div>
                    )}
                </div>

            </motion.div>

            {/* Skip Option (just in case they want to exit to camera flow if setup fails? Optional)
            <button onClick={() => updateSessionData('source', 'camera')} className="mt-8 text-gray-500 underline text-sm transition-none active:scale-95">
                Trở lại chụp bằng máy ảnh tại quầy
            </button> */}
        </div>
    );
};

export default MobileUploadCapture;
