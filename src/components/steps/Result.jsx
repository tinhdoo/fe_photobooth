import { useEffect, useRef, useState } from 'react';
import QRCodeStyling from 'qr-code-styling';
import { QrCode } from 'lucide-react';
import { useWorkflow } from '../../context/WorkflowContext';

import { CLOUD_API_URL } from '../../config/api';

const Result = () => {
    const { resetSession, sessionData, configs } = useWorkflow();
    const finalImage = sessionData.finalImage;
    const sessionId = sessionData.sessionId;
    const logoUrl = configs?.logo_main || '/logo_tomato.png';
    const primaryTextColor = configs?.brand_text_primary || '#7B5E43';
    const secondaryTextColor = configs?.brand_text_secondary || '#5E6B78';
    const [viewUrl, setViewUrl] = useState('');
    const qrRef = useRef(null);

    useEffect(() => {
        if (viewUrl && qrRef.current) {
            qrRef.current.innerHTML = '';
            const qrCode = new QRCodeStyling({
                width: 200,
                height: 200,
                data: viewUrl,
                margin: 10,
                qrOptions: { errorCorrectionLevel: 'L' },
                dotsOptions: { color: secondaryTextColor, type: 'square' },
                cornersSquareOptions: { type: 'extra-rounded', color: primaryTextColor },
                cornersDotOptions: { type: 'dot', color: '#C8A47A' }
            });
            qrCode.append(qrRef.current);
        }
    }, [viewUrl, primaryTextColor, secondaryTextColor]);

    useEffect(() => {
        const fetchViewUrl = async () => {
            if (!sessionId) {
                setViewUrl(finalImage);
                return;
            }
            const albumBaseUrl = CLOUD_API_URL || window.location.origin;
            setViewUrl(`${albumBaseUrl}/album/${sessionId}`);
        };
        fetchViewUrl();
    }, [sessionId, finalImage]);

    return (
        <div
            className="flex h-full w-full flex-col items-center justify-center bg-[#FFF8E7] bg-cover bg-center p-8 font-serif"
            style={{ backgroundImage: configs?.['bg_qr-photo'] ? `url('${configs['bg_qr-photo']}')` : 'none' }}
        >
            <div className="flex w-full max-w-2xl flex-col items-center rounded-3xl bg-white/90 p-12 text-center shadow-md">
                <div className="mb-5 flex justify-center">
                    <img
                        src={logoUrl}
                        alt="Tomato Photobooth"
                        className="h-20 w-20 rounded-full object-contain"
                        onError={(e) => {
                            // logo_main có thể là URL không truy cập được trên máy khác -> fallback logo mặc định
                            if (!e.currentTarget.src.endsWith('/logo_tomato.png')) {
                                e.currentTarget.src = '/logo_tomato.png';
                            }
                        }}
                    />
                </div>

                <h2 className="mb-3 text-center text-5xl font-bold uppercase tracking-wide" style={{ color: primaryTextColor }}>
                    Ảnh đã sẵn sàng
                </h2>
                <p className="mb-8 max-w-xl text-balance text-center text-xl font-semibold leading-relaxed" style={{ color: primaryTextColor }}>
                    Quét QR để mang những khoảnh khắc đáng yêu này về nhé ❤️
                </p>

                <div className="mb-4 rounded-2xl border border-[#F6E6C9] bg-white p-4 shadow-inner">
                    {viewUrl ? (
                        <div ref={qrRef} />
                    ) : (
                        <div className="flex h-[200px] w-[200px] items-center justify-center rounded bg-[#F6E6C9]/35" style={{ color: `${primaryTextColor}80` }}>
                            <QrCode size={64} />
                        </div>
                    )}
                </div>

                {!viewUrl && (
                    <p className="mb-8 text-sm italic text-red-400">Ảnh chưa sẵn sàng</p>
                )}

                <button
                    type="button"
                    onClick={resetSession}
                    className="w-full rounded-xl bg-[#D5B895] py-4 text-xl font-bold text-white shadow-lg transition-none active:scale-95"
                >
                    Về trang chủ
                </button>
            </div>
        </div>
    );
};

export default Result;
