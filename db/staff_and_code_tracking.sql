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
--    created_by       : nhân viên nào đã tạo/lấy mã (accountability)
--    note             : ghi chú "mã dùng làm gì" (nhân viên tự điền, sửa được sau khi dùng)
--    used_session_id  : phiên booth đã dùng mã (auto gắn khi mã được redeem ở booth)
alter table public.payment_codes add column if not exists created_by      text;
alter table public.payment_codes add column if not exists note            text;
alter table public.payment_codes add column if not exists used_session_id text;

-- (tuỳ chọn) index cho tra cứu theo nhân viên
create index if not exists payment_codes_created_by_idx on public.payment_codes (created_by);
