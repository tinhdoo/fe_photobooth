import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, RotateCcw } from 'lucide-react';
import { useWorkflow } from '../../context/WorkflowContext';

const getPhotoUrl = (photo) => {
    if (!photo) return null;
    return typeof photo === 'string' ? photo : photo.url;
};

const getReviewGrid = (layout) => {
    if (layout.type === 'strip') {
        return {
            className: 'flex flex-col',
            style: {
                aspectRatio: '2 / 6',
                gap: '10px'
            }
        };
    }

    if (layout.type === 'strip_horizontal') {
        // 1 strip ngang (vd 3 ô hàng ngang) - sẽ in 2 bản giống nhau. Preview khung ngang.
        const cols = layout.cols || 3;
        const rows = layout.rows || 1;
        return {
            className: 'grid',
            style: {
                aspectRatio: `${cols} / ${rows}`,
                gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
                gap: '10px'
            }
        };
    }

    const cols = layout.photoCount > 4 && layout.photoCount % 2 === 0 ? 2 : (layout.cols || 2);
    const rows = layout.photoCount > 4 && layout.photoCount % 2 === 0 ? Math.ceil(layout.photoCount / 2) : (layout.rows || 2);

    return {
        className: 'grid',
        style: {
            aspectRatio: `${3 * cols} / ${2 * rows}`,
            gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
            gap: '10px'
        }
    };
};

