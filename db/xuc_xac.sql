-- =====================================================================
-- Xúc xắc ưu đãi (trang /admin/xuc-xac): mỗi lượt lắc của nhân viên một dòng.
-- Chạy 1 lần trong Supabase (SQL Editor). An toàn để chạy lại.
-- Kết quả do API (service role) quyết và ghi; trình duyệt không đọc/ghi thẳng bảng này.
-- =====================================================================
create table if not exists public.dice_rolls (
    id             uuid primary key default gen_random_uuid(),
    face           smallint not null check (face between 1 and 6),
    uu_dai         text,
    staff_username text not null,
    staff_name     text,
    created_at     timestamptz not null default now()
);

create index if not exists dice_rolls_created_at_idx on public.dice_rolls (created_at desc);
create index if not exists dice_rolls_staff_idx on public.dice_rolls (staff_username, created_at desc);

-- Không policy nào: chỉ service role (Vercel API) đọc/ghi.
alter table public.dice_rolls enable row level security;
