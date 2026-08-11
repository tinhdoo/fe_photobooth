# Chuyển ảnh khách sang Cloudflare R2 (giảm Cached Egress Supabase)

Ảnh khách (folder `booth/`: ảnh ghép + ảnh gốc + video motion) sẽ upload lên **R2** thay vì Supabase.
R2 **egress miễn phí** → cắt gần hết Cached Egress Supabase. Ảnh cũ vẫn phục vụ từ Supabase tới khi
hết hạn 48h (không cần migrate). Có **fallback Supabase** nếu R2 lỗi → khách luôn có ảnh.

Chỉ ảnh MỚI vào R2 khi bật cờ `PHOTO_STORAGE=r2`. Chưa bật → giữ nguyên Supabase (an toàn).

---

## Bước 1 — Tạo bucket R2

Cloudflare → R2 → **Create bucket** → tên **`tomato-photos`** (tách riêng với bucket auto-update).
Location: **Asia-Pacific** (gần VN + gần Supabase).

## Bước 2 — Bật Public access

Bucket `tomato-photos` → **Settings → Public access → R2.dev subdomain → Allow Access**.
→ Nhận URL dạng `https://pub-xxxxxxxx.r2.dev` (gọi là `<PUBLIC_URL>`).

## Bước 3 — Cấu hình CORS (BẮT BUỘC)

Trang album dùng `fetch` + canvas (`crossOrigin`) để ghép strip/tạo video/tải xuống → **thiếu CORS
là album vỡ**. Bucket → **Settings → CORS Policy** → dán:

```json
[
  {
    "AllowedOrigins": [
      "https://tomatophotobooth.vercel.app",
      "http://localhost:5173"
    ],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["Content-Length", "Content-Type"],
    "MaxAgeSeconds": 3600
  }
]
```
(Đổi domain Vercel cho đúng nếu khác. Upload đi qua serverless — không cần CORS cho PUT.)

## Bước 4 — Tạo API Token

R2 → **Manage R2 API Tokens → Create** → quyền **Object Read & Write**, phạm vi bucket `tomato-photos`.
→ Nhận **Access Key ID** + **Secret Access Key**. **Account ID** ở trang tổng quan R2.

## Bước 5 — Đặt biến môi trường trên Vercel

Project → **Settings → Environment Variables**, thêm:

| Tên | Giá trị |
|---|---|
| `R2_ACCOUNT_ID` | Account ID |
| `R2_ACCESS_KEY_ID` | Access Key ID |
| `R2_SECRET_ACCESS_KEY` | Secret Access Key |
| `R2_PHOTOS_BUCKET` | `tomato-photos` |
| `R2_PHOTOS_PUBLIC_URL` | `<PUBLIC_URL>` (vd `https://pub-xxxx.r2.dev`) |
| `PHOTO_STORAGE` | **để trống lúc đầu**, đặt `r2` khi đã test xong |

## Bước 6 — Deploy & bật dần

1. Deploy (git push). Lúc này `PHOTO_STORAGE` chưa `r2` → **vẫn dùng Supabase** (không đổi gì).
2. Kiểm tra cấu hình: mở `GET https://<domain>/api/upload-cloud` → field `photos_storage` cho biết đang `supabase` hay `r2`.
3. Đặt `PHOTO_STORAGE=r2` → **redeploy** → ảnh mới vào R2.
4. **Test 1 phiên thật:** chụp → lấy QR → mở album → xem + bấm "Tải tất cả". Kiểm tra ảnh hiện & tải được.
   - URL ảnh trong album phải bắt đầu bằng `<PUBLIC_URL>/booth/...`.

## Rollback (nếu có sự cố)

Đặt lại `PHOTO_STORAGE=supabase` (hoặc xoá biến) → redeploy → quay về Supabase ngay.
Ngoài ra code đã có **fallback tự động**: nếu R2 upload lỗi → ghi Supabase (khách vẫn có ảnh).

---

## Ghi chú kỹ thuật

- **Không cần migrate ảnh cũ:** ảnh cũ (URL Supabase trong DB) vẫn chạy tới khi hết hạn 48h rồi cron xoá.
- **Cleanup:** cron `sessions?action=cleanup` xoá ảnh hết hạn trên **cả** Supabase (ảnh cũ) lẫn R2 (ảnh mới),
  phân biệt qua `public_id` (`r2:...` = R2).
- **Riêng tư (phương án A):** public + đường dẫn ngẫu nhiên + xoá sau 48h. Ai có link vẫn xem tới khi bị xoá
  (giống mức hiện tại). Muốn kín hơn (URL tự hết hạn) thì chuyển sang presigned — nói team.
- **Dọn rác R2:** hiện xoá theo từng session hết hạn. Nếu cần quét file mồ côi trên R2 (hiếm), bổ sung sau.