const Review = () => {
    const { nextStep, goToStep, sessionData, updateSessionData, timeLeft, isSessionActive, timedOut, configs } = useWorkflow();
    const primaryTextColor = configs?.brand_text_primary || '#7B5E43';
    const secondaryTextColor = configs?.brand_text_secondary || '#5E6B78';
    const logoUrl = configs?.logo_main || '/logo_tomato.png';
    const photos = useMemo(() => sessionData.photos || [], [sessionData.photos]);
    const currentLayout = sessionData.layout || { photoCount: 4, type: 'grid', cols: 2, rows: 2 };
    const isUpload = sessionData.source === 'upload'; // nguồn ảnh: tải lên từ điện thoại
    const [showError, setShowError] = useState(false);

    const displayPhotos = useMemo(
        () => Array(currentLayout.photoCount).fill(null).map((_, index) => photos[index] || null),
        [currentLayout.photoCount, photos]
    );

    const sourcePhotos = sessionData.capturedPhotos?.length > 0
        ? sessionData.capturedPhotos
        : (sessionData.photos || []);
    const activeSlot = sessionData.activeSlot;
    const setActiveSlot = (value) => updateSessionData('activeSlot', value);
    const previewGrid = getReviewGrid(currentLayout);

    // Prefetch chunk bước Edit (chọn frame/filter) khi vào Review, nhưng CHỈ lúc CPU rảnh
    // (requestIdleCallback) để không tranh tài nguyên/giật khi máy đang bận. Vẫn kịp warm
    // trước khi khách bấm sang bước chọn frame -> chuyển bước mượt.
    useEffect(() => {
        const warm = () => { import('./Edit').catch(() => {}); };
        if (typeof window !== 'undefined' && window.requestIdleCallback) {
            const id = window.requestIdleCallback(warm, { timeout: 2500 });
            return () => window.cancelIdleCallback && window.cancelIdleCallback(id);
        }
        const t = setTimeout(warm, 800); // fallback (Safari cũ không có requestIdleCallback)
        return () => clearTimeout(t);
    }, []);

    useEffect(() => {
        if (timedOut) {
            // Hết giờ BỎ QUA kiểm tra ô trống của handleContinue -> nếu còn ô trống thì TỰ ĐIỀN từ nguồn
            // đã chụp (theo thứ tự, không trùng) để KHÔNG đẩy ô null sang Edit -> tránh mất ô/lệch ảnh
            // trong bản in + album.
            const slots = [...(sessionData.photos || [])];
            const used = new Set(slots.filter(Boolean));
            const avail = (sourcePhotos || []).filter((p) => p && !used.has(p));
            let changed = false;
            for (let i = 0; i < currentLayout.photoCount; i += 1) {
                if (!slots[i] && avail.length) { slots[i] = avail.shift(); changed = true; }
            }
            if (changed) updateSessionData('photos', slots);
            nextStep(); // -> Edit (rồi Edit tự in)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [timedOut]);

    const handleRetakeAll = () => {
        // Giải phóng blob URL (ảnh + video) của TẤT CẢ ảnh cũ trước khi chụp lại từ đầu,
        // tránh rò rỉ bộ nhớ trong phiên (chụp lại 1 tấm đã revoke qua releaseReplacedPhoto).
        const collectUrls = (arr) => (Array.isArray(arr) ? arr : []).flatMap((p) => {
            if (!p) return [];
            return typeof p === 'string' ? [p] : [p.url, p.videoUrl];
        });
        const urls = new Set([...collectUrls(sessionData.photos), ...collectUrls(sessionData.capturedPhotos)]);
        urls.forEach((u) => {
            if (typeof u === 'string' && u.startsWith('blob:')) {
                try { URL.revokeObjectURL(u); } catch { /* ignore */ }
            }
        });

        updateSessionData('photos', []);
        updateSessionData('capturedPhotos', []); // dọn nguồn để không giữ tham chiếu ảnh đã revoke
        // Xoá retakeIndex còn sót (vd lượt "chụp lại 1 tấm" trước bị lỗi/thoát dở): nếu để sót,
        // Capture sẽ vào nhánh retake với nguồn RỖNG -> mảng thưa, ô trống, count sai.
        updateSessionData('retakeIndex', null);
        // Camera Canon đang ẤM (live view chạy suốt vùng chụp) -> vào THẲNG bước Chụp, BỎ màn
        // Chuẩn bị cho mượt. Chưa ấm (hoặc webcam) -> qua Chuẩn bị để warm + tránh đen màn.
        goToStep(((configs?.camera_mode || 'canon') === 'canon' && sessionData.cameraWarm) ? 4 : 3.5);
    };

    const handleContinue = () => {
        const hasEmptySlot = displayPhotos.some((photo) => photo === null);
        if (hasEmptySlot) {
            setShowError(true);
            return;
        }
        nextStep();
    };

    const handleSlotClick = (index) => {
        const newPhotos = [...photos];
        if (newPhotos[index]) {
            newPhotos[index] = null;
            updateSessionData('photos', newPhotos);
        }
        setActiveSlot(index);
    };

    const handleRightPhotoClick = (sourceIndex) => {
        const selectedPhoto = sourcePhotos[sourceIndex];
        if (!selectedPhoto) return;

        const newPhotos = [...photos];
        let targetIndex = -1;

        if (activeSlot !== null && activeSlot !== undefined && !newPhotos[activeSlot]) {
            targetIndex = activeSlot;
        } else {
            targetIndex = displayPhotos.findIndex((photo) => photo === null);
        }

        if (targetIndex === -1) return;

        newPhotos[targetIndex] = selectedPhoto;
        updateSessionData('photos', newPhotos);

        const nextEmptyIndex = Array(currentLayout.photoCount)
            .fill(null)
            .findIndex((_, index) => !newPhotos[index]);
        setActiveSlot(nextEmptyIndex !== -1 ? nextEmptyIndex : null);
    };

    const handleRetakePhoto = (photoIndex) => {
        updateSessionData('retakeIndex', photoIndex);
        // Camera Canon đang ẤM (live view chạy suốt vùng chụp) -> vào THẲNG bước Chụp, BỎ màn
        // Chuẩn bị cho mượt. Chưa ấm (hoặc webcam) -> qua Chuẩn bị để warm + tránh đen màn.
        goToStep(((configs?.camera_mode || 'canon') === 'canon' && sessionData.cameraWarm) ? 4 : 3.5);
    };

    return (
        <div
            className="relative flex h-screen w-full flex-col overflow-hidden bg-[#FFF8E7] bg-cover bg-center px-8 py-6 font-serif"
            style={{ backgroundImage: configs?.['bg_select-photo'] ? `url('${configs['bg_select-photo']}')` : 'none', color: secondaryTextColor }}
        >
            <header className="mx-auto flex w-full max-w-7xl items-center justify-between">
                <h2 className="w-full text-center text-4xl font-extrabold uppercase tracking-[0.1em]" style={{ color: primaryTextColor }}>Chọn ảnh</h2>
            </header>

            <main className="mx-auto grid min-h-0 w-full max-w-7xl flex-1 grid-cols-[0.95fr_1.35fr] items-center gap-10 pb-24 pt-6">
                <section className="flex min-h-0 flex-col items-center">
                    <div className="mb-4 w-full text-center">
                        <p className="text-sm font-semibold" style={{ color: secondaryTextColor }}>Chạm vào ô để gỡ ảnh</p>
                    </div>

                    <div className="flex w-full justify-center rounded-[2rem] bg-white/75 p-5 shadow-[0_18px_55px_-35px_rgba(47,62,70,0.45)]">
                        <div
                            className={`w-full ${currentLayout.type?.includes('horizontal') ? 'max-w-[560px]' : 'max-w-[310px]'} bg-white p-4 shadow-[0_24px_65px_-30px_rgba(47,62,70,0.45)] ${previewGrid.className}`}
                            style={{
                                maxHeight: '62vh',
                                ...previewGrid.style
                            }}
                        >
                            {displayPhotos.map((photoObj, index) => {
                                const photoSrc = getPhotoUrl(photoObj);
                                const selected = activeSlot === index;

                                return (
                                    <button
                                        type="button"
                                        key={`slot-${index}`}
                                        onClick={() => handleSlotClick(index)}
                                        className={`relative flex min-h-0 items-center justify-center overflow-hidden bg-[#EEF1EA] transition-none ${
                                            selected ? 'z-10 ring-4 ring-[#7B5E43]/55' : ''
                                        }`}
                                        style={{ flex: currentLayout.type === 'strip' ? 1 : undefined }}
                                    >
                                        {photoSrc ? (
                                            <img src={photoSrc} className="h-full w-full object-cover" alt={`Ảnh trong ô ${index + 1}`} />
                                        ) : (
                                            <div className="flex h-full w-full items-center justify-center border-2 border-dashed border-[#D5B895]/45 text-4xl font-light text-[#D5B895]/70">
                                                +
                                            </div>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </section>

                <section className="flex min-h-0 flex-col">
                    <div className="mb-4 flex items-end justify-between">
                        <div>
                            <h3 className="text-xl font-extrabold" style={{ color: primaryTextColor }}>{isUpload ? 'Ảnh đã tải lên' : 'Ảnh đã chụp'}</h3>
                            <p className="text-sm font-semibold" style={{ color: secondaryTextColor }}>
                                {activeSlot !== null && activeSlot !== undefined ? `Chọn ảnh cho ô ${activeSlot + 1}` : 'Bạn đã chọn đủ ảnh'}
                            </p>
                        </div>
                    </div>

                    <div className={`grid gap-4 ${sourcePhotos.length > 4 ? 'grid-cols-4' : 'grid-cols-2'} pr-1`}>
                        {sourcePhotos.map((photoObj, index) => {
                            const photoSrc = getPhotoUrl(photoObj);
                            const canFill = activeSlot !== null && activeSlot !== undefined;

                            return (
                                <article key={`source-${index}`} className="relative aspect-[4/3] overflow-hidden rounded-2xl border-4 border-[#7B5E43]/80 bg-white shadow-md">
                                    <button
                                        type="button"
                                        onClick={() => handleRightPhotoClick(index)}
                                        disabled={!canFill}
                                        className="h-full w-full disabled:cursor-default"
                                    >
                                        {photoSrc && <img src={photoSrc} className="h-full w-full object-cover" alt={`Ảnh đã chụp ${index + 1}`} />}
                                    </button>

                                    {/* Up lại từng tấm chỉ có ý nghĩa khi chụp tại quầy; ảnh tải từ
                                        điện thoại thì re-upload cả lượt -> ẩn nút này cho nguồn upload. */}
                                    {photoSrc && !isUpload && (
                                        <button
                                            type="button"
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                handleRetakePhoto(index);
                                            }}
                                            className="absolute right-2 top-2 z-20 flex items-center gap-1.5 rounded-full bg-white/95 px-3 py-1.5 text-sm font-extrabold text-[#4A5D4E] shadow-md transition-none active:scale-95"
                                            title="Chụp lại tấm này"
                                        >
                                            <RotateCcw size={15} />
                                            Chụp lại
                                        </button>
                                    )}
                                </article>
                            );
                        })}
                    </div>
                </section>
            </main>

            <div className="absolute bottom-8 right-10 flex gap-5">
                <button
                    type="button"
                    onClick={handleRetakeAll}
                    className="flex min-h-14 items-center gap-3 rounded-full border-2 border-[#D5B895] bg-white px-8 text-lg font-extrabold uppercase tracking-wide text-[#7A5A3B] shadow-sm transition-none active:scale-95"
                >
                    <RotateCcw size={20} />
                    {isUpload ? 'Tải ảnh khác' : 'Chụp lại tất cả'}
                </button>

                <button
                    type="button"
                    onClick={handleContinue}
                    className="flex min-h-14 items-center gap-3 rounded-full bg-[#D5B895] px-10 text-lg font-extrabold uppercase tracking-wide text-white shadow-lg transition-none active:scale-95"
                >
                    Tiếp tục <ArrowRight size={20} />
                </button>
            </div>

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
                            initial={{ opacity: 0, scale: 0.94, y: 16 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.94, y: 16 }}
                            className="relative z-10 w-full max-w-sm rounded-3xl border-4 border-[#D8E0D5] bg-white p-8 text-center shadow-2xl"
                        >
                            <img src={logoUrl} onError={(e) => { if (!e.currentTarget.src.endsWith('/logo_tomato.png')) e.currentTarget.src = '/logo_tomato.png'; }} alt="Tomato Photobooth" className="mx-auto mb-4 h-16 w-16 rounded-full object-contain" />
                            <h3 className="mb-3 text-2xl font-extrabold text-[#4A5D4E]">Thông báo</h3>
                            <p className="mb-8 text-lg font-semibold leading-relaxed text-[#7A5A3B]">
                                Bạn còn ô trống chưa chọn ảnh. Vui lòng chọn đầy đủ ảnh trước khi tiếp tục.
                            </p>
                            <button
                                type="button"
                                onClick={() => setShowError(false)}
                                className="w-full rounded-full bg-[#D5B895] px-8 py-3 font-extrabold uppercase tracking-wide text-white shadow-lg transition-none active:scale-95"
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
