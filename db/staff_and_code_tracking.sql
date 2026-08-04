-- =====================================================================
-- Phân quyền nhân viên + truy vết mã thanh toán
-- Chạy 1 lần trong Supabase (SQL Editor). An toàn để chạy lại (idempotent).
-- =====================================================================

-- 1) Tài khoản đăng nhập trang admin (admin + nhân viên)
create table if not exists public.staff_accounts (
    id            uuid primary key default gen_random_uuid(),
    username      text not null unique,
    password_hash text not null,
    display_name  text,
    role          text not null default 'staff' check (role in ('admin', 'staff')),
    active        boolean not null default true,
    created_at    timestamptz not null default now()
);

-- 2) Bổ sung cột truy vết vào bảng mã thanh toán
--    created_by       : ai TẠO mã (admin tạo hàng loạt) — ít dùng để truy vết nhân viên
--    claimed_by       : nhân viên nào LẤY mã từ kho để đưa khách  <-- "nhân viên nào dùng mã"
--    claimed_at       : thời điểm nhân viên lấy mã
--    note             : ghi chú "mã dùng làm gì" (nhân viên tự điền, sửa được sau khi dùng)
--    used_session_id  : phiên booth đã dùng mã (auto gắn khi mã được redeem ở booth)
alter table public.payment_codes add column if not exists created_by      text;
alter table public.payment_codes add column if not exists claimed_by      text;
alter table public.payment_codes add column if not exists claimed_at      timestamptz;
alter table public.payment_codes add column if not exists note            text;
alter table public.payment_codes add column if not exists used_session_id text;

-- index cho tra cứu theo nhân viên + lấy mã nhanh từ kho (chưa dùng/chưa ai lấy)
create index if not exists payment_codes_claimed_by_idx on public.payment_codes (claimed_by);
create index if not exists payment_codes_pool_idx on public.payment_codes (value, is_used, claimed_by);
