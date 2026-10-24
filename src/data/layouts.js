
// Ô ảnh thẻ tính bằng mm trên tờ 4x6 inch (101,6 x 152,4 mm) -> % như mọi `boxes` khác (x/width theo bề
// ngang tờ, y/height theo bề dọc). Lưới căn giữa ngang, cách mép trên 4 mm; phần trống phía dưới để khung
// (PNG phủ admin tải lên) đặt chữ / logo.
const TO_RONG_MM = 101.6;
const TO_CAO_MM = 152.4;
function luoiAnhThe(oRong, oCao, cot, hang, tren = 4, khe = 3) {
  const trai = (TO_RONG_MM - (cot * oRong + (cot - 1) * khe)) / 2;
  const out = [];
  for (let h = 0; h < hang; h++) {
    for (let c = 0; c < cot; c++) {
      out.push({
        x: +(((trai + c * (oRong + khe)) / TO_RONG_MM) * 100).toFixed(4),
        y: +(((tren + h * (oCao + khe)) / TO_CAO_MM) * 100).toFixed(4),
        width: +((oRong / TO_RONG_MM) * 100).toFixed(4),
        height: +((oCao / TO_CAO_MM) * 100).toFixed(4),
        rotation: 0,
        photoIndex: 0,
      });
    }
  }
  return out;
}

