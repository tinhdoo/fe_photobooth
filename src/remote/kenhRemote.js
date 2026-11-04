// Điều khiển máy ảnh booth bằng điện thoại — phần dùng chung booth <-> điện thoại.
// Đi qua Supabase Realtime BROADCAST (không ghi DB, không thêm function Vercel). Mỗi lượt khách một mã ngẫu nhiên
// (128 bit) làm tên kênh; chỉ ai quét QR trên màn booth mới biết. Mỗi lượt chỉ MỘT điện thoại: booth nhận điện
// thoại chào đầu tiên làm "chủ", các máy khác thấy "đã có điện thoại khác".
//
// Điện thoại -> booth: sự kiện SK_DT { loai: 'chao' | 'ping' | 'chup', id }
// Booth -> điện thoại: sự kiện SK_BOOTH { chu, buoc, trangThai, tongAnh, daChup, conLai, demNguoc, tuChupSau,
//                                         loiNhan, albumId, seq }
//   Điện thoại chỉ là nút bấm: KHÔNG gửi ảnh hay tên phòng — chỉ trạng thái để nút hiện đúng lúc. Hết lượt booth gửi
//   MÃ album (không phải link); điện thoại tự mở /album/<mã> trên chính trang của nó -> ai chen vào kênh cũng không
//   đẩy được điện thoại khách sang trang lạ.
//   buoc: 'chuan_bi' | 'chup' | 'tiep_tuc' | 'het_luot'
//   trangThai (buoc 'chup'): 'cho_bam' | 'dem_nguoc' | 'dang_chup'

export const SK_DT = 'dt';
export const SK_BOOTH = 'booth';
export const NHIP_MS = 2500;          // booth gửi trạng thái / điện thoại ping mỗi nhịp
export const MAT_SAU_MS = 8000;       // quá lâu không nghe bên kia -> coi là mất kết nối
export const tenKenh = (ma) => `remote-${ma}`;

/** Mã lượt ngẫu nhiên 22 ký tự (base64url, 128 bit). */
export function taoMa() {
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    let s = '';
    b.forEach((x) => { s += String.fromCharCode(x); });
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const maAlbumHopLe = (ma) => typeof ma === 'string' && /^[A-Za-z0-9_-]{6,80}$/.test(ma);
export const maHopLe = (ma) => typeof ma === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(ma);
