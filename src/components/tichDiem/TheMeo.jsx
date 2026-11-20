// Thẻ tích điểm: nền là ĐÚNG mặt sau thẻ giấy của quán (xuất từ loyal_card.pdf -> public/tich-diem/the.jpg),
// ô đã tích được đóng logo mèo ôm cà chua (public/tich-diem/logo.png) đè lên. Dùng chung cho booth và trang nhân viên.
export const MAU_THE = { nen: '#FCF5D7', vien: '#A61018', o: '#FDFAF0' };

// Tâm 10 ô đầu mèo (% chiều rộng / chiều cao thẻ), đo từ vị trí ảnh trong PDF (trang 252 x 144 pt).
const TAM_O = [
    [13.91, 43.34], [31.29, 43.34], [48.59, 43.34], [65.89, 43.34], [83.18, 43.34],
    [13.87, 71.48], [31.25, 71.48], [48.55, 71.48], [65.85, 71.48], [83.14, 71.48],
];
// Nghiêng nhẹ mỗi dấu một kiểu cho giống đóng dấu tay.
const NGHIENG = [-5, 3, -2, 4, -4, 2, -4, 2, -3, 4];

/** dau: số dấu hiện có (0..10). nho: bản nhỏ cho trang nhân viên. moi: dấu vừa cộng -> hiệu ứng đóng dấu. */
const TheMeo = ({ dau = 0, nho = false, moi = false }) => (
    <div
        className={`relative w-full overflow-hidden ${nho ? 'max-w-sm rounded-xl' : 'max-w-2xl rounded-3xl'} shadow-md`}
        style={{ aspectRatio: '252 / 144', backgroundColor: MAU_THE.nen }}
    >
        <img src="/tich-diem/the.jpg" alt="Thẻ tích điểm" className="absolute inset-0 h-full w-full" draggable={false} />
        {/* Ô đã tích: tô lại phần ruột ô (che chữ Voucher của ô 5 / 7 / 10, không đè viền) rồi đóng logo lên trên. */}
        {TAM_O.slice(0, Math.max(0, Math.min(10, dau))).map(([x, y], i) => (
            <img
                key={`o${i}`}
                src="/tich-diem/o.png"
                alt=""
                draggable={false}
                className="absolute"
                style={{ left: `${x}%`, top: `${y}%`, width: '20.54%', transform: 'translate(-50%, -50%)' }}
            />
        ))}
        {TAM_O.slice(0, Math.max(0, Math.min(10, dau))).map(([x, y], i) => (
            <img
                key={i}
                src="/tich-diem/logo.png"
                alt=""
                draggable={false}
                className={`absolute ${moi && i === dau - 1 ? 'tich-diem-dong-dau' : ''}`}
                style={{
                    left: `${x}%`,
                    top: `${y}%`,
                    width: '8%',
                    transform: `translate(-50%, -38%) rotate(${NGHIENG[i]}deg)`,
                    filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.25))',
                }}
            />
        ))}
        <style>{`
            @keyframes tichDiemDongDau {
                0% { opacity: 0; scale: 2.2; }
                60% { opacity: 1; scale: 0.92; }
                100% { opacity: 1; scale: 1; }
            }
            .tich-diem-dong-dau { animation: tichDiemDongDau 0.5s ease-out 0.25s both; }
        `}</style>
    </div>
);

export default TheMeo;
