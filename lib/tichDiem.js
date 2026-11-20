// Tích điểm theo SỐ ĐIỆN THOẠI (thay thẻ mèo giấy). Bảng: db/tich_diem.sql. Gọi qua api/codes.js (action td-*),
// không thêm function Vercel.
//
// Luật (chốt với chủ quán 20/11/2026):
//  - Mỗi lượt chụp ĐÃ TRẢ TIỀN = 1 dấu, tối đa 10.
//  - Khách TỰ CHỌN đổi ở mốc 5 / 7 / 10 dấu = voucher 50K / 70K / 100K; đổi xong thẻ về 0 (dấu dư cũng mất).
//  - Lượt trả bằng voucher tích điểm KHÔNG được cộng dấu.
//  - 6 tháng không có dấu mới -> thẻ về 0.
//  - Đổi voucher phải nhập PIN 4 số khách tự đặt. Cộng dấu không cần PIN (cộng nhầm số người khác thì họ chỉ được lợi).
//
// Chống gian lận cộng dấu: booth không đăng nhập, nên server chỉ cộng cho lượt CÓ THẬT trên cloud (photo_sessions),
// đã trả tiền, mới tạo trong vài giờ, chưa từng được cộng (index unique), và mỗi SĐT tối đa vài dấu một ngày.
import { randomInt } from 'node:crypto';
import { hashPassword, verifyPassword } from './auth.js';
import { clientIp, lockedSeconds, recordFailure } from './rateLimit.js';

export const MUC_DOI = [
    { dau: 5, giaTri: 50000 },
    { dau: 7, giaTri: 70000 },
    { dau: 10, giaTri: 100000 },
];
export const DAU_TOI_DA = 10;
const HET_HAN_MS = 183 * 24 * 60 * 60 * 1000; // ~6 tháng
const LUOT_CU_NHAT_MS = 6 * 60 * 60 * 1000;   // chỉ cộng cho lượt chụp tạo trong 6 giờ gần đây
const DAU_MOI_NGAY = 3;                        // mỗi SĐT tối đa 3 dấu / 24 giờ
const MA_VOUCHER_SONG_MS = 30 * 60 * 1000;     // mã voucher sinh lúc đổi: hết hạn sau 30 phút nếu không dùng
const PIN_SAI_TOI_DA = 5;                      // sai PIN 5 lần / 15 phút -> khoá SĐT đó
const IP_SAI_TOI_DA = 20;
const CUA_SO_SAI_MS = 15 * 60 * 1000;
const NGUOI_TAO_MA = 'tich_diem';              // created_by + claimed_by của mã voucher (claimed -> không lọt vào kho mã nhân viên)

const loi = (status, message, extra = {}) => ({ status, body: { success: false, message, ...extra } });
const ok = (body) => ({ status: 200, body: { success: true, ...body } });

// "0905 123 456", "+84905123456", "84905123456" -> "0905123456". Sai định dạng -> null.
export function chuanHoaSdt(raw) {
    let s = String(raw || '').replace(/[^\d+]/g, '');
    if (s.startsWith('+84')) s = `0${s.slice(3)}`;
    else if (s.startsWith('84') && s.length === 11) s = `0${s.slice(2)}`;
    return /^0[35789]\d{8}$/.test(s) ? s : null;
}

export const anSdt = (sdt) => (sdt ? `${sdt.slice(0, 4)}***${sdt.slice(-3)}` : '');
const pinHopLe = (pin) => /^\d{4}$/.test(String(pin || ''));

const isMissingTable = (error) => /Could not find the table|schema cache|does not exist|42P01|column .* does not exist|42703/i
    .test(`${error?.message || ''} ${error?.code || ''}`);
const chuaCaiBang = () => loi(503, 'Chưa bật tích điểm trên cloud (chưa chạy db/tich_diem.sql).', { chua_cai: true });

async function docThe(supabase, sdt) {
    const { data, error } = await supabase.from('loyalty_cards').select('*').eq('phone', sdt).maybeSingle();
    if (error) throw error;
    return data || null;
}

async function ghiNhatKy(supabase, dong) {
    const { error } = await supabase.from('loyalty_log').insert(dong);
    if (error) throw error;
}

