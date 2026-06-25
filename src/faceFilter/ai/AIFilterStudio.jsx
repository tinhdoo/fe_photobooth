// AIFilterStudio.jsx — UI biến đổi khuôn mặt (beauty/cartoon/funny) cho 1 ảnh.
import { useMemo, useState } from 'react';
import { Check, X, Wand2, AlertCircle, Loader2 } from 'lucide-react';
import { useAIFilter } from './useAIFilter.js';

const STATUS_TEXT = {
    loading: 'Đang tải ảnh...',
    detecting: 'Đang phân tích khuôn mặt...',
    error: 'Không nhận diện được khuôn mặt',
};

const CATEGORY_ORDER = ['Beauty', 'Cartoon', 'Funny'];

const Tile = ({ active, label, onClick, accent }) => (
    <button
        type="button"
        onClick={onClick}
        className={`flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-2xl border-2 px-1 text-center text-[11px] font-bold leading-tight shadow-sm transition-all active:scale-95 ${
            active ? 'border-[#e63946] ring-2 ring-[#e63946]/30' : 'border-[#E7D3B7]'
        }`}
        style={{ background: active ? '#fff' : accent }}
    >
        {label}
    </button>
);

const AIFilterStudio = ({ imageUrl, onConfirm, onCancel, title = 'Filter khuôn mặt' }) => {
    const { canvasRef, filters, selectedId, selectFilter, status, faceCount, error, exportBlob } = useAIFilter(imageUrl);
    const [saving, setSaving] = useState(false);
    const busy = status === 'loading' || status === 'detecting';

    const grouped = useMemo(() => {
        const map = {};
        filters.forEach((f) => {
            const cat = f.category || 'Khác';
            (map[cat] = map[cat] || []).push(f);
        });
        return CATEGORY_ORDER.filter((c) => map[c]).map((c) => ({ category: c, items: map[c] }))
            .concat(Object.keys(map).filter((c) => !CATEGORY_ORDER.includes(c)).map((c) => ({ category: c, items: map[c] })));
    }, [filters]);

    const accentFor = (cat) => ({ Beauty: '#FFF0F3', Cartoon: '#F0F4FF', Funny: '#FFF7E8' }[cat] || '#fff');

    const handleConfirm = async () => {
        if (saving) return;
        setSaving(true);
        try {
            const blob = await exportBlob();
            const url = blob ? URL.createObjectURL(blob) : null;
            onConfirm?.({ url, blob, filterId: selectedId });
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="flex h-full w-full flex-col bg-[#FFF8E7] font-serif">
            <header className="flex items-center justify-between border-b border-[#E7D3B7] px-5 py-3">
                <h2 className="flex items-center gap-2 text-xl font-extrabold text-[#7B5E43]">
                    <Wand2 size={20} className="text-[#e63946]" /> {title}
                </h2>
                {onCancel && (
                    <button type="button" onClick={onCancel} className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-[#7B5E43] shadow-sm active:scale-95" aria-label="Đóng">
                        <X size={20} />
                    </button>
                )}
            </header>

            <div className="relative flex min-h-0 flex-1 items-center justify-center p-4">
                <canvas ref={canvasRef} className="max-h-full max-w-full rounded-2xl bg-white shadow-md" style={{ maxHeight: '100%', maxWidth: '100%' }} />

                {busy && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-white/55 backdrop-blur-sm">
                        <Loader2 size={36} className="animate-spin text-[#e63946]" />
                        <p className="font-bold text-[#7B5E43]">{STATUS_TEXT[status]}</p>
                    </div>
                )}
                {status === 'ready' && faceCount === 0 && (
                    <div className="absolute left-1/2 top-4 flex -translate-x-1/2 items-center gap-2 rounded-full bg-amber-50 px-4 py-2 text-sm font-bold text-amber-700 shadow">
                        <AlertCircle size={16} /> Không thấy khuôn mặt
                    </div>
                )}
                {status === 'ready' && faceCount > 1 && (
                    <div className="absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-white px-4 py-2 text-sm font-bold text-[#7B5E43] shadow">
                        {faceCount} khuôn mặt
                    </div>
                )}
                {status === 'error' && (
                    <div className="absolute left-1/2 top-4 flex -translate-x-1/2 items-center gap-2 rounded-full bg-red-50 px-4 py-2 text-sm font-bold text-red-600 shadow">
                        <AlertCircle size={16} /> {error || STATUS_TEXT.error}
                    </div>
                )}
            </div>

            <div className="max-h-[34%] overflow-y-auto border-t border-[#E7D3B7] bg-white/60 px-4 py-3">
                <div className="mb-3 flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => selectFilter(null)}
                        className={`flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-2xl border-2 bg-white text-xs font-bold text-[#7B5E43] shadow-sm active:scale-95 ${selectedId === null ? 'border-[#e63946] ring-2 ring-[#e63946]/30' : 'border-[#E7D3B7]'}`}
                    >
                        <X size={18} className="mb-0.5" /> Gốc
                    </button>
                    <span className="text-sm font-bold text-[#7B5E43]">Chọn hiệu ứng bên dưới</span>
                </div>

                {grouped.map(({ category, items }) => (
                    <div key={category} className="mb-3">
                        <p className="mb-1.5 text-xs font-extrabold uppercase tracking-wide text-[#b08968]">{category}</p>
                        <div className="flex gap-2.5 overflow-x-auto pb-1">
                            {items.map((f) => (
                                <Tile key={f.id} active={selectedId === f.id} label={f.name} accent={accentFor(category)} onClick={() => selectFilter(f.id)} />
                            ))}
                        </div>
                    </div>
                ))}
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-[#E7D3B7] px-5 py-3">
                {onCancel && (
                    <button type="button" onClick={onCancel} className="rounded-full border-2 border-[#D5B895] bg-white px-7 py-2.5 font-extrabold uppercase tracking-wide text-[#7A5A3B] active:scale-95">Huỷ</button>
                )}
                <button type="button" onClick={handleConfirm} disabled={busy || saving} className="flex items-center gap-2 rounded-full bg-[#D5B895] px-9 py-2.5 font-extrabold uppercase tracking-wide text-white shadow-lg active:scale-95 disabled:opacity-60">
                    {saving ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />} Xác nhận
                </button>
            </div>
        </div>
    );
};

export default AIFilterStudio;
