import React from 'react';
import { motion } from 'framer-motion';
import { Camera, Smartphone } from 'lucide-react';
import { useWorkflow } from '../../context/WorkflowContext';

const isVideoUrl = (url = '') => /\.(mp4|webm|mov)(\?|$)/i.test(url);

const SourceSelection = () => {
    const { nextStep, updateSessionData, configs } = useWorkflow();
    const backgroundUrl = configs?.['bg_source-selection'];
    const primaryTextColor = configs?.brand_text_primary || '#7B5E43';
    const secondaryTextColor = configs?.brand_text_secondary || '#5E6B78';

    const handleSelectSource = (source) => {
        updateSessionData('source', source);
        nextStep();
    };

    return (
        <div className="relative flex h-full min-h-screen w-full flex-col items-center justify-center space-y-8 overflow-hidden bg-[#FFF8E7] p-8">
            {backgroundUrl && (
                isVideoUrl(backgroundUrl) ? (
                    <video
                        src={backgroundUrl}
                        className="absolute inset-x-0 -top-8 -bottom-14 z-0 h-[calc(100%+5.5rem)] w-full object-cover"
                        style={{ objectPosition: 'center calc(100% + 24px)' }}
                        autoPlay
                        muted
                        loop
                        playsInline
                        preload="auto"
                    />
                ) : (
                    <div
                        className="absolute inset-x-0 -top-8 -bottom-14 z-0 bg-cover"
                        style={{
                            backgroundImage: `url('${backgroundUrl}')`,
                            backgroundPosition: 'center calc(100% + 24px)'
                        }}
                    />
                )
            )}

            <motion.h2
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                className="relative z-10 mb-8 text-center font-serif text-4xl drop-shadow-sm md:text-5xl"
                style={{ color: primaryTextColor }}
            >
                Bạn muốn sử dụng ảnh từ đâu?
            </motion.h2>

            <div className="relative z-10 flex w-full max-w-4xl flex-col justify-center gap-8 md:flex-row">
                <motion.div
                    initial={{ opacity: 0, x: -50 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.1 }}
                    className="flex flex-1"
                >
                    <button
                        type="button"
                        onClick={() => handleSelectSource('camera')}
                        className="flex w-full cursor-pointer flex-col overflow-hidden rounded-2xl border-2 border-transparent bg-white text-left shadow-xl transition-none active:scale-95"
                    >
                        <div className="flex h-64 items-center justify-center bg-[#F7E8CF] transition-none">
                            <Camera size={80} className="text-white drop-shadow-md transition-none" />
                        </div>
                        <div className="flex-1 bg-white p-8 text-center">
                            <h3 className="mb-2 text-2xl font-semibold" style={{ color: primaryTextColor }}>
                                Chụp tại quầy
                            </h3>
                            <p className="text-lg" style={{ color: secondaryTextColor }}>
                                Sử dụng máy ảnh chuyên nghiệp của chúng tôi
                            </p>
                        </div>
                    </button>
                </motion.div>

                <motion.div
                    initial={{ opacity: 0, x: 50 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.2 }}
                    className="flex flex-1"
                >
                    <button
                        type="button"
                        onClick={() => handleSelectSource('upload')}
                        className="flex w-full cursor-pointer flex-col overflow-hidden rounded-2xl border-2 border-transparent bg-white text-left shadow-xl transition-none active:scale-95"
                    >
                        <div className="flex h-64 items-center justify-center bg-[#F1DDBE] transition-none">
                            <Smartphone size={80} className="text-white drop-shadow-md transition-none" />
                        </div>
                        <div className="flex-1 bg-white p-8 text-center">
                            <h3 className="mb-2 text-2xl font-semibold" style={{ color: primaryTextColor }}>
                                Tải từ điện thoại
                            </h3>
                            <p className="text-lg" style={{ color: secondaryTextColor }}>
                                Quét mã QR để chọn ảnh đẹp sẵn có của bạn
                            </p>
                        </div>
                    </button>
                </motion.div>
            </div>
        </div>
    );
};

export default SourceSelection;
