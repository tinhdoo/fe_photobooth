-- =====================================================================
-- Tích điểm theo số điện thoại (thay thẻ mèo giấy). Chạy 1 lần trong Supabase SQL Editor; chạy lại an toàn.
-- Luật: mỗi lượt đã trả tiền = 1 dấu (tối đa 10). Đổi ở mốc 5 / 7 / 10 dấu = voucher 50K / 70K / 100K,
-- đổi xong thẻ về 0. Lượt trả bằng voucher tích điểm không được cộng dấu. 6 tháng không có dấu mới thì thẻ về 0.
-- API (service role) đọc/ghi; bật RLS không policy -> anon key trong bundle không đọc được SĐT khách.
-- =====================================================================

create table if not exists public.loyalty_cards (
    phone         text primary key,              -- 10 số, dạng 0xxxxxxxxx
    stamps        integer not null default 0 check (stamps between 0 and 10),
    pin_hash      text,                          -- PIN 4 số của khách (pbkdf2); null = chưa đặt
    consent_at    timestamptz,                   -- lúc khách đồng ý lưu SĐT (Nghị định 13/2023)
    last_stamp_at timestamptz,                   -- lần cuối được cộng dấu (tính hạn 6 tháng)
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
);
alter table public.loyalty_cards enable row level security;

-- Nhật ký mọi thay đổi dấu (để tra soát khi khách khiếu nại).
-- kind: 'cong' (lượt chụp) | 'doi' (dùng voucher) | 'het_han' | 'nv_sua' (nhân viên nhập từ thẻ giấy) | 'nv_pin' (nhân viên xoá PIN)
create table if not exists public.loyalty_log (
    id           bigint generated always as identity primary key,
    phone        text not null,
    kind         text not null,
    stamps_truoc integer,
    stamps_sau   integer,
    session_uuid text,                           -- lượt chụp được cộng dấu (kind='cong')
    code_id      text,                           -- mã voucher đã dùng (kind='doi')
    value        integer,                        -- mệnh giá voucher (kind='doi')
    actor        text,                           -- nhân viên (kind='nv_*')
    note         text,
    created_at   timestamptz not null default now()
);
alter table public.loyalty_log enable row level security;
create index if not exists loyalty_log_phone_idx on public.loyalty_log (phone, created_at desc);
-- Mỗi lượt chụp chỉ được cộng dấu MỘT lần (chặn gửi trùng / gửi lại).
create unique index if not exists loyalty_log_cong_session_uq on public.loyalty_log (session_uuid) where kind = 'cong';

-- Mã voucher sinh ra khi khách đổi dấu: là một mã thanh toán bình thường (booth trừ tiền như nhập mã),
-- đánh dấu thuộc SĐT nào + đổi ở mốc mấy dấu. Dấu chỉ bị trừ khi mã được DÙNG (khách bỏ ngang thì không mất dấu).
alter table public.payment_codes add column if not exists loyalty_phone text;
alter table public.payment_codes add column if not exists loyalty_stamps integer;
create index if not exists payment_codes_loyalty_idx on public.payment_codes (loyalty_phone) where loyalty_phone is not null;
