// Giao diện phía máy booth cho điều khiển bằng điện thoại (logic ở src/remote/remoteBooth.js).
//   ManKetNoi: màn Chuẩn bị có mã QR để khách quét (GetReady dùng khi máy bật remote_dt).
//   NhanRemote: các nhãn đè lên khung live view ở màn Chụp. Đặt ở MÉP TRÊN và ĐÁY khung, không che mặt khách.
import { QRCodeSVG } from 'qrcode.react';
import { Smartphone, Check, WifiOff } from 'lucide-react';

export const ManKetNoi = ({ qrUrl, trangThai = 'cho', conLaiGiay = 15, onBatDau, nenUrl }) => {
    const daNoi = trangThai === 'da_noi';
    return (
        <div
            className="relative flex h-full w-full items-center justify-center bg-[#FFF8E7] bg-cover bg-center p-10 font-serif text-[#3F3127]"
            style={nenUrl ? { backgroundImage: `url('${nenUrl}')` } : undefined}
        >
            <div className="flex w-full max-w-6xl items-center gap-14">
                <div className="flex-1">
                    <h1 className="text-5xl font-extrabold leading-tight text-[#c1121f] drop-shadow-sm">Chuẩn bị tạo dáng nha!</h1>
                    <p className="mt-5 text-3xl font-bold leading-snug">
                        Muốn tự bấm chụp?<br />
                        <span className="text-[#8E6B4D]">Quét mã bằng điện thoại để điều khiển máy ảnh.</span>
                    </p>
                    <div className="mt-10 flex items-center gap-5">
                        <button
                            type="button"
                            onClick={onBatDau}
                            className="rounded-[2rem] bg-[#D5B895] px-14 py-5 text-2xl font-bold uppercase tracking-widest text-white shadow-xl transition-transform active:scale-95"
                        >
                            Bắt đầu chụp
                        </button>
                        <span className="text-xl text-[#8E6B4D]">{daNoi ? 'Sắp bắt đầu…' : `Tự bắt đầu sau ${conLaiGiay} s`}</span>
                    </div>
                </div>

                <div className="flex w-[360px] shrink-0 flex-col items-center rounded-[2rem] bg-white p-8 shadow-2xl">
                    <div className="relative">
                        <div className={`rounded-2xl p-3 transition-opacity ${daNoi ? 'opacity-20' : ''}`}>
                            <QRCodeSVG value={qrUrl || 'https://tomatophotobooth.vercel.app/r/xxxx'} size={260} level="M" fgColor="#3F3127" />
                        </div>
                        {daNoi && (
                            <div className="absolute inset-0 flex items-center justify-center">
                                <div className="flex h-24 w-24 items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg">
                                    <Check size={56} strokeWidth={3} />
                                </div>
                            </div>
                        )}
                    </div>
                    <div className={`mt-5 flex items-center gap-2.5 text-xl font-bold ${daNoi ? 'text-emerald-600' : 'text-[#8E6B4D]'}`}>
                        {daNoi ? (
                            <><Smartphone size={24} /> Đã kết nối điện thoại</>
                        ) : (
                            <><span className="h-3 w-3 animate-pulse rounded-full bg-[#D5B895]" /> Đang chờ quét…</>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

/**
 * Nhãn trên khung live view ở màn Chụp.
 * @param {'cho_bam'|'dem_nguoc'|'mat_ket_noi'} trangThai
 */
export const NhanRemote = ({ trangThai = 'cho_bam', tuChupSau = null }) => (
    <>
        {/* Góc trên: đang điều khiển bằng điện thoại / mất kết nối */}
        <div className="pointer-events-none absolute left-6 top-6 z-40">
            {trangThai === 'mat_ket_noi' ? (
                <span className="flex items-center gap-2 rounded-full bg-amber-500/90 px-5 py-2.5 text-lg font-bold text-white shadow-lg backdrop-blur-sm">
                    <WifiOff size={20} /> Mất kết nối điện thoại{tuChupSau != null ? ` · tự chụp sau ${tuChupSau} s` : ''}
                </span>
            ) : (
                <span className="flex items-center gap-2 rounded-full bg-black/45 px-5 py-2.5 text-lg font-bold text-white backdrop-blur-sm">
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" /> <Smartphone size={20} /> Điều khiển bằng điện thoại
                </span>
            )}
        </div>
        {/* Đáy khung, trên dãy ô ảnh: lời nhắc bấm chụp (ẩn khi đang đếm ngược) */}
        {trangThai === 'cho_bam' && (
            <div className="pointer-events-none absolute inset-x-0 bottom-[7.5rem] z-40 flex justify-center md:bottom-[8.5rem]">
                <div className="flex flex-col items-center rounded-3xl bg-black/50 px-8 py-3 text-white backdrop-blur-sm">
                    <span className="text-3xl font-extrabold tracking-wide">Bấm CHỤP trên điện thoại</span>
                    <span className="text-lg text-white/75">
                        hoặc chạm vào màn hình{tuChupSau != null && tuChupSau <= 10 ? ` · tự chụp sau ${tuChupSau} s` : ''}
                    </span>
                </div>
            </div>
        )}
    </>
);
