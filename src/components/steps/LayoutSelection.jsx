import { useState } from 'react';
import { motion } from 'framer-motion';
import { useWorkflow } from '../../context/WorkflowContext';
import { LAYOUTS } from '../../data/layouts';
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react'; // Import icons

const LayoutSelection = () => {
  const { nextStep, prevStep, sessionData, updateSessionData, configs } = useWorkflow();

  // Lọc Layout theo Nguồn ảnh
  const isUploadFlow = sessionData.source === 'upload';

  // Get price from backend config depending on flow
  const layoutPrice = isUploadFlow
    ? (configs?.mobile_price ? parseInt(configs.mobile_price) : 30000)
    : (configs?.price ? parseInt(configs.price) : 60000);

  const handleSelect = (layout) => {
    updateSessionData('layout', layout);
    updateSessionData('printPrice', layoutPrice); // Add printPrice initialization here
    nextStep();
  };

  const availableLayouts = LAYOUTS.filter(layout =>
    isUploadFlow ? layout.isMobileOnly : !layout.isMobileOnly
  );

  // --- Pagination Logic ---
  const [currentPage, setCurrentPage] = useState(0);
  const itemsPerPage = 4;
  const totalPages = Math.ceil(availableLayouts.length / itemsPerPage);

  // Get current page items
  const startIdx = currentPage * itemsPerPage;
  const currentLayouts = availableLayouts.slice(startIdx, startIdx + itemsPerPage);

  const nextPage = () => {
    if (currentPage < totalPages - 1) setCurrentPage(curr => curr + 1);
  };

  const prevPage = () => {
    if (currentPage > 0) setCurrentPage(curr => curr - 1);
  };


  return (
    <div
      className="flex flex-col items-center justify-center w-full h-full relative p-8"
      style={{ backgroundColor: isUploadFlow ? '#f8fcf3' : 'transparent' }}
    >
      {/* Nút Back */}
      <button
        onClick={prevStep}
        className="absolute top-6 left-6 flex items-center gap-2 px-6 py-3 bg-white hover:bg-gray-50 text-[#52796f] rounded-full transition-all font-serif font-bold shadow-sm hover:shadow-md border border-[#A8B5A0]/20 z-10"
      >
        <ArrowLeft size={24} />
        <span>Quay Lại</span>
      </button>

      {/* Header */}
      <motion.h2
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-5xl font-serif text-center mb-16 tracking-wider uppercase text-[#52796f]"
      >
        CHỌN BỐ CỤC
      </motion.h2>

      {/* Pagination Controls & Layout Grid */}
      <div className="relative w-full max-w-7xl px-4 md:px-16 flex items-center justify-center">
        {/* Left Arrow */}
        {currentPage > 0 && (
          <button
            onClick={prevPage}
            className="absolute -left-2 md:-left-4 lg:-left-12 z-10 p-3 bg-white hover:bg-gray-50 text-[#52796f] rounded-full shadow-md border border-[#52796f]/10 transition-all hover:scale-110"
          >
            <ChevronLeft size={32} />
          </button>
        )}

        {/* Layout Grid - Max 4 columns */}
        <div className={`grid gap-8 w-full ${isUploadFlow ? 'grid-cols-2 lg:grid-cols-3 max-w-4xl' : 'grid-cols-2 md:grid-cols-4 w-full'}`}>
          {currentLayouts.map((layout, index) => (
            <motion.div
              key={layout.id}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ delay: index * 0.1 }}
              whileHover={{ y: -10, scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => handleSelect(layout)}
              className="cursor-pointer flex flex-col items-center bg-white p-6 rounded-2xl shadow-sm border border-gray-100"
            >
              {/* Visualizer Image (Custom boxes for upload, icons for kiosk) */}
              <div className="w-full aspect-[4/5] flex items-center justify-center mb-4">
                {isUploadFlow ? (
                  <div className="flex flex-col items-center justify-center h-full w-full opacity-90" style={{ mixBlendMode: 'multiply' }}>
                    {/* 1: Layout 1 (2 Ảnh Ngang - Stacked) */}
                    {layout.id === 'mobile_double_horizontal' && (
                      <div className="w-[80%] aspect-[2/3] bg-[#b5c1a5] p-[3%] flex flex-col gap-[3%] pb-[12%] shadow-sm border border-[#a3af94] rounded-sm">
                        <div className="flex-1 bg-[#efece1] shadow-inner" />
                        <div className="flex-1 bg-[#efece1] shadow-inner" />
                      </div>
                    )}

                    {/* 2: Layout 2 (2 Ảnh Dọc - Side by side) */}
                    {layout.id === 'mobile_double_vertical' && (
                      <div className="w-[95%] aspect-[3/2] bg-[#b5c1a5] p-[2.5%] flex gap-[2.5%] pb-[8%] shadow-sm border border-[#a3af94] rounded-sm">
                        <div className="flex-1 bg-[#efece1] shadow-inner" />
                        <div className="flex-1 bg-[#efece1] shadow-inner" />
                      </div>
                    )}

                    {/* 3: Layout 3 (1 Ảnh Ngang - Single) */}
                    {layout.id === 'mobile_single' && (
                      <div className="w-[95%] aspect-[3/2] bg-[#b5c1a5] p-[2.5%] flex pb-[8%] shadow-sm border border-[#a3af94] rounded-sm">
                        <div className="flex-1 bg-[#efece1] shadow-inner" />
                      </div>
                    )}
                  </div>
                ) : (
                  <img
                    src={`/src/assets/icons/${layout.icon}`}
                    alt={layout.name}
                    className="w-full h-full object-contain mix-blend-multiply opacity-90"
                  />
                )}
              </div>

              {/* Layout Info */}
              <div className="text-center font-serif flex flex-col gap-2">
                <h3 className="text-xl lg:text-2xl font-bold text-[#20303c]">
                  {layout.name}
                </h3>
                <p className="text-sm font-sans font-medium text-[#7fa39b] uppercase tracking-wider whitespace-nowrap">
                  {layoutPrice.toLocaleString('vi-VN')} VNĐ
                </p>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Right Arrow */}
        {currentPage < totalPages - 1 && (
          <button
            onClick={nextPage}
            className="absolute -right-2 md:-right-4 lg:-right-12 z-10 p-3 bg-white hover:bg-gray-50 text-[#52796f] rounded-full shadow-md border border-[#52796f]/10 transition-all hover:scale-110"
          >
            <ChevronRight size={32} />
          </button>
        )}
      </div>

      {/* Pagination Dots Indicator */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-2 mt-12">
          {Array.from({ length: totalPages }).map((_, idx) => (
            <button
              key={idx}
              onClick={() => setCurrentPage(idx)}
              className={`w-3 h-3 rounded-full transition-all duration-300 ${currentPage === idx ? 'bg-[#52796f] w-8' : 'bg-[#52796f]/30 hover:bg-[#52796f]/50'}`}
            />
          ))}
        </div>
      )}

    </div>
  );
};

export default LayoutSelection;


