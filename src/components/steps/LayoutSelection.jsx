import { useState } from 'react';
import { motion } from 'framer-motion';
import { useWorkflow } from '../../context/WorkflowContext';
import { LAYOUTS } from '../../data/layouts';
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react';

const layoutIconUrls = Object.fromEntries(
    Object.entries(import.meta.glob('../../assets/icons/*', { eager: true, query: '?url', import: 'default' }))
        .map(([path, url]) => [path.split('/').pop(), url])
);

const LayoutSelection = () => {
    const { nextStep, prevStep, sessionData, updateSessionData, configs } = useWorkflow();
    const isUploadFlow = sessionData.source === 'upload';
    const layoutPrice = isUploadFlow
        ? parseInt(configs?.mobile_price || 30000)
        : parseInt(configs?.price || 60000);
    const primaryTextColor = configs?.brand_text_primary || '#7B5E43';
    const secondaryTextColor = configs?.brand_text_secondary || '#5E6B78';

    const handleSelect = (layout) => {
        updateSessionData('layout', layout);
        updateSessionData('printPrice', layoutPrice);
        nextStep();
    };

    const availableLayouts = LAYOUTS.filter(layout =>
        isUploadFlow ? layout.isMobileOnly : !layout.isMobileOnly
    );

    const [currentPage, setCurrentPage] = useState(0);
    const itemsPerPage = 4;
    const totalPages = Math.ceil(availableLayouts.length / itemsPerPage);
    const currentLayouts = availableLayouts.slice(currentPage * itemsPerPage, (currentPage + 1) * itemsPerPage);

    const renderMobilePreview = (layout) => {
        const frameClass = "bg-[#EAD3B2] shadow-sm border border-[#D5B895] rounded-sm";
        const slotClass = "bg-[#efece1] shadow-inner";

        if (layout.id === 'mobile_double_horizontal') {
            return (
                <div className={`w-[80%] aspect-[2/3] p-[3%] flex flex-col gap-[3%] pb-[12%] ${frameClass}`}>
                    <div className={`flex-1 ${slotClass}`} />
                    <div className={`flex-1 ${slotClass}`} />
                </div>
            );
        }

        if (layout.id === 'mobile_double_vertical') {
            return (
                <div className={`w-[95%] aspect-[3/2] p-[2.5%] flex gap-[2.5%] pb-[8%] ${frameClass}`}>
                    <div className={`flex-1 ${slotClass}`} />
                    <div className={`flex-1 ${slotClass}`} />
                </div>
            );
        }

        return (
            <div className={`w-[95%] aspect-[3/2] p-[2.5%] flex pb-[8%] ${frameClass}`}>
                <div className={`flex-1 ${slotClass}`} />
            </div>
        );
    };

    return (
        <div
            className="flex flex-col items-center justify-center w-full h-full relative p-8 bg-cover bg-center"
            style={{
                backgroundColor: '#FFF8E7',
                backgroundImage: configs?.['bg_choose-slot'] ? `url('${configs['bg_choose-slot']}')` : 'none'
            }}
        >
            <button
                onClick={prevStep}
                className="absolute top-6 left-6 flex items-center gap-2 px-6 py-3 bg-white rounded-full transition-none font-serif font-bold shadow-sm border border-[#D5B895]/20 z-10 active:scale-95"
                style={{ color: primaryTextColor }}
            >
                <ArrowLeft size={24} />
                <span>Quay lại</span>
            </button>

            <motion.h2
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-5xl font-serif text-center mb-16 tracking-wider uppercase"
                style={{ color: primaryTextColor }}
            >
                Chọn bố cục
            </motion.h2>

            <div className="relative w-full max-w-7xl px-4 md:px-16 flex items-center justify-center">
                {currentPage > 0 && (
                    <button
                        onClick={() => setCurrentPage(curr => curr - 1)}
                        className="absolute -left-2 md:-left-4 lg:-left-12 z-10 p-3 bg-white rounded-full shadow-md border border-[#7B5E43]/10 transition-none active:scale-95"
                        style={{ color: primaryTextColor }}
                    >
                        <ChevronLeft size={32} />
                    </button>
                )}

                <div className={`grid gap-8 w-full ${isUploadFlow ? 'grid-cols-2 lg:grid-cols-3 max-w-4xl' : 'grid-cols-2 md:grid-cols-4 w-full'}`}>
                    {currentLayouts.map((layout, index) => (
                        <motion.div
                            key={layout.id}
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: index * 0.1 }}
                            onClick={() => handleSelect(layout)}
                            className="cursor-pointer flex flex-col items-center bg-white p-6 rounded-2xl shadow-sm border border-gray-100"
                        >
                            <div className="w-full aspect-[4/5] flex items-center justify-center mb-4">
                                {isUploadFlow ? (
                                    <div className="flex flex-col items-center justify-center h-full w-full opacity-90" style={{ mixBlendMode: 'multiply' }}>
                                        {renderMobilePreview(layout)}
                                    </div>
                                ) : (
                                    <img
                                        src={layoutIconUrls[layout.icon]}
                                        alt={layout.name}
                                        className="w-full h-full object-contain mix-blend-multiply opacity-90"
                                    />
                                )}
                            </div>

                            <div className="text-center font-serif flex flex-col gap-2">
                                <h3 className="text-xl lg:text-2xl font-bold" style={{ color: primaryTextColor }}>{layout.name}</h3>
                                <p className="text-sm font-sans font-medium uppercase tracking-wider whitespace-nowrap" style={{ color: secondaryTextColor }}>
                                    {layoutPrice.toLocaleString('vi-VN')} VNĐ
                                </p>
                            </div>
                        </motion.div>
                    ))}
                </div>

                {currentPage < totalPages - 1 && (
                    <button
                        onClick={() => setCurrentPage(curr => curr + 1)}
                        className="absolute -right-2 md:-right-4 lg:-right-12 z-10 p-3 bg-white rounded-full shadow-md border border-[#7B5E43]/10 transition-none active:scale-95"
                        style={{ color: primaryTextColor }}
                    >
                        <ChevronRight size={32} />
                    </button>
                )}
            </div>

            {totalPages > 1 && (
                <div className="flex justify-center gap-2 mt-12">
                    {Array.from({ length: totalPages }).map((_, idx) => (
                        <button
                            key={idx}
                            onClick={() => setCurrentPage(idx)}
                            className="h-3 rounded-full transition-none"
                            style={{
                                width: currentPage === idx ? '2rem' : '0.75rem',
                                backgroundColor: currentPage === idx ? primaryTextColor : `${primaryTextColor}4d`
                            }}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

export default LayoutSelection;
