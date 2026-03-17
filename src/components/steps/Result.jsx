import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { useWorkflow } from '../../context/WorkflowContext';
import QRCodeStyling from 'qr-code-styling';
import { QrCode, Download } from 'lucide-react';
import logoTomato from '../../assets/images/logo_tomato.png';

const Result = () => {
    const { resetSession, sessionData } = useWorkflow();
    const finalImage = sessionData.finalImage;
    const sessionId = sessionData.sessionId;

    const [viewUrl, setViewUrl] = useState('');
    const qrRef = useRef(null);

    useEffect(() => {
        if (viewUrl && qrRef.current) {
            qrRef.current.innerHTML = '';
            const qrCode = new QRCodeStyling({
                width: 200,
                height: 200,
                data: viewUrl,
                image: logoTomato,
                margin: 10,
                qrOptions: { errorCorrectionLevel: 'L' },
                dotsOptions: {
                    color: "#000000",
                    type: "rounded"
                },
                imageOptions: {
                    crossOrigin: "anonymous",
                    margin: 4,
                    imageSize: 0.2
                }
            });
            qrCode.append(qrRef.current);
        }
    }, [viewUrl]);

    useEffect(() => {
        const fetchViewUrl = async () => {
            if (!sessionId) {
                setViewUrl(finalImage);
                return;
            }
            try {
                const res = await fetch('/api/network/ip');
                if (res.ok) {
                    const data = await res.json();
                    const port = window.location.port ? `:${window.location.port}` : '';
                    setViewUrl(`http://${data.ip}${port}/album/${sessionId}`);
                } else {
                    setViewUrl(`${window.location.origin}/album/${sessionId}`);
                }
            } catch (error) {
                console.error("Failed to get LAN IP", error);
                setViewUrl(`${window.location.origin}/album/${sessionId}`);
            }
        };
        fetchViewUrl();
    }, [sessionId, finalImage]);

    return (
        <div className="flex flex-col items-center justify-center h-full w-full bg-[#F9FAF7] p-8">

            <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="bg-white p-12 rounded-2xl shadow-xl flex flex-col items-center max-w-lg w-full text-center border border-[#A8B5A0]/20"
            >
                <motion.h2
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-5xl font-serif text-[#52796f] text-center mb-12 tracking-wider uppercase"
                >
                    Hoàn tất!
                </motion.h2>

                <div className="bg-white p-4 rounded-xl mb-4 border border-gray-100 shadow-inner">
                    {viewUrl ? (
                        <div ref={qrRef} />
                    ) : (
                        <div className="w-[200px] h-[200px] flex items-center justify-center bg-gray-100 rounded text-gray-400">
                            <QrCode size={64} />
                        </div>
                    )}
                </div>

                {viewUrl && (
                    <a
                        href={viewUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#52796f] mb-8 font-serif italic hover:underline flex items-center gap-2"
                    >
                        <Download size={16} /> Nhấn để mở ảnh
                    </a>
                )}

                {!viewUrl && (
                    <p className="text-red-400 mb-8 font-serif italic text-sm">Ảnh không có sẵn</p>
                )}

                <button
                    onClick={resetSession}
                    className="w-full bg-[#A8B5A0] text-white py-4 rounded-xl text-xl hover:bg-[#97a290] transition-colors shadow-md"
                >
                    Kết thúc
                </button>
            </motion.div>

        </div>
    );
};
export default Result;
