import { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

// Menu chọn tự vẽ thay cho <select> gốc: danh sách của hệ điều hành chữ to, viền vuông, nền xanh, lạc tông trang.
// Danh sách vẽ qua portal vào <body> với position fixed -> không bị khung cuộn / modal (overflow hidden,
// transform) cắt mất; thiếu chỗ phía dưới thì mở lên trên.
//   options: [{ value, label }]  — value so sánh dạng chuỗi.
//   nutClassName: ghi đè hoàn toàn kiểu nút (vd nút lọc nhỏ); để trống = ô rộng như ô nhập.
//   canPhai: danh sách canh mép phải nút (nút nhỏ nằm sát mép phải màn hình).
const NUT_MAC_DINH = 'flex w-full items-center justify-between gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-left text-sm text-[#1a1a2e] transition-all hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#e63946]/30';

const MenuChon = ({ value, options, onChange, nutClassName, canPhai = false, rongMenu, ariaLabel, disabled = false }) => {
    const [mo, setMo] = useState(false);
    const [viTri, setViTri] = useState(null);
    const nutRef = useRef(null);
    const menuRef = useRef(null);
    const dangChon = options.find((o) => String(o.value) === String(value));

    useLayoutEffect(() => {
        if (!mo || !nutRef.current) return;
        const r = nutRef.current.getBoundingClientRect();
        const rong = Math.max(rongMenu || 0, r.width);
        const cao = Math.min(280, options.length * 40 + 8);
        const lenTren = window.innerHeight - r.bottom < cao + 12 && r.top > cao + 12;
        setViTri({
            left: Math.max(8, Math.min(canPhai ? r.right - rong : r.left, window.innerWidth - rong - 8)),
            top: lenTren ? r.top - cao - 6 : r.bottom + 6,
            width: rong,
            maxHeight: cao,
        });
    }, [mo, options.length, rongMenu, canPhai]);

    useEffect(() => {
        if (!mo) return undefined;
        const ngoai = (e) => {
            if (nutRef.current?.contains(e.target) || menuRef.current?.contains(e.target)) return;
            setMo(false);
        };
        // Cuộn trang / đổi cỡ thì đóng (vị trí fixed đã tính sẽ lệch); cuộn bên trong danh sách thì bỏ qua.
        const cuon = (e) => { if (!menuRef.current?.contains(e.target)) setMo(false); };
        const phim = (e) => { if (e.key === 'Escape') setMo(false); };
        document.addEventListener('pointerdown', ngoai);
        window.addEventListener('scroll', cuon, true);
        window.addEventListener('resize', cuon);
        document.addEventListener('keydown', phim);
        return () => {
            document.removeEventListener('pointerdown', ngoai);
            window.removeEventListener('scroll', cuon, true);
            window.removeEventListener('resize', cuon);
            document.removeEventListener('keydown', phim);
        };
    }, [mo]);

    return (
        <>
            <button
                ref={nutRef}
                type="button"
                disabled={disabled}
                onClick={() => setMo((m) => !m)}
                aria-haspopup="listbox"
                aria-expanded={mo}
                aria-label={ariaLabel}
                className={`${nutClassName || NUT_MAC_DINH} ${mo && !nutClassName ? 'border-[#e63946] bg-white' : ''} disabled:cursor-not-allowed disabled:opacity-60`}
            >
                <span className="min-w-0 truncate">{dangChon ? dangChon.label : ''}</span>
                <ChevronDown size={16} className={`shrink-0 text-gray-400 transition-transform ${mo ? 'rotate-180' : ''}`} />
            </button>
            {mo && viTri && createPortal(
                <div
                    ref={menuRef}
                    role="listbox"
                    style={{ position: 'fixed', left: viTri.left, top: viTri.top, width: viTri.width, maxHeight: viTri.maxHeight }}
                    className="z-[1000] overflow-y-auto rounded-2xl border border-gray-100 bg-white p-1 shadow-xl shadow-black/10"
                >
                    {options.map((o) => {
                        const on = String(o.value) === String(value);
                        return (
                            <button
                                key={String(o.value)}
                                type="button"
                                role="option"
                                aria-selected={on}
                                onClick={() => { onChange(o.value); setMo(false); }}
                                className={`flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm font-semibold ${on ? 'bg-[#e63946]/10 text-[#e63946]' : 'text-gray-700 hover:bg-gray-50 active:bg-gray-50'}`}
                            >
                                <span className="min-w-0 truncate">{o.label}</span>
                                {on && <Check size={14} className="shrink-0" />}
                            </button>
                        );
                    })}
                </div>,
                document.body,
            )}
        </>
    );
};

export default MenuChon;
