// Bàn phím số + ô hiển thị cho màn tích điểm (SĐT 10 số, PIN 4 số). Màn booth là cảm ứng, không có bàn phím thật.
import { MAU_THE } from './TheMeo';

export const hienSdt = (s) => [s.slice(0, 4), s.slice(4, 7), s.slice(7, 10)].filter(Boolean).join(' ');

export const OSo = ({ giaTri, doDai, an = false }) => (
    <div className="flex justify-center gap-2">
        {Array.from({ length: doDai }, (_, i) => (
            <div
                key={i}
                className="flex h-14 w-11 items-center justify-center rounded-xl border-2 bg-white text-2xl font-bold"
                style={{ borderColor: i === giaTri.length ? MAU_THE.vien : '#F6E6C9', color: MAU_THE.vien }}
            >
                {giaTri[i] ? (an ? '•' : giaTri[i]) : ''}
            </div>
        ))}
    </div>
);

const BanPhim = ({ giaTri, doDai, onDoi, mau = '#7B5E43' }) => {
    const bam = (k) => {
        if (k === 'xoa') onDoi('');
        else if (k === 'lui') onDoi(giaTri.slice(0, -1));
        else if (giaTri.length < doDai) onDoi(`${giaTri}${k}`);
    };
    return (
        <div className="grid w-full max-w-xs grid-cols-3 gap-3">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 'xoa', 0, 'lui'].map((k) => (
                <button
                    type="button"
                    key={k}
                    onClick={() => bam(k)}
                    className={`rounded-xl border-2 py-4 font-bold active:scale-95 ${k === 'xoa'
                        ? 'border-red-300 bg-red-100 text-lg text-red-600'
                        : k === 'lui' ? 'border-yellow-300 bg-yellow-100 text-lg text-yellow-700' : 'border-[#F6E6C9] bg-white text-2xl'}`}
                    style={typeof k === 'number' ? { color: mau } : undefined}
                >
                    {k === 'xoa' ? 'Xóa' : k === 'lui' ? 'Lùi' : k}
                </button>
            ))}
        </div>
    );
};

export default BanPhim;
