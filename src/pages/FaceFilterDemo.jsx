// FaceFilterDemo.jsx — trang thử nghiệm Face Filter độc lập (route /face-filter).
// Chọn 1 ảnh từ máy -> mở studio -> chọn filter -> xác nhận -> xem/tải kết quả.
import { useState } from 'react';
import { FaceFilterStudio } from '../faceFilter';

const FaceFilterDemo = () => {
    const [imageUrl, setImageUrl] = useState('');
    const [result, setResult] = useState(null);

    const handlePick = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setResult(null);
        setImageUrl(URL.createObjectURL(file));
    };

    if (imageUrl && !result) {
        return (
            <div className="h-dvh w-full">
                <FaceFilterStudio
                    imageUrl={imageUrl}
                    onCancel={() => setImageUrl('')}
                    onConfirm={(r) => setResult(r)}
                />
            </div>
        );
    }

    return (
        <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-[#FFF8E7] p-8 font-serif text-[#7B5E43]">
            <h1 className="text-3xl font-extrabold">Face Filter — Demo</h1>

            {result ? (
                <>
                    <img src={result.url} alt="Kết quả" className="max-h-[60vh] rounded-2xl bg-white shadow-md" />
                    <div className="flex gap-3">
                        <a
                            href={result.url}
                            download="face-filter.jpg"
                            className="rounded-full bg-[#D5B895] px-7 py-2.5 font-extrabold uppercase text-white shadow-lg"
                        >
                            Tải ảnh
                        </a>
                        <button
                            onClick={() => { setResult(null); setImageUrl(''); }}
                            className="rounded-full border-2 border-[#D5B895] bg-white px-7 py-2.5 font-extrabold uppercase text-[#7A5A3B]"
                        >
                            Ảnh khác
                        </button>
                    </div>
                </>
            ) : (
                <label className="cursor-pointer rounded-full bg-[#D5B895] px-8 py-3 font-extrabold uppercase text-white shadow-lg">
                    Chọn ảnh
                    <input type="file" accept="image/*" onChange={handlePick} className="hidden" />
                </label>
            )}
        </div>
    );
};

export default FaceFilterDemo;