// Đặt số dấu có điều kiện (compare-and-swap theo updated_at): hai booth cùng ghi một thẻ thì một bên thử lại.
async function datDau(supabase, the, thayDoi) {
    const { data, error } = await supabase
        .from('loyalty_cards')
        .update({ ...thayDoi, updated_at: new Date().toISOString() })
        .eq('phone', the.phone)
        .eq('updated_at', the.updated_at)
        .select()
        .maybeSingle();
    if (error) throw error;
    return data || null;
}

// Thẻ quá 6 tháng không có dấu mới -> về 0 (ghi nhật ký). Trả thẻ sau khi xét hạn.
async function xetHetHan(supabase, the) {
    if (!the || !the.stamps) return the;
    const moc = Date.parse(the.last_stamp_at || the.updated_at || the.created_at);
    if (!(moc > 0) || Date.now() - moc < HET_HAN_MS) return the;
    const moi = await datDau(supabase, the, { stamps: 0 });
    if (!moi) return docThe(supabase, the.phone); // bên khác vừa ghi -> đọc lại
    await ghiNhatKy(supabase, { phone: the.phone, kind: 'het_han', stamps_truoc: the.stamps, stamps_sau: 0 });
    return moi;
}

const cacMucDuocDoi = (dau) => MUC_DOI.filter((m) => dau >= m.dau);
const theCongKhai = (the) => ({
    dau: the?.stamps || 0,
    co_pin: !!the?.pin_hash,
    muc_doi: cacMucDuocDoi(the?.stamps || 0),
});

// ---------------------------------------------------------------- CỘNG DẤU (booth, màn Kết quả)
// body: { phone, session_id, pin_moi? }  (bỏ ô đồng ý theo yêu cầu chủ quán 20/11; consent_at chỉ ghi khi booth gửi dong_y)
// SĐT mới (hoặc thẻ chưa có PIN) -> trả { can_pin: true } để booth hỏi PIN + đồng ý rồi gửi lại.
export async function congDau(supabase, body) {
    const sdt = chuanHoaSdt(body?.phone);
    if (!sdt) return loi(400, 'Số điện thoại không hợp lệ.');
    const maLuot = String(body?.session_id || '').trim();
    if (!maLuot) return loi(400, 'Thiếu mã lượt chụp.');

    try {
        // 1) Lượt chụp phải có thật trên cloud, đã trả tiền, còn mới.
        const { data: luot, error: luotErr } = await supabase
            .from('photo_sessions')
            .select('uuid, amount, payment_method, meta_data, created_at')
            .eq('uuid', maLuot)
            .maybeSingle();
        if (luotErr) throw luotErr;
        if (!luot) return loi(404, 'Lượt chụp chưa lưu xong, vui lòng thử lại sau ít giây.', { thu_lai: true });
        if (luot.payment_method === 'event' || !(Number(luot.amount) > 0)) return loi(400, 'Lượt chụp miễn phí không được tích điểm.');
        if (Date.now() - Date.parse(luot.created_at) > LUOT_CU_NHAT_MS) return loi(400, 'Lượt chụp đã quá lâu, không tích điểm được nữa.');

        // 2) Lượt trả bằng voucher tích điểm -> không cộng.
        const maDaDung = String(luot.meta_data?.payment_code || '').trim();
        if (maDaDung) {
            const { data: ma, error: maErr } = await supabase
                .from('payment_codes').select('loyalty_phone').eq('code', maDaDung).maybeSingle();
            if (maErr) throw maErr;
            if (ma?.loyalty_phone) return loi(400, 'Lượt dùng voucher tích điểm không được cộng dấu.', { la_luot_doi: true });
        }

        // 3) Lượt này đã được cộng (gửi lại / khách nhập 2 lần) -> trả trạng thái hiện tại, không cộng thêm.
        const { data: daCong, error: dcErr } = await supabase
            .from('loyalty_log').select('phone').eq('session_uuid', maLuot).eq('kind', 'cong').maybeSingle();
        if (dcErr) throw dcErr;
        if (daCong) {
            if (daCong.phone !== sdt) return loi(400, 'Lượt chụp này đã tích điểm cho số khác.');
            const the = await docThe(supabase, sdt);
            return ok({ ...theCongKhai(the), da_cong_truoc: true, sdt: anSdt(sdt) });
        }

        // 4) Thẻ: chưa có / chưa có PIN -> cần PIN + đồng ý.
        let the = await xetHetHan(supabase, await docThe(supabase, sdt));
        if (!the || !the.pin_hash) {
            if (!pinHopLe(body?.pin_moi)) {
                return ok({ can_pin: true, the_moi: !the, dau: the?.stamps || 0, sdt: anSdt(sdt) });
            }
            const nowIso = new Date().toISOString();
            if (!the) {
                const { data: taoMoi, error: taoErr } = await supabase
                    .from('loyalty_cards')
                    .insert({ phone: sdt, stamps: 0, pin_hash: hashPassword(body.pin_moi), consent_at: body?.dong_y === true ? nowIso : null, updated_at: nowIso })
                    .select().single();
                if (taoErr && taoErr.code !== '23505') throw taoErr;
                the = taoMoi || await docThe(supabase, sdt);
            } else {
                the = (await datDau(supabase, the, { pin_hash: hashPassword(body.pin_moi), consent_at: the.consent_at || (body?.dong_y === true ? nowIso : null) }))
                    || await docThe(supabase, sdt);
            }
        }

        // 5) Giới hạn mỗi ngày cho một SĐT (chặn bơm dấu bằng lượt giả).
        const tuLuc = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { data: homNay, error: hnErr } = await supabase
            .from('loyalty_log').select('id').eq('phone', sdt).eq('kind', 'cong').gte('created_at', tuLuc);
        if (hnErr) throw hnErr;
        if ((homNay || []).length >= DAU_MOI_NGAY) {
            return loi(429, `Mỗi số điện thoại tích tối đa ${DAU_MOI_NGAY} dấu một ngày.`, { ...theCongKhai(the) });
        }

        // 6) Ghi nhật ký TRƯỚC (index unique theo lượt chặn cộng trùng giữa 2 lần gửi song song), rồi cộng dấu.
        const dayRoi = the.stamps >= DAU_TOI_DA;
        const { error: nkErr } = await supabase.from('loyalty_log').insert({
            phone: sdt, kind: 'cong', session_uuid: maLuot, stamps_truoc: the.stamps,
            stamps_sau: Math.min(the.stamps + 1, DAU_TOI_DA), note: dayRoi ? 'the_da_day' : null,
        });
        if (nkErr) {
            if (nkErr.code === '23505') return ok({ ...theCongKhai(the), da_cong_truoc: true, sdt: anSdt(sdt) });
            throw nkErr;
        }
        if (dayRoi) return ok({ ...theCongKhai(the), the_day: true, sdt: anSdt(sdt) });

        for (let lan = 0; lan < 4; lan += 1) {
            const moi = await datDau(supabase, the, { stamps: Math.min(the.stamps + 1, DAU_TOI_DA), last_stamp_at: new Date().toISOString() });
            if (moi) return ok({ ...theCongKhai(moi), them: 1, sdt: anSdt(sdt) });
            the = await docThe(supabase, sdt);
        }
        throw new Error('Không cộng được dấu (thẻ đang bị ghi liên tục).');
    } catch (error) {
        if (isMissingTable(error)) return chuaCaiBang();
        throw error;
    }
}

