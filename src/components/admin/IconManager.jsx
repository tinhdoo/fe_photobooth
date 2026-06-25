// IconManager.jsx — Quản lý icon/sticker (thêm/xoá/đổi tên) cho khách chọn ở booth.
// Lưu trên cloud qua /api/icons (Supabase Storage). Dùng trong tab "Icons" của Quản lý khung hình.
import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { Upload, Trash2, Pencil, Loader2, Check, X, Image as ImageIcon } from 'lucide-react';

const IconManager = ({ apiBase }) => {
    const api = (p) => `${apiBase}${p}`;
    const [icons, setIcons] = useState([]);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [editing, setEditing] = useState(null); // name đang đổi tên
    const [editValue, setEditValue] = useState('');
    const [msg, setMsg] = useState(null);
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

    const handleUpload = async (e) => {
        const files = Array.from(e.target.files || []);
        if (!files.length) return;
        setUploading(true);
        try {
            for (const file of files) {
                const form = new FormData();
                form.append('file', file);
                await axios.post(api('/api/frames?kind=sticker'), form, { headers: { 'Content-Type': 'multipart/form-data' } });
            }
            notify(`Đã tải lên ${files.length} icon`);
            await fetchIcons();
        } catch (err) {
            console.error(err);
            notify('Tải lên thất bại', false);
        } finally {
            setUploading(false);
            if (fileRef.current) fileRef.current.value = '';
        }
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
        <div>
            {msg && (
                <div className={`fixed top-6 right-6 z-50 px-5 py-3 rounded-xl shadow-2xl border font-medium ${msg.ok ? 'bg-white border-green-200 text-green-700' : 'bg-white border-red-200 text-red-700'}`}>
                    {msg.text}
                </div>
            )}

            <div className="flex items-center justify-between mb-5">
                <div>
                    <h2 className="font-bold text-lg text-[#1a1a2e]">Icon / Sticker cho khách</h2>
                    <p className="text-gray-400 text-sm">PNG nền trong suốt. Khách sẽ tự kéo, phóng to, xoay lên ảnh.</p>
                </div>
                <button
                    onClick={() => fileRef.current?.click()}
                    disabled={uploading}
                    className="flex items-center gap-2 bg-[#e63946] text-white px-5 py-2.5 rounded-full font-bold shadow hover:bg-[#c1121f] disabled:opacity-60"
                >
                    {uploading ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18} />}
                    Thêm icon
                </button>
                <input ref={fileRef} type="file" accept="image/png,image/webp" multiple className="hidden" onChange={handleUpload} />
            </div>

            {loading ? (
                <div className="flex items-center justify-center py-20 text-gray-400"><Loader2 size={28} className="animate-spin" /></div>
            ) : icons.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                    <ImageIcon size={48} className="mb-3 text-gray-300" />
                    <p className="font-bold">Chưa có icon nào</p>
                    <p className="text-sm">Bấm “Thêm icon” để tải PNG lên.</p>
                </div>
            ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
                    {icons.map((icon) => (
                        <div key={icon.id} className="rounded-2xl border border-gray-100 bg-white p-3 shadow-sm">
                            <div className="aspect-square rounded-xl bg-[repeating-conic-gradient(#f3f4f6_0%_25%,#fff_0%_50%)] bg-[length:16px_16px] flex items-center justify-center overflow-hidden mb-2">
                                <img src={icon.url} alt={icon.name} className="max-h-full max-w-full object-contain" />
                            </div>
                            {editing === icon.name ? (
                                <div className="flex items-center gap-1">
                                    <input
                                        value={editValue}
                                        onChange={(e) => setEditValue(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && saveRename(icon.name)}
                                        autoFocus
                                        className="w-full min-w-0 rounded-lg border border-gray-200 px-2 py-1 text-xs"
                                    />
                                    <button onClick={() => saveRename(icon.name)} className="shrink-0 rounded-md bg-green-500 p-1.5 text-white"><Check size={13} /></button>
                                    <button onClick={() => setEditing(null)} className="shrink-0 rounded-md border border-gray-200 p-1.5 text-gray-400"><X size={13} /></button>
                                </div>
                            ) : (
                                <div className="flex items-center justify-between gap-1">
                                    <span className="truncate text-xs font-semibold text-gray-600" title={icon.name}>{icon.name}</span>
                                    <div className="flex shrink-0 gap-1">
                                        <button onClick={() => startRename(icon.name)} title="Đổi tên" className="rounded-md p-1.5 text-gray-400 hover:bg-gray-50 hover:text-[#987351]"><Pencil size={13} /></button>
                                        <button onClick={() => handleDelete(icon.name)} title="Xoá" className="rounded-md p-1.5 text-red-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={13} /></button>
                                    </div>
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
