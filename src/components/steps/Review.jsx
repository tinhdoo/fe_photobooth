import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, RotateCcw } from 'lucide-react';
import { useWorkflow } from '../../context/WorkflowContext';

const Review = () => {
    const { nextStep, goToStep, sessionData, updateSessionData, timeLeft, isSessionActive } = useWorkflow();

    // --- Helper Components for Drag Logic ---
    const DraggablePhoto = ({ src, constraintsRef, onInteractionStart, onInteractionEnd }) => {
        return (
            <motion.img
                src={src}
                className="w-full h-full object-cover absolute inset-0 touch-none"
                drag
                dragConstraints={constraintsRef}
                dragElastic={0.1}
                dragMomentum={false}
                onDragStart={onInteractionStart}
                onDragEnd={onInteractionEnd}
                // Scale up slightly (1.2) to allow panning around without showing whitespace immediately
                style={{ scale: 1.2, cursor: 'grab' }}
                whileDrag={{ cursor: 'grabbing' }}
            />
        );
    };

    const PhotoSlot = ({ src, index, isActive, onClick }) => {
        const containerRef = useRef(null);
        const [isDragging, setIsDragging] = useState(false);

        const handleDragStart = () => setIsDragging(true);
        const handleDragEnd = () => setTimeout(() => setIsDragging(false), 50);

        return (
            <div
                ref={containerRef}
                className={`relative w-full h-full overflow-hidden flex items-center justify-center ${isActive ? 'ring-4 ring-[#4A5D4E]/40 z-20 scale-[1.02] shadow-lg' : ''}`}
            >
                {src ? (
                    <DraggablePhoto
                        src={src}
                        constraintsRef={containerRef}
                        onInteractionStart={handleDragStart}
                        onInteractionEnd={handleDragEnd}
                    />
                ) : (
                    <div
                        className={`w-full h-full flex flex-col items-center justify-center transition-colors cursor-pointer ${isActive ? 'bg-white' : 'bg-[#F5F5F0] hover:bg-[#EFEFE5]'}`}
                    >
                        <div className="flex flex-col items-center justify-center text-[#9BAD99]/40 hover:text-[#9BAD99]/60 transition-colors">
                            <span className="text-4xl font-light">+</span>
                        </div>
                        <div className="absolute inset-0 border-2 border-dashed border-[#9BAD99]/30 hover:border-[#9BAD99]/50 transition-colors pointer-events-none" />
                    </div>
                )}

                {/* Click handler overlay - only active if not dragging */}
                <div
                    className="absolute inset-0 z-10"
                    onClick={() => !isDragging && onClick()}
                    style={{ pointerEvents: src ? 'none' : 'auto' }} // If src exists, let drag go through (but img handles drag). Wait.
                // If src exists, img is z-0/absolute. Overlay is z-10. Overlay will block drag.
                // So we need another approach.
                // If src exists, we rely on img for drag. But click?
                // Img captures drag. Click?
                // We can put onClick on the wrapper div, but capture phase?
                // Better: Let DraggablePhoto handle click? No, drag vs click.
                />
                {/* Re-think: DraggablePhoto captures pointer events. */}
                {/* Click logic is: if drag distance < threshold, treat as click. */}
                {/* Framer motion Tap is good for this. */}
            </div>
        );
    };
    // Re-implementing PhotoSlot to be simpler and correct
    const PhotoSlotFinal = ({ src, index, isActive, onClick }) => {
        const containerRef = useRef(null);
        const [isDragging, setIsDragging] = useState(false);

        return (
            <div
                ref={containerRef}
                className={`relative w-full h-full overflow-hidden flex items-center justify-center group ${isActive ? 'ring-4 ring-[#4A5D4E]/40 z-20 scale-[1.02] shadow-lg' : ''}`}
                onClick={() => !isDragging && onClick()} // Fallback click
            >
                {src ? (
                    <motion.img
                        src={src}
                        alt={`Slot ${index}`}
                        className="w-full h-full object-cover absolute inset-0 touch-none"
                        drag
                        dragConstraints={containerRef}
                        dragElastic={0.05} // Stiff elastic
                        dragMomentum={false}
                        onDragStart={() => setIsDragging(true)}
                        onDragEnd={() => setTimeout(() => setIsDragging(false), 50)}
                        style={{ scale: 1.2, cursor: 'grab' }}
                        whileDrag={{ cursor: 'grabbing' }}
                        onTap={() => {
                            if (!isDragging) onClick(); // Tap is click
                        }}
                    />
                ) : (
                    <div className={`w-full h-full flex flex-col items-center justify-center transition-colors cursor-pointer ${isActive ? 'bg-white' : 'bg-[#F5F5F0] hover:bg-[#EFEFE5]'}`}>
                        <div className="flex flex-col items-center justify-center text-[#9BAD99]/40 group-hover:text-[#9BAD99]/60 transition-colors">
                            <span className="text-4xl font-light">+</span>
                        </div>
                    </div>
                )}

                {!src && (
                    <div className="absolute inset-0 border-2 border-dashed border-[#9BAD99]/30 group-hover:border-[#9BAD99]/50 transition-colors pointer-events-none" />
                )}
            </div>
        );
    };

    // Derived state directly from sessionData
    const photos = sessionData.photos || [];
    const [showError, setShowError] = useState(false); // State cho modal thông báo lỗi
    console.log("[Review] Render. Photos:", photos);
    const currentLayout = sessionData.layout || { photoCount: 4, type: 'grid', cols: 2, rows: 2 };

    // Create a display array filled with current photos and nulls for empty slots
    const displayPhotos = Array(currentLayout.photoCount).fill(null).map((_, i) => photos[i] || null);

    useEffect(() => {
        if (isSessionActive && timeLeft === 0) {
            // Auto proceed on timeout
            nextStep();
        }
    }, [timeLeft, isSessionActive, nextStep]);

    const handleRetakeAll = () => {
        updateSessionData('photos', []);
        goToStep(4);
    };

    const handleContinue = () => {
        // Đảm bảo kiểm tra trên tổng số ô của layout (displayPhotos đã được fill null cho các ô trống)
        const hasEmptySlot = displayPhotos.some(p => p === null);
        if (hasEmptySlot) {
            setShowError(true);
            return;
        }
        nextStep();
    };

    // STATE: Reordering
    // activeSlot indicates which slot in the layout (Left) is currently "Empty/Selected" waiting for a photo
    const activeSlot = sessionData.activeSlot; // Use from context for persistence
    const setActiveSlot = (val) => updateSessionData('activeSlot', val);

    // Keep a stable source of all captured photos for the right side list
    // This ensures that even if we remove a photo from the layout (set to null), it remains available in the source list.
    // FIX: Use separate inventory from sessionData to persist across mounts
    const sourcePhotos = sessionData.capturedPhotos || sessionData.photos || [];

    // Handler for LEFT grid (Layout) - Clicking a slot removes the photo and makes it active
    // 1. Click bên TRÁI: Xóa ảnh để tạo ô trống
    const handleSlotClick = (index) => {
        // Nếu ô đó đang có ảnh, ta xóa đi để tạo ô trống
        if (photos[index]) {
            const newPhotos = [...photos];
            newPhotos[index] = null; // Tạo ô trống
            updateSessionData('photos', newPhotos);

            // Tự động set activeSlot vào chính ô vừa xóa để người dùng biết ảnh tiếp theo sẽ vào đây
            setActiveSlot(index);
        } else {
            // Nếu ô đã trống sẵn, chỉ việc chọn nó
            setActiveSlot(index);
        }
    };

    // Handler for RIGHT grid (Source) - Clicking a source photo fills the active slot
    // 2. Click bên PHẢI: Lấp đầy ô trống theo thứ tự ưu tiên
    const handleRightPhotoClick = (sourceIndex) => {
        const selectedPhoto = sourcePhotos[sourceIndex];
        if (!selectedPhoto) return;

        const newPhotos = [...photos];

        // 1. Tìm ô trống đầu tiên (null hoặc undefined)
        let firstEmptyIndex = -1;
        for (let i = 0; i < currentLayout.photoCount; i++) {
            if (newPhotos[i] === null || newPhotos[i] === undefined) {
                firstEmptyIndex = i;
                break;
            }
        }

        if (firstEmptyIndex !== -1) {
            newPhotos[firstEmptyIndex] = selectedPhoto;
            updateSessionData('photos', newPhotos);

            // 2. Sau khi điền, tìm ô trống tiếp theo để focus activeSlot
            let nextEmptyIndex = -1;
            for (let i = 0; i < currentLayout.photoCount; i++) {
                // Ta tìm lại từ đầu, bỏ qua các ô đã có ảnh
                if (newPhotos[i] === null || newPhotos[i] === undefined) {
                    nextEmptyIndex = i;
                    break;
                }
            }

            setActiveSlot(nextEmptyIndex !== -1 ? nextEmptyIndex : null);
        }
    };



    const handleRetakePhoto = (photoIndex) => {
        // Set index to retake
        updateSessionData('retakeIndex', photoIndex);
        // Go back to capture
        goToStep(4);
    };

    return (
        <div className="flex flex-col h-screen w-full bg-[#FAFAF5] p-6 relative overflow-hidden">

            {/* Header */}
            <motion.h2
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-5xl font-serif text-[#52796f] text-center mb-12 tracking-wider uppercase"
            >
                Chọn Ảnh
            </motion.h2>

            {/* Main Content Area - Center content group */}
            <div className="flex justify-center items-center gap-12 xl:gap-24 px-4 w-full h-full max-h-[80vh]">

                {/* LEFT COLUMN: Layout Preview */}
                <div className="flex flex-col items-center justify-center relative mt-8 md:mt-0">
                    {/* Background decoration */}
                    <div className="absolute inset-0 bg-gradient-to-b from-transparent to-[#4A5D4E]/5 rounded-full blur-3xl -z-10 opacity-60" />

                    <div className="relative flex items-center justify-center p-4 transition-all duration-500">
                        <div
                            className={`bg-white p-4 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.1)] relative transition-all duration-300 ${currentLayout.type === 'strip' ? 'flex flex-col' : 'grid'
                                }`}
                            style={{
                                height: currentLayout.photoCount > 4 ? '70vh' : '60vh', // Increase height for taller grids
                                width: 'auto',
                                maxWidth: '100%',
                                gap: '12px',
                                ...(() => {
                                    if (currentLayout.type === 'strip') {
                                        return {
                                            aspectRatio: (3 / 2 * 1) / currentLayout.photoCount,
                                            gridTemplateColumns: 'none',
                                            gridTemplateRows: 'none',
                                        };
                                    }

                                    // For contact_16_8, layout defines 4x4 grid but only needs 8 boxes for review
                                    // Make it visually a 2 cols by 4 rows grid
                                    const cols = currentLayout.photoCount > 4 && currentLayout.photoCount % 2 === 0 ? 2 : currentLayout.cols;
                                    const rows = currentLayout.photoCount > 4 && currentLayout.photoCount % 2 === 0 ? Math.ceil(currentLayout.photoCount / 2) : currentLayout.rows;

                                    return {
                                        aspectRatio: (3 / 2 * cols) / rows,
                                        gridTemplateColumns: `repeat(${cols}, 1fr)`,
                                        gridTemplateRows: `repeat(${rows}, 1fr)`
                                    };
                                })()
                            }}
                        >
                            {displayPhotos.map((photoObj, i) => {
                                const photoSrc = photoObj ? (typeof photoObj === 'string' ? photoObj : photoObj.url) : null;

                                return (
                                    <motion.div
                                        key={i}
                                        whileHover={{ scale: 0.98 }}
                                        onClick={() => handleSlotClick(i)}
                                        className={`relative flex items-center justify-center overflow-hidden group cursor-pointer transition-all duration-300
                                            ${activeSlot === i
                                                ? 'ring-4 ring-[#4A5D4E]/40 z-20 scale-[1.02] shadow-lg'
                                                : 'bg-[#F5F5F0] hover:bg-[#EFEFE5]'
                                            }
                                        `}
                                        style={{
                                            flex: currentLayout.type === 'strip' ? 1 : 'unset',
                                            width: '100%',
                                            height: '100%'
                                        }}
                                    >
                                        {photoSrc ? (
                                            <img src={photoSrc} className="w-full h-full object-cover" alt={`Slot ${i}`} />
                                        ) : (
                                            <div className="flex flex-col items-center justify-center text-[#9BAD99]/40 group-hover:text-[#9BAD99]/60 transition-colors">
                                                <span className="text-4xl font-light">+</span>
                                            </div>
                                        )}

                                        {!photoSrc && (
                                            <div className="absolute inset-0 border-2 border-dashed border-[#9BAD99]/30 group-hover:border-[#9BAD99]/50 transition-colors pointer-events-none" />
                                        )}
                                    </motion.div>
                                );
                            })}
                        </div>
                    </div>

                    <p className="mt-6 text-[#6B8572] font-serif italic text-lg tracking-wide opacity-60">
                        {currentLayout.type === 'strip' ? 'Chạm để gỡ' : 'Chạm để gỡ'}
                    </p>
                </div>

                {/* RIGHT COLUMN: Source Photos */}
                <div className="flex items-center justify-center px-4 w-full md:w-auto">
                    <div className={`grid gap-3 w-full max-w-[600px] ${sourcePhotos.length > 4 ? 'grid-cols-4' : 'grid-cols-2 max-w-[400px]'}`}>
                        {sourcePhotos.map((photoObj, index) => {
                            const photoSrc = photoObj ? (typeof photoObj === 'string' ? photoObj : photoObj.url) : null;
                            const isTargetMode = activeSlot !== null;

                            return (
                                <div key={index} className="relative group w-full aspect-[4/3]">
                                    <motion.div
                                        whileHover={{ scale: 1.02 }}
                                        whileTap={{ scale: 0.98 }}
                                        onClick={() => handleRightPhotoClick(index)}
                                        className={`
                                            w-full h-full rounded-xl overflow-hidden shadow-md transition-all relative border-4 
                                            ${isTargetMode ? 'cursor-pointer hover:ring-4 ring-[#4A5D4E]/50 hover:scale-105' : 'cursor-default'}
                                            ${photoSrc ? 'bg-white' : 'bg-gray-100 border-dashed border-gray-300'}
                                        `}
                                    >
                                        {photoSrc && (
                                            <img src={photoSrc} className="w-full h-full object-cover" alt={`Capture ${index}`} />
                                        )}
                                        {isTargetMode && photoSrc && (
                                            <div className="absolute inset-0 flex items-center justify-center bg-black/0 hover:bg-black/10 transition-colors">
                                            </div>
                                        )}
                                    </motion.div>

                                    {photoSrc && (
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleRetakePhoto(index);
                                            }}
                                            className="absolute top-2 right-2 bg-white/90 p-2 rounded-full text-[#4A5D4E] shadow-md transition-all active:scale-90 z-20 hover:bg-[#4A5D4E] hover:text-white"
                                            title="Chụp lại tấm này"
                                        >
                                            <RotateCcw size={14} />
                                        </button>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Bottom Actions - Làm nút to hơn một chút */}
            <div className="absolute bottom-12 right-12 flex gap-6">
                <button
                    onClick={handleRetakeAll}
                    className="px-8 py-3 rounded-full border-2 border-[#8C9E8E] bg-white text-[#5F7464] hover:bg-gray-50 transition-colors flex items-center gap-3 font-semibold shadow-sm text-lg uppercase tracking-wide"
                >
                    <RotateCcw size={20} />
                    Chụp lại tất cả
                </button>

                <button
                    onClick={handleContinue}
                    className="px-10 py-3 rounded-full bg-[#9BAD99] text-white hover:bg-[#869984] transition-colors flex items-center gap-3 font-semibold shadow-lg text-lg uppercase tracking-wide"
                >
                    Tiếp tục <ArrowRight size={20} />
                </button>
            </div>

            {/* Error Modal */}
            <AnimatePresence>
                {showError && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setShowError(false)}
                            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
                        />
                        <motion.div
                            initial={{ opacity: 0, scale: 0.9, y: 20 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.9, y: 20 }}
                            className="bg-white p-8 rounded-3xl shadow-2xl max-w-sm w-full text-center relative z-10 border-4 border-[#D8E0D5]"
                        >
                            <h3 className="text-2xl font-serif text-[#4A5D4E] mb-3 font-bold">
                                Thông báo
                            </h3>
                            <p className="text-[#5F7464] mb-8 font-serif text-lg">
                                Bạn còn ô trống chưa chọn ảnh kìa! <br />
                                Vui lòng chọn đầy đủ ảnh nhé.
                            </p>
                            <button
                                onClick={() => setShowError(false)}
                                className="px-8 py-3 rounded-full bg-[#9BAD99] text-white hover:bg-[#869984] transition-colors font-semibold shadow-lg uppercase tracking-wide w-full"
                            >
                                Đã hiểu
                            </button>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

        </div>
    );
};

export default Review;