// ---------------------------------------------------------------- ĐỔI VOUCHER (booth, màn Thanh toán)
// body: { phone, pin, muc? }. Không có `muc` -> chỉ kiểm PIN + trả số dấu và các mốc đổi được.
// Có `muc` (5/7/10) -> sinh một MÃ THANH TOÁN dùng một lần (giống validate) để booth trừ tiền như nhập mã.
// Dấu chỉ bị trừ khi mã được dùng (truDauKhiDungMa) -> khách bỏ ngang không mất dấu.
// Thẻ chưa có PIN (nhân viên nhập từ thẻ giấy) -> khách đặt PIN ngay lúc này (pin_moi).
export async function doiDiem(supabase, req) {
    const body = req.body || {};
    const sdt = chuanHoaSdt(body.phone);
    if (!sdt) return loi(400, 'Số điện thoại không hợp lệ.');

    try {
        const khoaSdt = `tdpin:${sdt}`;
        const khoaIp = `tdip:${clientIp(req)}`;
        const [k1, k2] = await Promise.all([
            lockedSeconds(supabase, khoaSdt, PIN_SAI_TOI_DA),
            lockedSeconds(supabase, khoaIp, IP_SAI_TOI_DA),
        ]);
        const khoa = Math.max(k1, k2);
        if (khoa > 0) return loi(429, `Nhập sai PIN quá nhiều lần. Thử lại sau ${Math.ceil(khoa / 60)} phút hoặc nhờ nhân viên.`);

        let the = await xetHetHan(supabase, await docThe(supabase, sdt));
        if (!the) {
            await recordFailure(supabase, khoaIp, CUA_SO_SAI_MS);
            return loi(404, 'Số điện thoại chưa tích điểm.');
        }
        if (!the.pin_hash) {
            if (!pinHopLe(body.pin_moi)) return ok({ can_pin: true, dau: the.stamps, sdt: anSdt(sdt) });
            the = (await datDau(supabase, the, { pin_hash: hashPassword(body.pin_moi), consent_at: the.consent_at || (body.dong_y === true ? new Date().toISOString() : null) }))
                || await docThe(supabase, sdt);
        } else if (!verifyPassword(String(body.pin || ''), the.pin_hash)) {
            await Promise.all([recordFailure(supabase, khoaSdt, CUA_SO_SAI_MS), recordFailure(supabase, khoaIp, CUA_SO_SAI_MS)]);
            return loi(401, 'Sai mã PIN.', { sai_pin: true });
        }

        const mucs = cacMucDuocDoi(the.stamps);
        if (body.muc == null) return ok({ ...theCongKhai(the), sdt: anSdt(sdt) });

        const muc = MUC_DOI.find((m) => m.dau === Number(body.muc));
        if (!muc) return loi(400, 'Mốc đổi không hợp lệ.');
        if (!mucs.includes(muc)) return loi(400, `Cần ${muc.dau} dấu để đổi voucher này (bạn có ${the.stamps}).`);

        // Mã voucher đổi trước đó mà chưa dùng (khách bỏ ngang, đổi lại mốc khác) -> cho hết hạn ngay.
        const nowIso = new Date().toISOString();
        const { error: huyErr } = await supabase
            .from('payment_codes').update({ expires_at: nowIso })
            .eq('loyalty_phone', sdt).eq('is_used', false);
        if (huyErr) throw huyErr;

        let ma = null;
        let loiCuoi = null;
        for (let lan = 0; lan < 10 && !ma; lan += 1) {
            const code = String(randomInt(0, 1000000)).padStart(6, '0');
            const { data, error } = await supabase.from('payment_codes').insert({
                code,
                value: muc.giaTri,
                expires_at: new Date(Date.now() + MA_VOUCHER_SONG_MS).toISOString(),
                is_used: false,
                created_by: NGUOI_TAO_MA,
                claimed_by: NGUOI_TAO_MA,
                claimed_at: nowIso,
                note: `Đổi ${muc.dau} dấu tích điểm · ${anSdt(sdt)}`,
                loyalty_phone: sdt,
                loyalty_stamps: muc.dau,
            }).select().single();
            if (!error) ma = data;
            else if (error.code !== '23505') { loiCuoi = error; break; }
        }
        if (!ma) throw loiCuoi || new Error('Không tạo được mã voucher.');
        return ok({ valid: true, id: ma.id, code: ma.code, value: Number(ma.value), expires_at: ma.expires_at, muc: muc.dau, dau: the.stamps });
    } catch (error) {
        if (isMissingTable(error)) return chuaCaiBang();
        throw error;
    }
}

