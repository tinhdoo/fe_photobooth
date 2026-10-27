// IconManager.jsx — Quản lý icon/sticker (thêm/xoá/đổi tên) cho khách chọn ở booth.
// Lưu trên cloud qua /api/icons (Supabase Storage). Dùng trong tab "Icons" của Quản lý khung hình.
import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { Upload, Trash2, Pencil, Loader2, Check, X, Image as ImageIcon, Wand2 } from 'lucide-react';
import { docAnh, daTrongSuot, tachNen, sangBlob } from '../../utils/tachNenSticker';

const IconManager = ({ apiBase }) => {
    const api = (p) => `${apiBase}${p}`;
    const [icons, setIcons] = useState([]);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [editing, setEditing] = useState(null); // name đang đổi tên
    const [editValue, setEditValue] = useState('');
    const [msg, setMsg] = useState(null);
    const [dragOver, setDragOver] = useState(false);
    const fileRef = useRef(null);

    const notify = (text, ok = true) => { setMsg({ text, ok }); setTimeout(() => setMsg(null), 2500); };

    const fetchIcons = async () => {
        setLoading(true);
        try {
            const res = await axios.get(api('/api/frames?kind=sticker'));
            setIcons(Array.isArray(res.data) ? res.data : []);
        } catch (e) {
            console.error('fetch icons', e);
            notify('Không tải được danh sách icon', false);
        } finally {
            setLoading(false);
        }
    };
    useEffect(() => { fetchIcons(); /* eslint-disable-next-line */ }, []);

    // Chọn ảnh -> tự tách nền (utils/tachNenSticker) -> bảng xem trước để chỉnh độ nhạy -> tải lên PNG trong suốt.
    // Ảnh đã trong suốt sẵn thì mặc định giữ nguyên.
    const [cho, setCho] = useState([]); // [{ id, file, goc, gocXem, daTrong, giuNen, doNhay, xoaLo, kq, xem }]
    const [dangDoc, setDangDoc] = useState(false);

    const tinh = (it) => {
        if (it.giuNen) return { ...it, kq: null, xem: it.goc.toDataURL('image/png') };
        const kq = tachNen(it.goc, { doNhay: it.doNhay, xoaLoBenTrong: it.xoaLo });
        return { ...it, kq, xem: kq.toDataURL('image/png') };
    };
    const suaCho = (id, thayDoi) => setCho((ds) => ds.map((it) => (it.id === id ? tinh({ ...it, ...thayDoi }) : it)));

    const moXuLy = async (fileList) => {
        const files = Array.from(fileList || []).filter((f) => f.type.startsWith('image/'));
        if (fileRef.current) fileRef.current.value = '';
        if (!files.length) return;
        setDangDoc(true);
        try {
            const ds = [];
            for (const file of files) {
                const goc = await docAnh(file);
                const daTrong = daTrongSuot(goc);
                ds.push(tinh({ id: `${file.name}-${ds.length}-${file.size}`, file, goc, gocXem: goc.toDataURL('image/jpeg', 0.6), daTrong, giuNen: daTrong, doNhay: 40, xoaLo: false }));
            }
            setCho(ds);
        } catch (err) {
            console.error(err);
            notify('Không đọc được ảnh', false);
        } finally {
            setDangDoc(false);
        }
    };

    const taiLenCho = async () => {
        setUploading(true);
        try {
            for (const it of cho) {
                const form = new FormData();
                if (it.giuNen) {
                    form.append('file', it.file);
                } else {
                    const goc = it.file.name.replace(/\.[a-z0-9]+$/i, '') || 'sticker';
                    form.append('file', await sangBlob(it.kq), `${goc}.png`);
                }
                await axios.post(api('/api/frames?kind=sticker'), form, { headers: { 'Content-Type': 'multipart/form-data' } });
            }
            notify(`Đã tải lên ${cho.length} icon`);
            setCho([]);
            await fetchIcons();
        } catch (err) {
            console.error(err);
            notify('Tải lên thất bại', false);
        } finally {
            setUploading(false);
        }
    };

    const handleUpload = (e) => moXuLy(e.target.files);

    const handleDrop = (e) => {
        e.preventDefault();
        setDragOver(false);
        moXuLy(e.dataTransfer?.files);
    };

    const handleDelete = async (name) => {
        if (!window.confirm(`Xoá icon "${name}"?`)) return;
        try {
            await axios.delete(api('/api/frames?kind=sticker'), { params: { name } });
            notify('Đã xoá icon');
            setIcons((prev) => prev.filter((i) => i.name !== name));
        } catch (err) {
            console.error(err);
            notify('Xoá thất bại', false);
        }
    };

    const startRename = (name) => {
        const dot = name.lastIndexOf('.');
        setEditing(name);
        setEditValue(dot > 0 ? name.slice(0, dot) : name);
    };

    const saveRename = async (name) => {
        const newName = editValue.trim();
        if (!newName || newName === name) { setEditing(null); return; }
        try {
            await axios.post(api('/api/frames?kind=sticker'), { action: 'rename', name, newName });
            notify('Đã đổi tên');
            setEditing(null);
            await fetchIcons();
        } catch (err) {
            console.error(err);
            notify('Đổi tên thất bại', false);
        }
    };

    return (
        // Cả vùng nhận thả file (máy tính) — không còn ô "kéo & thả" to chiếm chỗ, vô nghĩa trên điện thoại.
        <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false); }}
            onDrop={handleDrop}
            className={`relative rounded-2xl transition-all ${dragOver ? 'ring-4 ring-[#e63946]/30' : ''}`}
        >
            {msg && (
                <div className={`fixed top-6 right-6 z-50 px-5 py-3 rounded-xl shadow-2xl border font-medium ${msg.ok ? 'bg-white border-green-200 text-green-700' : 'bg-white border-red-200 text-red-700'}`}>
                    {msg.text}
                </div>
            )}
            {dragOver && (
                <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center rounded-2xl border-2 border-dashed border-[#e63946] bg-[#e63946]/5 text-sm font-bold text-[#e63946]">
                    <Upload size={20} className="mr-2" /> Thả để tải lên
                </div>
            )}

            {cho.length > 0 && (
                <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 sm:items-center sm:p-6">
                    <div className="flex max-h-[92vh] w-full max-w-3xl flex-col rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl">
                        <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3 sm:px-5">
                            <Wand2 size={18} className="text-[#e63946]" />
                            <h3 className="flex-1 text-base font-bold text-[#1a1a2e]">Tách nền <span className="text-xs font-semibold text-gray-400">{cho.length}</span></h3>
                            <button type="button" onClick={() => setCho([])} disabled={uploading} aria-label="Đóng" className="grid h-9 w-9 place-items-center rounded-xl text-gray-400 hover:bg-gray-100"><X size={18} /></button>
                        </div>
                        <div className="grid flex-1 grid-cols-1 gap-3 overflow-y-auto p-4 sm:grid-cols-2 sm:p-5">
                            {cho.map((it) => (
                                <div key={it.id} className="rounded-2xl border border-gray-100 p-3">
                                    <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded-xl bg-[repeating-conic-gradient(#e5e7eb_0%_25%,#fff_0%_50%)] bg-[length:16px_16px] p-2">
                                        <img src={it.xem} alt={it.file.name} className="max-h-full max-w-full object-contain" />
                                        <img src={it.gocXem} alt="Ảnh gốc" className="absolute bottom-2 left-2 h-12 w-12 rounded-lg border-2 border-white bg-white object-contain shadow" />
                                        <button
                                            type="button"
                                            onClick={() => setCho((ds) => ds.filter((x) => x.id !== it.id))}
                                            aria-label="Bỏ ảnh này"
                                            className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-lg bg-white/90 text-gray-500 shadow hover:text-red-600"
                                        >
                                            <Trash2 size={15} />
                                        </button>
                                    </div>
                                    <p className="mt-2 truncate text-xs font-semibold text-[#1a1a2e]" title={it.file.name}>{it.file.name}</p>
                                    <div className="mt-2 grid grid-cols-2 gap-1 rounded-xl bg-gray-100 p-1 text-xs font-bold">
                                        {[[false, 'Tách nền'], [true, 'Giữ nguyên']].map(([giu, ten]) => (
                                            <button key={ten} type="button" onClick={() => suaCho(it.id, { giuNen: giu })} className={`rounded-lg py-1.5 transition-all ${it.giuNen === giu ? 'bg-white text-[#e63946] shadow-sm' : 'text-gray-500'}`}>{ten}</button>
                                        ))}
                                    </div>
                                    {!it.giuNen && (
                                        <div className="mt-2 space-y-2">
                                            <label className="flex items-center gap-2 text-xs font-semibold text-gray-600">
                                                <span className="w-14 shrink-0">Độ nhạy</span>
                                                <input
                                                    type="range" min="8" max="120" step="2"
                                                    defaultValue={it.doNhay}
                                                    onPointerUp={(e) => suaCho(it.id, { doNhay: Number(e.currentTarget.value) })}
                                                    onKeyUp={(e) => suaCho(it.id, { doNhay: Number(e.currentTarget.value) })}
                                                    className="flex-1 accent-[#e63946]"
                                                />
                                            </label>
                                            <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-gray-600">
                                                <input type="checkbox" checked={it.xoaLo} onChange={(e) => suaCho(it.id, { xoaLo: e.target.checked })} className="h-4 w-4 accent-[#e63946]" />
                                                Xoá cả nền kẹt bên trong
                                            </label>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                        <div className="flex gap-2 border-t border-gray-100 p-4 sm:px-5">
                            <button type="button" onClick={() => setCho([])} disabled={uploading} className="flex-1 rounded-xl border border-gray-200 py-3 text-sm font-bold text-gray-600 sm:flex-none sm:px-6">Huỷ</button>
                            <button type="button" onClick={taiLenCho} disabled={uploading} className="flex flex-[2] items-center justify-center gap-2 rounded-xl bg-[#e63946] py-3 text-sm font-bold text-white shadow-md shadow-[#e63946]/20 disabled:opacity-70 sm:ml-auto sm:flex-none sm:px-6">
                                {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                                Tải lên {cho.length}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Thanh công cụ một hàng, giống tab khung: tên + số lượng | Tải lên */}
            <div className="mb-4 flex items-center gap-2">
                <h2 className="min-w-0 flex-1 truncate text-base font-bold text-[#1a1a2e]">
                    Icon / sticker
                    <span className="ml-1.5 text-xs font-semibold text-gray-400">{loading ? '…' : icons.length}</span>
                </h2>
                <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    disabled={uploading || dangDoc}
                    className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-[#e63946] px-4 text-sm font-bold text-white shadow-md shadow-[#e63946]/15 transition-all hover:bg-[#c1121f] active:scale-95 disabled:opacity-70"
                >
                    {uploading || dangDoc ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                    {uploading ? 'Đang tải' : 'Tải lên'}
                </button>
                <input ref={fileRef} type="file" accept="image/png,image/webp,image/jpeg" multiple className="hidden" onChange={handleUpload} />
            </div>

            {loading ? (
                <div className="flex items-center justify-center py-20 text-gray-400"><Loader2 size={28} className="animate-spin" /></div>
            ) : icons.length === 0 ? (
                <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-gray-200 bg-white p-10 text-sm font-semibold text-gray-400 transition-colors hover:border-[#e63946]/40 hover:text-[#e63946]"
                >
                    <ImageIcon size={28} />
                    Chưa có icon nào
                </button>
            ) : (
                <div className="grid grid-cols-3 gap-2 sm:gap-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
                    {icons.map((icon) => (
                        <div key={icon.id} className="overflow-hidden rounded-2xl border border-gray-100 bg-white">
                            <div className="flex aspect-square items-center justify-center overflow-hidden bg-[repeating-conic-gradient(#f3f4f6_0%_25%,#fff_0%_50%)] bg-[length:16px_16px] p-2">
                                <img src={icon.url} alt={icon.name} loading="lazy" decoding="async" className="max-h-full max-w-full object-contain" />
                            </div>
                            {editing === icon.name ? (
                                <div className="flex items-center gap-1 border-t border-gray-100 p-1">
                                    <input
                                        value={editValue}
                                        onChange={(e) => setEditValue(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && saveRename(icon.name)}
                                        autoFocus
                                        className="h-8 w-full min-w-0 rounded-lg border border-gray-200 px-2 text-xs"
                                    />
                                    <button onClick={() => saveRename(icon.name)} aria-label="Lưu tên" className="grid h-8 w-7 shrink-0 place-items-center rounded-lg bg-[#1a1a2e] text-white"><Check size={14} /></button>
                                    <button onClick={() => setEditing(null)} aria-label="Huỷ" className="grid h-8 w-7 shrink-0 place-items-center rounded-lg text-gray-400 hover:bg-gray-100"><X size={14} /></button>
                                </div>
                            ) : (
                                <div className="flex items-center border-t border-gray-100 py-1 pl-2 pr-0.5 sm:pl-3 sm:pr-1">
                                    <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-[#1a1a2e] sm:text-xs" title={icon.name}>{icon.name}</span>
                                    <button onClick={() => startRename(icon.name)} title="Đổi tên" className="grid h-8 w-7 shrink-0 place-items-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-[#1a1a2e]"><Pencil size={14} /></button>
                                    <button onClick={() => handleDelete(icon.name)} title="Xoá" className="grid h-8 w-7 shrink-0 place-items-center rounded-lg text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"><Trash2 size={15} /></button>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default IconManager;
