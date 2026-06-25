// FaceFilterStudio.jsx
// Màn chọn filter thủ công sau khi chụp: preview canvas + danh sách thumbnail + xác nhận.
// Dùng được độc lập (route demo) lẫn trong luồng booth (modal trong Review).

import { useState } from 'react';
import { Check, X, Sparkles, AlertCircle, Loader2 } from 'lucide-react';
import { useFaceFilter } from '../useFaceFilter.js';

const STATUS_TEXT = {
    loading: 'Đang tải ảnh...',
    detecting: 'Đang nhận diện khuôn mặt...',
    error: 'Không nhận diện được khuôn mặt',
};

const FilterTile = ({ active, name, thumbnail, onClick }) => (
    <button
        type="button"
        onClick={onClick}
        className={`relative flex h-20 w-20 shrink-0 flex-col items-center justify-center overflow-hidden rounded-2xl border-2 bg-white shadow-sm transition-all active:scale-95 ${
            active ? 'border-[#e63946] ring-2 ring-[#e63946]/30' : 'border-[#E7D3B7]'
        }`}
    >
        {thumbnail ? (
            <img src={thumbnail} alt={name} className="h-full w-full object-contain p-1.5" />
        ) : (
            <span className="px-1 text-center text-xs font-bold leading-tight text-[#7B5E43]">{name}</span>
        )}
        {active && (
            <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-[#e63946] text-white">
                <Check size={12} />
            </span>
        )}
    </button>
);

const FaceFilterStudio = ({ imageUrl, onConfirm, onCancel, title = 'Chọn filter' }) => {
    const {
        canvasRef, filters, selectedId, selectFilter,
        status, faceCount, error, exportBlob, exportDataUrl,
    } = useFaceFilter(imageUrl);

    const [saving, setSaving] = useState(false);
    const busy = status === 'loading' || status === 'detecting';

    const handleConfirm = async () => {
        if (saving) return;
        setSaving(true);
        try {
            const blob = await exportBlob();
            const dataUrl = blob ? null : await exportDataUrl();
            const url = blob ? URL.createObjectURL(blob) : dataUrl;
            onConfirm?.({ url, blob, dataUrl, filterId: selectedId });
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="flex h-full w-full flex-col bg-[#FFF8E7] font-serif">
            {/* Header */}
            <header className="flex items-center justify-between border-b border-[#E7D3B7] px-5 py-3">
                <h2 className="flex items-center gap-2 text-xl font-extrabold text-[#7B5E43]">
                    <Sparkles size={20} className="text-[#e63946]" /> {title}
                </h2>
                {onCancel && (
                    <button
                        type="button"
                        onClick={onCancel}
                        className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-[#7B5E43] shadow-sm active:scale-95"
                        aria-label="Đóng"
                    >
                        <X size={20} />
                    </button>
                )}
            </header>

            {/* Preview */}
            <div className="relative flex min-h-0 flex-1 items-center justify-center p-4">
                <canvas
                    ref={canvasRef}
                    className="max-h-full max-w-full rounded-2xl bg-white object-contain shadow-md"
                    style={{ maxHeight: '100%', maxWidth: '100%' }}
                />

                {busy && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-white/55 backdrop-blur-sm">
                        <Loader2 size={36} className="animate-spin text-[#e63946]" />
                        <p className="font-bold text-[#7B5E43]">{STATUS_TEXT[status]}</p>
                    </div>
                )}

                {status === 'ready' && faceCount === 0 && (
                    <div className="absolute left-1/2 top-4 flex -translate-x-1/2 items-center gap-2 rounded-full bg-amber-50 px-4 py-2 text-sm font-bold text-amber-700 shadow">
                        <AlertCircle size={16} /> Không thấy khuôn mặt — sticker có thể không hiển thị
                    </div>
                )}
                {status === 'ready' && faceCount > 1 && (
                    <div className="absolute left-1/2 top-4 flex -translate-x-1/2 items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-bold text-[#7B5E43] shadow">
                        Đã nhận diện {faceCount} khuôn mặt
                    </div>
                )}
                {status === 'error' && (
                    <div className="absolute left-1/2 top-4 flex -translate-x-1/2 items-center gap-2 rounded-full bg-red-50 px-4 py-2 text-sm font-bold text-red-600 shadow">
                        <AlertCircle size={16} /> {error || STATUS_TEXT.error}
                    </div>
                )}
            </div>

            {/* Thumbnail filter */}
            <div className="border-t border-[#E7D3B7] bg-white/60 px-4 py-3">
                <div className="flex gap-3 overflow-x-auto pb-1">
                    {/* Gốc = bỏ filter */}
                    <button
                        type="button"
                        onClick={() => selectFilter(null)}
                        className={`flex h-20 w-20 shrink-0 flex-col items-center justify-center rounded-2xl border-2 bg-white text-xs font-bold text-[#7B5E43] shadow-sm transition-all active:scale-95 ${
                            selectedId === null ? 'border-[#e63946] ring-2 ring-[#e63946]/30' : 'border-[#E7D3B7]'
                        }`}
                    >
                        <X size={20} className="mb-1 text-[#7B5E43]" /> Gốc
                    </button>

                    {filters.map((f) => (
                        <FilterTile
                            key={f.id}
                            active={selectedId === f.id}
                            name={f.name}
                            thumbnail={f.thumbnail}
                            onClick={() => selectFilter(f.id)}
                        />
                    ))}
                </div>
            </div>

            {/* Hành động */}
            <div className="flex items-center justify-end gap-3 border-t border-[#E7D3B7] px-5 py-3">
                {onCancel && (
                    <button
                        type="button"
                        onClick={onCancel}
                        className="rounded-full border-2 border-[#D5B895] bg-white px-7 py-2.5 font-extrabold uppercase tracking-wide text-[#7A5A3B] active:scale-95"
                    >
                        Huỷ
                    </button>
                )}
                <button
                    type="button"
                    onClick={handleConfirm}
                    disabled={busy || saving}
                    className="flex items-center gap-2 rounded-full bg-[#D5B895] px-9 py-2.5 font-extrabold uppercase tracking-wide text-white shadow-lg active:scale-95 disabled:opacity-60"
                >
                    {saving ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
                    Xác nhận
                </button>
            </div>
        </div>
    );
};

export default FaceFilterStudio;