// Gọi từ markCodeUsed (api/codes.js) NGAY SAU KHI mã được đánh dấu dùng. Mã voucher tích điểm -> thẻ về 0.
// Lỗi ở đây không được làm hỏng thanh toán của khách (mã đã dùng xong) -> chỉ log.
export async function truDauKhiDungMa(supabase, ma, maLuot) {
    if (!ma?.loyalty_phone) return;
    try {
        for (let lan = 0; lan < 4; lan += 1) {
            const the = await docThe(supabase, ma.loyalty_phone);
            if (!the) return;
            const moi = await datDau(supabase, the, { stamps: 0 });
            if (moi) {
                await ghiNhatKy(supabase, {
                    phone: the.phone, kind: 'doi', stamps_truoc: the.stamps, stamps_sau: 0,
                    code_id: String(ma.id), value: Number(ma.value) || null, session_uuid: null,
                    note: `muc ${ma.loyalty_stamps || '?'}${maLuot ? ` · luot ${maLuot}` : ''}`,
                });
                return;
            }
        }
        console.error('[tich_diem] khong tru duoc dau sau khi dung ma', ma.id);
    } catch (error) {
        console.error('[tich_diem] tru dau loi', error);
    }
}

// ---------------------------------------------------------------- NHÂN VIÊN (trang /admin/tich-diem)
export async function nvXem(supabase, sdtRaw) {
    const sdt = chuanHoaSdt(sdtRaw);
    if (!sdt) return loi(400, 'Số điện thoại không hợp lệ.');
    try {
        const the = await xetHetHan(supabase, await docThe(supabase, sdt));
        const { data: nk, error } = await supabase
            .from('loyalty_log').select('*').eq('phone', sdt).order('created_at', { ascending: false }).limit(30);
        if (error) throw error;
        return ok({
            sdt,
            co_the: !!the,
            ...theCongKhai(the),
            tao_luc: the?.created_at || null,
            dau_cuoi_luc: the?.last_stamp_at || null,
            nhat_ky: nk || [],
        });
    } catch (error) {
        if (isMissingTable(error)) return chuaCaiBang();
        throw error;
    }
}

