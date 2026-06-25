// StickerEditor.jsx — Khách TỰ chọn icon từ cloud rồi kéo / phóng to / xoay đặt lên ảnh.
// Không dùng nhận diện khuôn mặt. Xuất ảnh ở độ phân giải gốc.
import { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { Check, X, Loader2, Trash2, RotateCw, Sticker } from 'lucide-react';
import { CLOUD_API_URL } from '../config/api';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
let SEQ = 0;

// Load 1 ảnh (icon/ảnh) -> HTMLImageElement, crossOrigin để xuất canvas không bị taint.
const loadImg = (src) => new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
});

const StickerEditor = ({ imageUrl, onConfirm, onCancel }) => {
    const stageRef = useRef(null);     // khung ảnh (để quy đổi toạ độ)
    const imgRef = useRef(null);
    const [icons, setIcons] = useState([]);
    const [iconsLoading, setIconsLoading] = useState(true);
    const [placed, setPlaced] = useState([]); // {id,url,ratio,cx,cy,scale,rot}
    const [selected, setSelected] = useState(null);
    const [saving, setSaving] = useState(false);
    const dragRef = useRef(null);

    // Nạp danh sách icon do admin quản lý.
    useEffect(() => {
        let alive = true;
        axios.get(`${CLOUD_API_URL}/api/frames?kind=sticker`)
            .then((res) => { if (alive) setIcons(Array.isArray(res.data) ? res.data : []); })
            .catch(() => {})
            .finally(() => { if (alive) setIconsLoading(false); });
        return () => { alive = false; };
    }, []);

    const stageRect = () => stageRef.current?.getBoundingClientRect();

    // Thêm icon vào giữa ảnh.
    const addIcon = async (icon) => {
        let ratio = 1;
        try { const im = await loadImg(icon.url); ratio = (im.naturalHeight || 1) / (im.naturalWidth || 1); } catch { /* ignore */ }
        const id = `s${++SEQ}`;
        setPlaced((p) => [...p, { id, url: icon.url, ratio, cx: 0.5, cy: 0.45, scale: 0.28, rot: 0 }]);
        setSelected(id);
    };

    const removeSticker = (id) => {
        setPlaced((p) => p.filter((s) => s.id !== id));
        if (selected === id) setSelected(null);
    };

    // Kéo di chuyển sticker.
    const onStickerDown = (e, s) => {
        e.stopPropagation();
        setSelected(s.id);
        const r = stageRect();
        dragRef.current = { mode: 'move', id: s.id, startX: e.clientX, startY: e.clientY, cx: s.cx, cy: s.cy, w: r.width, h: r.height };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    };

    // Kéo góc: vừa phóng to vừa xoay.
    const onHandleDown = (e, s) => {
        e.stopPropagation();
        setSelected(s.id);
        const r = stageRect();
        const centerX = r.left + s.cx * r.width;
        const centerY = r.top + s.cy * r.height;
        dragRef.current = { mode: 'transform', id: s.id, centerX, centerY, w: r.width, ratio: s.ratio };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    };

    const onMove = (e) => {
        const d = dragRef.current;
        if (!d) return;
        if (d.mode === 'move') {
            const dcx = (e.clientX - d.startX) / d.w;
            const dcy = (e.clientY - d.startY) / d.h;
            setPlaced((p) => p.map((s) => s.id === d.id ? { ...s, cx: clamp(d.cx + dcx, 0, 1), cy: clamp(d.cy + dcy, 0, 1) } : s));
        } else {
            const dx = e.clientX - d.centerX;
            const dy = e.clientY - d.centerY;
            const dist = Math.hypot(dx, dy);
            const diag = Math.sqrt(1 + d.ratio * d.ratio);
            const scale = clamp((2 * dist) / (d.w * diag), 0.05, 2.5);
            const rot = (Math.atan2(dy, dx) * 180) / Math.PI - 45;
            setPlaced((p) => p.map((s) => s.id === d.id ? { ...s, scale, rot } : s));
        }
    };

    const onUp = () => {
        dragRef.current = null;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
    };

    // Ghép sticker vào ảnh ở độ phân giải gốc.
    const handleConfirm = async () => {
        if (saving) return;
        setSaving(true);
        try {
            const base = await loadImg(imageUrl);
            const W = base.naturalWidth || base.width;
            const H = base.naturalHeight || base.height;
            const canvas = document.createElement('canvas');
            canvas.width = W; canvas.height = H;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(base, 0, 0, W, H);

            for (const s of placed) {
                let icon;
                try { icon = await loadImg(s.url); } catch { continue; }
                const w = s.scale * W;
                const h = w * s.ratio;
                ctx.save();
                ctx.translate(s.cx * W, s.cy * H);
                ctx.rotate((s.rot * Math.PI) / 180);
                ctx.drawImage(icon, -w / 2, -h / 2, w, h);
                ctx.restore();
            }

            const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.95));
            const url = blob ? URL.createObjectURL(blob) : canvas.toDataURL('image/jpeg', 0.95);
            onConfirm?.({ url, blob });
        } catch (e) {
            console.error('[StickerEditor] export error', e);
            onCancel?.();
        } finally {
            setSaving(false);
        }
    };

    const selectedSticker = useMemo(() => placed.find((s) => s.id === selected), [placed, selected]);

    return (
        <div className="flex h-full w-full flex-col bg-[#FFF8E7] font-serif">
            <header className="flex items-center justify-between border-b border-[#E7D3B7] px-5 py-3">
                <h2 className="flex items-center gap-2 text-xl font-extrabold text-[#7B5E43]">
                    <Sticker size={20} className="text-[#e63946]" /> Dán sticker
                </h2>
                {onCancel && (
                    <button type="button" onClick={onCancel} className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-[#7B5E43] shadow-sm active:scale-95"><X size={20} /></button>
                )}
            </header>

            {/* Khung ảnh + sticker */}
            <div className="relative flex min-h-0 flex-1 items-center justify-center p-4" onPointerDown={() => setSelected(null)}>
                <div ref={stageRef} className="relative inline-block max-h-full max-w-full">
                    <img ref={imgRef} src={imageUrl} alt="" className="block max-h-[calc(100vh-260px)] max-w-full rounded-2xl shadow-md" draggable={false} />

                    {placed.map((s) => (
                        <div
                            key={s.id}
                            onPointerDown={(e) => onStickerDown(e, s)}
                            className="absolute cursor-move touch-none"
                            style={{
                                left: `${s.cx * 100}%`,
                                top: `${s.cy * 100}%`,
                                width: `${s.scale * 100}%`,
                                transform: `translate(-50%, -50%) rotate(${s.rot}deg)`,
                            }}
                        >
                            <img src={s.url} alt="" className="pointer-events-none block w-full select-none" draggable={false} />
                            {selected === s.id && (
                                <>
                                    <span className="pointer-events-none absolute inset-0 rounded-md ring-2 ring-[#e63946]/70" />
                                    {/* Nút xoá (góc trên trái) */}
                                    <button
                                        type="button"
                                        onPointerDown={(e) => { e.stopPropagation(); removeSticker(s.id); }}
                                        className="absolute -left-3 -top-3 flex h-7 w-7 items-center justify-center rounded-full bg-red-500 text-white shadow"
                                    ><Trash2 size={13} /></button>
                                    {/* Tay nắm phóng/xoay (góc dưới phải) */}
                                    <button
                                        type="button"
                                        onPointerDown={(e) => onHandleDown(e, s)}
                                        className="absolute -bottom-3 -right-3 flex h-7 w-7 items-center justify-center rounded-full bg-[#987351] text-white shadow touch-none"
                                    ><RotateCw size={13} /></button>
                                </>
                            )}
                        </div>
                    ))}
                </div>

                {placed.length === 0 && (
                    <div className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-white/90 px-4 py-2 text-sm font-bold text-[#7B5E43] shadow">
                        Chọn icon bên dưới → kéo để di chuyển, nắm góc để phóng to/xoay
                    </div>
                )}
            </div>

            {/* Bảng icon */}
            <div className="border-t border-[#E7D3B7] bg-white/60 px-4 py-3">
                {iconsLoading ? (
                    <div className="flex items-center justify-center py-4 text-[#7B5E43]"><Loader2 size={20} className="animate-spin" /></div>
                ) : icons.length === 0 ? (
                    <p className="py-3 text-center text-sm font-semibold text-[#7B5E43]">Chưa có icon. Quản trị viên thêm icon trong trang Quản lý khung hình → Icons.</p>
                ) : (
                    <div className="flex gap-3 overflow-x-auto pb-1">
                        {icons.map((icon) => (
                            <button
                                key={icon.id}
                                type="button"
                                onClick={() => addIcon(icon)}
                                className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border-2 border-[#E7D3B7] bg-white p-1.5 shadow-sm active:scale-95"
                                title={icon.name}
                            >
                                <img src={icon.url} alt={icon.name} className="max-h-full max-w-full object-contain" />
                            </button>
                        ))}
                    </div>
                )}
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-[#E7D3B7] px-5 py-3">
                <span className="text-sm font-semibold text-[#7B5E43]">{placed.length} sticker</span>
                <div className="flex gap-3">
                    {onCancel && (
                        <button type="button" onClick={onCancel} className="rounded-full border-2 border-[#D5B895] bg-white px-7 py-2.5 font-extrabold uppercase tracking-wide text-[#7A5A3B] active:scale-95">Huỷ</button>
                    )}
                    <button type="button" onClick={handleConfirm} disabled={saving} className="flex items-center gap-2 rounded-full bg-[#D5B895] px-9 py-2.5 font-extrabold uppercase tracking-wide text-white shadow-lg active:scale-95 disabled:opacity-60">
                        {saving ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />} Xác nhận
                    </button>
                </div>
            </div>
        </div>
    );
};

export default StickerEditor;
