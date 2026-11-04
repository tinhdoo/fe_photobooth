// /r/:ma — khách quét QR ở màn Chuẩn bị của booth để bấm chụp từ điện thoại (xem src/remote/).
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import RemoteDienThoai from '../components/remote/RemoteDienThoai';
import { useRemoteDienThoai } from '../remote/useRemoteDienThoai';
import { maAlbumHopLe } from '../remote/kenhRemote';

const MO_ALBUM_SAU_MS = 1500; // hiện "Cảm ơn" một chút rồi mới chuyển

// Booth gửi số giây mỗi ~2,5 s -> điện thoại tự đếm lùi giữa hai lần để đồng hồ chạy đều.
function useDemLui(giay, moc) {
    const [bayGio, setBayGio] = useState(() => Date.now());
    useEffect(() => {
        if (giay == null) return undefined;
        const t = setInterval(() => setBayGio(Date.now()), 1000);
        return () => clearInterval(t);
    }, [giay, moc]);
    if (giay == null) return null;
    return Math.max(0, Math.round(giay - (bayGio - moc) / 1000));
}

const RemotePage = () => {
    const { ma } = useParams();
    const { pha, booth, ketNoi, daBam, chup } = useRemoteDienThoai(ma);
    const [moc, setMoc] = useState(() => Date.now());
    useEffect(() => { setMoc(Date.now()); }, [booth?.seq]);
    const conLai = useDemLui(booth?.conLai ?? null, moc);
    const tuChupSau = useDemLui(booth?.tuChupSau ?? null, moc);

    useEffect(() => {
        document.title = 'Bấm chụp — Tomato Photobooth';
    }, []);

    // Hết lượt -> tự mở album (replace: bấm Quay lại không về trang điều khiển nữa).
    const albumId = pha === 'vao' && booth?.buoc === 'het_luot' && maAlbumHopLe(booth?.albumId) ? booth.albumId : null;
    useEffect(() => {
        if (!albumId) return undefined;
        const t = setTimeout(() => window.location.replace(`/album/${encodeURIComponent(albumId)}`), MO_ALBUM_SAU_MS);
        return () => clearTimeout(t);
    }, [albumId]);

    let trangThai = pha;
    if (pha === 'vao') {
        const b = booth?.buoc;
        if (b === 'chuan_bi') trangThai = 'san_sang';
        else if (b === 'chup') trangThai = daBam && booth.trangThai === 'cho_bam' ? 'dang_chup' : (booth.trangThai || 'cho_bam');
        else if (b === 'het_luot') trangThai = 'het_luot';
        else trangThai = 'tiep_tuc';
    }
    const daChup = booth?.daChup || 0;
    const tongAnh = booth?.tongAnh || 4;

    return (
        <RemoteDienThoai
            trangThai={trangThai}
            ketNoi={ketNoi}
            tongAnh={tongAnh}
            daChup={daChup}
            anhHienTai={booth?.anhHienTai || Math.min(daChup + 1, tongAnh)}
            conLaiGiay={conLai ?? 0}
            demNguoc={booth?.demNguoc || 0}
            tuChupSau={tuChupSau}
            daBam={daBam}
            onChup={chup}
            loiNhan={booth?.loiNhan}
            moAlbum={!!albumId}
        />
    );
};

export default RemotePage;