// Nhân viên nhập số dấu từ thẻ giấy (hoặc sửa sai). Thẻ chưa có thì tạo (chưa có PIN: khách tự đặt ở booth).
export async function nvSuaDau(supabase, body, nguoi) {
    const sdt = chuanHoaSdt(body?.phone);
    if (!sdt) return loi(400, 'Số điện thoại không hợp lệ.');
    const dau = Number(body?.dau);
    if (!Number.isInteger(dau) || dau < 0 || dau > DAU_TOI_DA) return loi(400, `Số dấu phải từ 0 đến ${DAU_TOI_DA}.`);
    const ghiChu = String(body?.ghi_chu || '').trim().slice(0, 200) || null;
    try {
        const nowIso = new Date().toISOString();
        for (let lan = 0; lan < 4; lan += 1) {
            const the = await docThe(supabase, sdt);
            if (!the) {
                const { error } = await supabase.from('loyalty_cards')
                    .insert({ phone: sdt, stamps: dau, last_stamp_at: dau ? nowIso : null, updated_at: nowIso });
                if (error && error.code === '23505') continue;
                if (error) throw error;
                await ghiNhatKy(supabase, { phone: sdt, kind: 'nv_sua', stamps_truoc: 0, stamps_sau: dau, actor: nguoi, note: ghiChu });
                return nvXem(supabase, sdt);
            }
            const moi = await datDau(supabase, the, { stamps: dau, last_stamp_at: dau ? nowIso : the.last_stamp_at });
            if (!moi) continue;
            await ghiNhatKy(supabase, { phone: sdt, kind: 'nv_sua', stamps_truoc: the.stamps, stamps_sau: dau, actor: nguoi, note: ghiChu });
            return nvXem(supabase, sdt);
        }
        return loi(409, 'Thẻ đang được cập nhật, thử lại.');
    } catch (error) {
        if (isMissingTable(error)) return chuaCaiBang();
        throw error;
    }
}

// Khách quên PIN: nhân viên xoá PIN, khách đặt lại ở lần tích / đổi tiếp theo.
export async function nvXoaPin(supabase, body, nguoi) {
    const sdt = chuanHoaSdt(body?.phone);
    if (!sdt) return loi(400, 'Số điện thoại không hợp lệ.');
    try {
        const the = await docThe(supabase, sdt);
        if (!the) return loi(404, 'Số điện thoại chưa tích điểm.');
        const { error } = await supabase.from('loyalty_cards')
            .update({ pin_hash: null, updated_at: new Date().toISOString() }).eq('phone', sdt);
        if (error) throw error;
        await ghiNhatKy(supabase, { phone: sdt, kind: 'nv_pin', stamps_truoc: the.stamps, stamps_sau: the.stamps, actor: nguoi });
        return nvXem(supabase, sdt);
    } catch (error) {
        if (isMissingTable(error)) return chuaCaiBang();
        throw error;
    }
}

// Admin: hoạt động gần đây (mọi SĐT, SĐT che bớt số) + vài con số tổng.
export async function adminTongQuan(supabase) {
    try {
        const [{ data: nk, error: e1 }, { count: soThe, error: e2 }] = await Promise.all([
            supabase.from('loyalty_log').select('*').order('created_at', { ascending: false }).limit(50),
            supabase.from('loyalty_cards').select('phone', { count: 'exact', head: true }),
        ]);
        if (e1) throw e1;
        if (e2) throw e2;
        return ok({ so_the: soThe || 0, nhat_ky: (nk || []).map((r) => ({ ...r, phone: anSdt(r.phone) })) });
    } catch (error) {
        if (isMissingTable(error)) return chuaCaiBang();
        throw error;
    }
}