export const LAYOUTS = [
  {
    // Lưới 3x3 = 9 ô (kiểu "PHOTO TIME"). In trên tờ 4x6 dọc; ghép/preview/chụp đều tổng quát
    // theo cols/rows/photoCount nên không cần code riêng. Frame (tiêu đề, viền) thêm sau ở FrameManager.
    // Đặt ĐẦU danh sách để hiện đầu tiên ở bước chọn layout.
    id: 'grid_9',
    name: '9 cuts',
    type: 'grid',
    printMode: 'grid_4x6',
    photoCount: 9,
    cols: 3,
    rows: 3,
    icon: 'grid_9.png',
    fullColorIcon: true, // icon nền màu (không phải line-art) -> KHÔNG áp mix-blend-multiply
  },
  {
    id: 'strip_4',
    name: '4 cuts',
    description: '70.000 VND',
    type: 'strip',
    printMode: 'double_strip',
    photoCount: 4,
    cols: 1,
    rows: 4,
    icon: '1.png',
  },
  {
    id: 'strip_3',
    name: '3 cuts',
    description: '70.000 VND',
    type: 'strip',
    printMode: 'double_strip',
    photoCount: 3,
    cols: 1,
    rows: 3,
    icon: '2.png',
  },
  {
    id: 'grid_6',
    name: '6 cuts',
    description: '70.000 VND',
    type: 'grid',
    printMode: 'grid_4x6',
    photoCount: 6,
    cols: 2,
    rows: 3,
    icon: '3.png',
  },
  {
    id: 'grid_2',
    name: '2 cuts',
    description: '70.000 VND',
    type: 'grid',
    printMode: 'grid_4x6',
    photoCount: 2,
    cols: 1,
    rows: 2,
    icon: '4.png',
  },
  {
    id: 'horizontal_4',
    name: '4 cuts',
    description: '70.000 VND',
    type: 'grid_horizontal',
    printMode: 'grid_4x6',
    photoCount: 4,
    cols: 2,
    rows: 2,
    icon: '5.png',
  },
  {
    id: 'grid_4_vertical',
    name: '4 cuts',
    description: '70.000 VND',
    type: 'grid',
    printMode: 'grid_4x6',
    photoCount: 4,
    cols: 2,
    rows: 2,
    icon: 'layout_6.png',
  },
  {
    // 1 strip NGANG 3 ảnh, in 2 BẢN GIỐNG HỆT chồng trên 1 tờ 4x6 nằm ngang, cắt ngang
    // bằng dao 2-inch -> ra 2 strip ngang y hệt nhau (như double_strip dọc nhưng nằm ngang).
    id: 'strip_h_2x3',
    name: '3 cuts',
    description: '70.000 VND',
    type: 'strip_horizontal',
    printMode: 'double_strip_horizontal',
    photoCount: 3,
    cols: 3,
    rows: 1,
    icon: '9.png',
  },
  {
    id: 'mobile_double_horizontal',
    name: '2 cuts',
    description: '70.000 VNĐ',
    type: 'grid',
    printMode: 'grid_4x6',
    photoCount: 2,
    cols: 1,
    rows: 2,
    icon: '6.png',
    isMobileOnly: true,
  },
  {
    id: 'mobile_double_vertical',
    name: '2 cuts',
    description: '70.000 VNĐ',
    type: 'grid_horizontal',
    printMode: 'grid_4x6',
    photoCount: 2,
    cols: 2,
    rows: 1,
    icon: '7.png',
    isMobileOnly: true,
  },
  {
    id: 'mobile_single',
    name: '1 cuts',
    description: '70.000 VNĐ',
    type: 'grid_horizontal',
    printMode: 'grid_4x6',
    photoCount: 1,
    cols: 1,
    rows: 1,
    icon: '8.png',
    isMobileOnly: true,
  },
  {
    // ẢNH THẺ — luồng RIÊNG, không hiện ở màn chọn bố cục (LayoutSelection lọc bỏ idPhoto).
    // Khách vào bằng cách chọn "Chụp ảnh thẻ" ở màn Welcome.
    // Tờ 4x6 inch (101,6 x 152,4 mm) xếp: 1 ảnh 4x6 cm + 4 ảnh 3x4 cm + 4 ảnh 2x3 cm.
    // Toạ độ tính bằng script, đã kiểm: rộng dùng 97,0/101,6 mm, cao 139,0/152,4 mm, không ô nào đè nhau.
    id: 'id_photo_mixed',
    name: 'Ảnh thẻ',
    sheetLabel: 'Hỗn hợp · 9 ảnh',
    description: 'Ảnh hồ sơ',
    type: 'grid',
    printMode: 'id_photo_4x6',
    idPhoto: true,
    photoCount: 1,        // Studio chỉ cần MỘT ảnh; 9 ô do mảng boxes lo
    captureCount: 4,      // chụp 4 tấm cho khách chọn — ảnh thẻ dễ hỏng vì nhắm mắt/lệch đầu
    cols: 1,
    rows: 1,
    icon: '8.png',
    boxes: [
      { x: 2.9528, y: 1.9685, width: 39.3701, height: 39.3701, rotation: 0, photoIndex: 0 },
      { x: 44.2913, y: 1.9685, width: 29.5276, height: 26.2467, rotation: 0, photoIndex: 0 },
      { x: 75.7874, y: 1.9685, width: 19.685, height: 19.685, rotation: 0, photoIndex: 0 },
      { x: 75.7874, y: 22.9659, width: 19.685, height: 19.685, rotation: 0, photoIndex: 0 },
      { x: 2.9528, y: 43.9633, width: 29.5276, height: 26.2467, rotation: 0, photoIndex: 0 },
      { x: 34.4488, y: 43.9633, width: 29.5276, height: 26.2467, rotation: 0, photoIndex: 0 },
      { x: 65.9449, y: 43.9633, width: 29.5276, height: 26.2467, rotation: 0, photoIndex: 0 },
      { x: 2.9528, y: 71.5223, width: 19.685, height: 19.685, rotation: 0, photoIndex: 0 },
      { x: 24.6063, y: 71.5223, width: 19.685, height: 19.685, rotation: 0, photoIndex: 0 },
    ],
  },
  // Các KIỂU TỜ ảnh thẻ khác. Khách chọn ở trang "Ảnh thẻ của bạn" qua khung admin tải lên (FrameManager, tab Ảnh
  // thẻ): mỗi khung thuộc một kiểu tờ, ô ảnh lấy từ `boxes` ở đây chứ không vẽ tay -> luôn đúng cỡ cm.
  // Giá + doanh thu vẫn tính theo id_photo_mixed (sessionData.layout không đổi khi khách đổi kiểu tờ).
  {
    id: 'id_photo_3x4',
    name: 'Ảnh thẻ 3x4',
    sheetLabel: '3x4 · 9 ảnh',
    type: 'grid',
    printMode: 'id_photo_4x6',
    idPhoto: true,
    photoCount: 1,
    captureCount: 4,
    cols: 1,
    rows: 1,
    icon: '8.png',
    boxes: luoiAnhThe(30, 40, 3, 3, 4, 2.5), // khe 2,5 mm để lề trái/phải >= 3 mm như tờ hỗn hợp
  },
  {
    id: 'id_photo_4x6',
    name: 'Ảnh thẻ 4x6',
    sheetLabel: '4x6 · 4 ảnh',
    type: 'grid',
    printMode: 'id_photo_4x6',
    idPhoto: true,
    photoCount: 1,
    captureCount: 4,
    cols: 1,
    rows: 1,
    icon: '8.png',
    boxes: luoiAnhThe(40, 60, 2, 2),
  },
  {
    id: 'id_photo_2x3',
    name: 'Ảnh thẻ 2x3',
    sheetLabel: '2x3 · 16 ảnh',
    type: 'grid',
    printMode: 'id_photo_4x6',
    idPhoto: true,
    photoCount: 1,
    captureCount: 4,
    cols: 1,
    rows: 1,
    icon: '8.png',
    boxes: luoiAnhThe(20, 30, 4, 4),
  },
  {
    id: 'contact_16_8',
    name: 'Mini-special',
    description: '50.000 VNĐ',
    type: 'mixed',
    printMode: 'grid_4x6',
    photoCount: 8,
    autoFill: true,
    cols: 4,
    rows: 4,
    icon: '24cut.png',
  }
];
