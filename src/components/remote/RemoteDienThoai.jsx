// Trang điện thoại của khách để điều khiển máy ảnh booth (/r/:ma). Chỉ vẽ theo props; kết nối ở
// remote/useRemoteDienThoai.js (trang pages/RemotePage.jsx). Tông màu theo màn booth: kem #FFF8E7, nâu #3F3127, đỏ #c1121f.
// Bấm CHỤP là booth chụp NGAY (không đếm ngược). Booth chỉ tự đếm ngược khi khách không bấm quá lâu / mất kết nối.
import { Camera, Check, Loader2, WifiOff, Clock, MonitorSmartphone } from 'lucide-react';

const phutGiay = (s) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.max(0, s) % 60).padStart(2, '0')}`;

const Khung = ({ children, ketNoi }) => (
    <div className="flex min-h-[100dvh] flex-col bg-[#FFF8E7] font-serif text-[#3F3127]">
        <header className="flex items-center gap-2.5 px-5 pb-2 pt-[calc(env(safe-area-inset-top)+14px)]">
            <img src="/logo_tomato.png" alt="" className="h-9 w-9 rounded-full object-contain" />
            <div className="min-w-0 flex-1 leading-tight">
                <p className="text-base font-extrabold">Tomato Photobooth</p>
            </div>
            {ketNoi === 'on' && (
                <span className="flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-700">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" /> Đã kết nối
                </span>
            )}
            {ketNoi === 'lost' && (
                <span className="flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-700">
                    <WifiOff size={13} /> Đang nối lại
                </span>
            )}
        </header>
        <main className="flex flex-1 flex-col px-5 pb-[calc(env(safe-area-inset-bottom)+20px)]">{children}</main>
    </div>
);

// Các ô ảnh của lượt: đã chụp (tick) / đang tới lượt (viền đỏ) / chưa chụp.
const OAnh = ({ tong, daChup, hienTai }) => (
    <div className="flex justify-center gap-2">
        {Array.from({ length: tong }).map((_, i) => {
            const xong = i < daChup;
            const dangToi = i + 1 === hienTai;
            return (
                <div
                    key={i}
                    className={`flex h-10 w-10 items-center justify-center rounded-xl text-base font-extrabold transition-all ${
                        xong ? 'bg-[#D5B895] text-white' : dangToi ? 'bg-white text-[#c1121f] ring-2 ring-[#c1121f]' : 'bg-[#D5B895]/25 text-[#8E6B4D]'
                    }`}
                >
                    {xong ? <Check size={20} strokeWidth={3} /> : i + 1}
                </div>
            );
        })}
    </div>
);

const NutChup = ({ onChup, khoa }) => (
    <button
        type="button"
        onClick={onChup}
        disabled={khoa}
        aria-label="Chụp"
        className="group relative mx-auto flex h-52 w-52 items-center justify-center rounded-full bg-white shadow-[0_18px_40px_-12px_rgba(193,18,31,0.45)] transition-transform active:scale-95 disabled:opacity-50"
    >
        <span className="absolute inset-3 rounded-full bg-[#c1121f] transition-colors group-active:bg-[#9d0e18]" />
        <span className="relative flex flex-col items-center text-white">
            <Camera size={44} strokeWidth={2.2} />
            <span className="mt-1 text-2xl font-extrabold tracking-wide">CHỤP</span>
        </span>
    </button>
);

/**
 * @param {object} p
 * @param {'dang_vao'|'san_sang'|'cho_bam'|'dem_nguoc'|'dang_chup'|'tiep_tuc'|'het_luot'|'da_co_nguoi'|'het_han'} p.trangThai
 * @param {'on'|'lost'} [p.ketNoi]
 * @param {number} [p.daChup] số ảnh đã chụp
 * @param {number|null} [p.tuChupSau] giây nữa booth tự chụp nếu không bấm
 * @param {string} [p.loiNhan] câu hiện ở trạng thái 'tiep_tuc' (vd "Chọn ảnh trên màn hình booth")
 */
const RemoteDienThoai = ({
    trangThai = 'cho_bam', ketNoi = 'on', tongAnh = 4, daChup = 0, anhHienTai = 1, conLaiGiay = 0,
    demNguoc = 0, tuChupSau = null, daBam = false, onChup, loiNhan, moAlbum = false,
}) => {
    const matKetNoi = ketNoi === 'lost';

    if (trangThai === 'dang_vao') {
        return (
            <Khung>
                <div className="flex flex-1 flex-col items-center justify-center gap-3 text-[#8E6B4D]">
                    <Loader2 size={40} className="animate-spin text-[#D5B895]" />
                    <p className="text-lg font-bold">Đang kết nối với booth…</p>
                </div>
            </Khung>
        );
    }

    if (trangThai === 'da_co_nguoi' || trangThai === 'het_han') {
        return (
            <Khung>
                <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
                    <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[#D5B895]/30 text-[#8E6B4D]">
                        <WifiOff size={36} />
                    </div>
                    <p className="text-2xl font-extrabold">{trangThai === 'da_co_nguoi' ? 'Đã có điện thoại khác kết nối' : 'Mã đã hết hạn'}</p>
                    <p className="max-w-[18rem] text-base text-[#8E6B4D]">
                        {trangThai === 'da_co_nguoi' ? 'Mỗi lượt chỉ một điện thoại điều khiển.' : 'Quét lại mã mới trên màn hình booth.'}
                    </p>
                </div>
            </Khung>
        );
    }

    if (trangThai === 'het_luot') {
        return (
            <Khung>
                <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
                    <img src="/logo_tomato.png" alt="" className="h-24 w-24 rounded-full object-contain" />
                    <p className="text-3xl font-extrabold text-[#c1121f]">Cảm ơn bạn!</p>
                    {moAlbum ? (
                        <p className="flex items-center gap-2 text-base font-bold text-[#8E6B4D]">
                            <Loader2 size={18} className="animate-spin" /> Đang mở album ảnh của bạn…
                        </p>
                    ) : (
                        <p className="text-base text-[#8E6B4D]">Lượt chụp đã xong — quét mã trên màn hình booth để lấy ảnh.</p>
                    )}
                </div>
            </Khung>
        );
    }

    if (trangThai === 'san_sang' || trangThai === 'tiep_tuc') {
        return (
            <Khung ketNoi={ketNoi}>
                <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
                    <div className={`flex h-20 w-20 items-center justify-center rounded-full ${trangThai === 'san_sang' ? 'bg-emerald-100 text-emerald-600' : 'bg-[#D5B895]/30 text-[#8E6B4D]'}`}>
                        {trangThai === 'san_sang' ? <Check size={40} strokeWidth={3} /> : <MonitorSmartphone size={36} />}
                    </div>
                    <p className="text-2xl font-extrabold">{trangThai === 'san_sang' ? 'Đã kết nối!' : (loiNhan || 'Tiếp tục trên màn hình booth')}</p>
                    <p className="max-w-[18rem] text-base text-[#8E6B4D]">
                        {trangThai === 'san_sang' ? 'Sắp bắt đầu chụp — đứng vào vị trí nha.' : 'Khi cần chụp lại, nút chụp sẽ hiện lại ở đây.'}
                    </p>
                </div>
            </Khung>
        );
    }

    // cho_bam / dem_nguoc / dang_chup: màn điều khiển chính
    const duAnh = daChup >= tongAnh;
    return (
        <Khung ketNoi={ketNoi}>
            <div className="flex items-center justify-between pt-3">
                <p className="text-3xl font-extrabold">
                    Ảnh {Math.min(anhHienTai, tongAnh)}<span className="text-[#D5B895]"> / {tongAnh}</span>
                </p>
                <span className="flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-sm font-bold text-[#8E6B4D] shadow-sm">
                    <Clock size={15} /> {phutGiay(conLaiGiay)}
                </span>
            </div>
            <div className="mt-4"><OAnh tong={tongAnh} daChup={daChup} hienTai={anhHienTai} /></div>

            <div className="flex flex-1 flex-col items-center justify-center py-6">
                {trangThai === 'dem_nguoc' ? (
                    <div className="flex flex-col items-center gap-4">
                        <div className="flex h-52 w-52 items-center justify-center rounded-full border-4 border-[#c1121f] bg-white">
                            <span className="text-[110px] font-extrabold leading-none text-[#c1121f]">{demNguoc}</span>
                        </div>
                        <p className="text-2xl font-extrabold">Nhìn vào máy ảnh!</p>
                        <p className="-mt-2 text-sm font-semibold text-[#8E6B4D]">Booth tự chụp vì chưa thấy bấm</p>
                    </div>
                ) : trangThai === 'dang_chup' ? (
                    <div className="flex flex-col items-center gap-4">
                        <div className="flex h-52 w-52 items-center justify-center rounded-full bg-white">
                            <Loader2 size={64} className="animate-spin text-[#D5B895]" />
                        </div>
                        <p className="text-2xl font-extrabold">Đang chụp…</p>
                    </div>
                ) : (
                    <div className="flex flex-col items-center gap-5">
                        <NutChup onChup={onChup} khoa={matKetNoi || duAnh || daBam} />
                        <p className="text-base font-semibold text-[#8E6B4D]">Tạo dáng xong thì bấm — chụp ngay</p>
                        {!matKetNoi && tuChupSau != null && tuChupSau <= 10 && (
                            <p className="text-sm font-bold text-[#c1121f]">Booth tự chụp sau {tuChupSau} s nếu bạn chưa bấm</p>
                        )}
                    </div>
                )}
            </div>

        </Khung>
    );
};

export default RemoteDienThoai;
