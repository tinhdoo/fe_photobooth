# Face Filter — hệ thống filter khuôn mặt (JSON-driven)

Nhận diện khuôn mặt bằng **MediaPipe Face Landmarker**, đặt sticker theo vị trí mắt/mũi/
miệng/cằm/trán/đỉnh đầu, **tự scale theo kích thước mặt** và **xoay theo góc nghiêng đầu**,
hỗ trợ **nhiều khuôn mặt** trong một ảnh và ảnh **độ phân giải cao**.

## Thêm filter mới (KHÔNG cần sửa code, KHÔNG cần build lại)

1. Thả file ảnh sticker vào thư mục `assets/` (hỗ trợ `.svg` hoặc `.png` nền trong suốt).
2. Thêm một mục vào `filters.json`.

```json
{
  "id": "cat",
  "name": "Mèo",
  "thumbnail": "cat_ears.svg",
  "assets": [
    { "image": "cat_ears.svg", "anchor": "head_top", "scale": 1.35, "offset": { "x": 0, "y": 0.12 } },
    { "image": "cat_nose.svg", "anchor": "nose",     "scale": 0.2 }
  ]
}
```

Các asset được vẽ **theo thứ tự khai báo** (mục đầu nằm dưới cùng) — đặt cánh/đuôi trước, tai/mũi sau.

### Thuộc tính mỗi asset

| Trường   | Ý nghĩa | Mặc định |
|----------|---------|----------|
| `image`  | tên file trong `assets/` (hoặc URL `http`) | (bắt buộc) |
| `anchor` | điểm neo trên mặt (xem bảng dưới) | `face_center` |
| `scale`  | bề rộng sticker = `scale` × (bề ngang mặt hoặc khoảng cách 2 mắt) | theo anchor |
| `basis`  | mốc scale: `"faceWidth"` hoặc `"interocular"` | `faceWidth` |
| `offset` | dịch theo khung mặt: `{x,y}` (đơn vị = tỉ lệ kích thước mặt; `+x` sang phải, `+y` xuống) | `{0,0}` |
| `rotate` | xoay theo góc nghiêng đầu | `true` |
| `flipX`  | lật ngang ảnh | `false` |
| `opacity`| độ mờ 0–1 | `1` |

### Các anchor hỗ trợ

`left_eye`, `right_eye`, `eyes_center`, `nose`, `mouth`, `chin`, `forehead`,
`head_top` (trên đỉnh đầu — đặt tai/vương miện/sừng/halo), `face_center` (giữa mặt — má hồng/cánh).

> Vị trí trái/phải mắt được gán theo trục X của ảnh nên luôn đúng kể cả khi đầu nghiêng/ảnh lật.

## Mẹo căn chỉnh

- Sticker được vẽ **căn giữa** vào điểm anchor. Thiết kế ảnh sao cho tâm hình ≈ vị trí cần đặt.
- Đặt sai trên/dưới → chỉnh `offset.y`; quá to/nhỏ → chỉnh `scale`.
- Kính nên dùng `"basis": "interocular"` để bám khoảng cách 2 mắt.

## Chạy OFFLINE (không phụ thuộc CDN)

Mặc định model + wasm tải từ jsDelivr / Google CDN. Để chạy ngoại tuyến trên máy booth:

1. Tải `face_landmarker.task` đặt vào `mediapipe/face_landmarker.task`.
2. Copy thư mục `wasm` của gói `@mediapipe/tasks-vision` vào `mediapipe/wasm/`.

Hệ thống tự phát hiện file nội bộ (`/face-filters/mediapipe/...`) và ưu tiên dùng thay CDN.

## Thử nhanh

Mở route **`/face-filter`** trên app → chọn một ảnh có khuôn mặt → chọn filter → Xác nhận.
Trong luồng booth: bước **Chọn ảnh (Review)**, mỗi ảnh đã chụp có nút ✨ để thêm filter.
