// Thẻ tích điểm hình mèo (vẽ lại đúng thẻ giấy của quán): 10 đầu mèo, ô 5 / 7 / 10 ghi voucher 50K / 70K / 100K.
// Ô đã có dấu tô đỏ + dấu chân mèo. Dùng chung cho booth (màn Kết quả, Thanh toán) và trang nhân viên.
export const MAU_THE = { nen: '#FAF4D6', vien: '#B32025', o: '#FBF8EC' };
const NHAN = { 5: '50K', 7: '70K', 10: '100K' };
const DAU_MEO = 'M14 44 C9 28 11 10 21 5 C28 2 34 14 39 21 C46 19 54 19 61 21 C66 14 72 2 79 5 C89 10 91 28 86 44 C93 60 90 79 74 86 C62 92 38 92 26 86 C10 79 7 60 14 44 Z';

const DauChan = () => (
    <g fill="#fff">
        <ellipse cx="50" cy="62" rx="13" ry="10" />
        <circle cx="34" cy="47" r="5.5" />
        <circle cx="44" cy="40" r="5.5" />
        <circle cx="56" cy="40" r="5.5" />
        <circle cx="66" cy="47" r="5.5" />
    </g>
);

const OMeo = ({ so, coDau, noiBat }) => (
    <svg viewBox="0 0 100 95" className="h-auto w-full" aria-label={coDau ? `Ô ${so} đã có dấu` : `Ô ${so}`}>
        <path
            d={DAU_MEO}
            fill={coDau ? MAU_THE.vien : MAU_THE.o}
            stroke={MAU_THE.vien}
            strokeWidth={noiBat ? 4.5 : 3}
        />
        {coDau && <DauChan />}
        {!coDau && NHAN[so] && (
            <text x="50" y="62" textAnchor="middle" fontSize="15" fontWeight="900" fill={MAU_THE.vien} fontFamily="inherit">
                <tspan x="50" dy="-8">Voucher</tspan>
                <tspan x="50" dy="17">{NHAN[so]}</tspan>
            </text>
        )}
        {coDau && NHAN[so] && (
            <text x="50" y="86" textAnchor="middle" fontSize="11" fontWeight="900" fill="#fff" fontFamily="inherit">{NHAN[so]}</text>
        )}
    </svg>
);

/** dau: số dấu hiện có (0..10). nho: bản nhỏ cho trang nhân viên. */
const TheMeo = ({ dau = 0, nho = false }) => (
    <div
        className={`w-full rounded-3xl ${nho ? 'max-w-sm p-3' : 'max-w-xl p-5'} shadow-inner`}
        style={{ backgroundColor: MAU_THE.nen }}
    >
        <div className={`grid grid-cols-5 ${nho ? 'gap-1.5' : 'gap-3'}`}>
            {Array.from({ length: 10 }, (_, i) => (
                <OMeo key={i} so={i + 1} coDau={i < dau} noiBat={i === dau - 1} />
            ))}
        </div>
        {!nho && (
            <p className="mt-3 text-center text-xs font-bold" style={{ color: MAU_THE.vien }}>
                *Voucher không quy đổi thành tiền mặt hay vật phẩm có giá trị tương đương khác
            </p>
        )}
    </div>
);

export default TheMeo;
