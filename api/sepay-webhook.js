import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import { getSupabaseAdmin, json, methodNotAllowed } from '../lib/supabase.js';

function sameKey(provided, expected) {
    const a = Buffer.from(String(provided || ''));
    const b = Buffer.from(String(expected));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Chỉ giữ các trường cần đối soát. Bảng payments đang cho đọc công khai (policy anon trong
// supabase_schema.sql, để kiosk theo dõi đơn QR) -> KHÔNG lưu số dư tài khoản (accumulated), số tài
// khoản, nội dung chuyển khoản (thường có tên người gửi). Trước 2026-10-06 lưu nguyên payload SePay.
function pickTransfer(payload, amount) {
    return {
        id: payload?.id ?? null,
        gateway: payload?.gateway ?? null,
        transactionDate: payload?.transactionDate ?? null,
        transferType: payload?.transferType ?? null,
        transferAmount: amount,
        referenceCode: payload?.referenceCode ?? null,
    };
}

function getAuthToken(req) {
    const header = req.headers.authorization || req.headers.Authorization || '';
    const explicitHeader = req.headers['x-api-key'] || req.headers['sepay-api-key'];
    return String(explicitHeader || header)
        .replace(/^Apikey\s+/i, '')
        .replace(/^Bearer\s+/i, '')
        .trim();
}

function extractTransferCode(payload) {
    const prefix = process.env.SEPAY_PAYMENT_PREFIX || 'TOMA';
    const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const codePattern = new RegExp(`${escapedPrefix}(?:\\d{6,12}|[A-Z0-9]{7})`, 'i');
    const candidates = [
        payload?.code,
        payload?.payment_code,
        payload?.orderCode,
        payload?.content,
        payload?.description,
        payload?.transferContent,
        payload?.transfer_content,
        payload?.transactionContent,
        payload?.transaction_content,
        JSON.stringify(payload),
    ].filter(Boolean).map(String);

    for (const value of candidates) {
        const match = value.match(codePattern);
        if (match) return match[0].toUpperCase();
    }

    return null;
}

function toAmount(value) {
    if (typeof value === 'number') return value;
    if (typeof value !== 'string') return 0;

    const normalized = value.replace(/[^\d.-]/g, '');
    return Number(normalized || 0);
}

function extractAmount(payload) {
    return toAmount(
        payload?.transferAmount
        || payload?.transfer_amount
        || payload?.amount
        || payload?.amountIn
        || payload?.amount_in
        || payload?.money
        || payload?.creditAmount
        || payload?.credit_amount
        || 0
    );
}

export default async function handler(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res);

    try {
        const expectedKey = process.env.SEPAY_API_KEY;
        if (expectedKey) {
            const provided = getAuthToken(req) || req.query?.key || req.body?.api_key;
            if (!sameKey(provided, expectedKey)) {
                return json(res, 401, { success: false, message: 'Unauthorized' });
            }
        }

        const payload = req.body || {};
        // Chỉ tiền VÀO. SePay báo cả giao dịch chuyển ĐI (transferType 'out'): lệnh chuyển đi có nội dung
        // chứa mã đơn không được làm đơn thành "đã trả".
        const transferType = String(payload?.transferType || '').trim().toLowerCase();
        if (transferType && transferType !== 'in') {
            return json(res, 200, { success: true, message: 'Ignored non-incoming transfer' });
        }

        const code = extractTransferCode(payload);
        if (!code) {
            return json(res, 200, { success: true, message: 'No payment code found' });
        }

        // SePay luôn gửi transferAmount. Không đọc được số tiền = payload lạ -> KHÔNG đánh dấu đã trả.
        // Trước 2026-10-06 thiếu số tiền thì bỏ qua bước so số tiền -> {"content":"TOMA<mã>"} là đủ.
        const transferAmount = extractAmount(payload);
        if (!Number.isFinite(transferAmount) || transferAmount <= 0) {
            console.warn(`Sepay webhook: ${code} khong co so tien chuyen -> bo qua`);
            return json(res, 200, { success: true, message: 'Missing transfer amount', code });
        }

        const supabase = getSupabaseAdmin();

        const { data: payment, error: findError } = await supabase
            .from('payments')
            .select('*')
            .eq('code', code)
            .maybeSingle();

        // Lỗi DB (mạng, Supabase quá tải) -> 500 để SePay coi là chưa giao được và gửi lại. Trước
        // 2026-10-06 mọi lỗi đều trả 200 "Payment not found" -> SePay thôi gửi, khách đã chuyển khoản mà
        // booth không bao giờ mở.
        if (findError) throw findError;
        if (!payment) {
            return json(res, 200, { success: true, message: 'Payment not found', code });
        }

        if (payment.status === 'paid') {
            return json(res, 200, { success: true, message: 'Already paid', code });
        }

        const rawPayload = payment.raw_payload && typeof payment.raw_payload === 'object' ? payment.raw_payload : {};
        const transfer = pickTransfer(payload, transferAmount);

        if (transferAmount < Number(payment.amount || 0)) {
            // Chuyển THIẾU: đơn vẫn chờ, nhưng ghi lại để đối soát (log Vercel Hobby chỉ giữ 1 giờ).
            const underpaid = Array.isArray(rawPayload.underpaid) ? rawPayload.underpaid : [];
            if (!transfer.id || !underpaid.some((t) => t?.id === transfer.id)) {
                const { error: noteError } = await supabase
                    .from('payments')
                    .update({ raw_payload: { ...rawPayload, underpaid: [...underpaid, transfer].slice(-5) } })
                    .eq('id', payment.id)
                    .neq('status', 'paid');
                if (noteError) throw noteError;
            }
            return json(res, 200, {
                success: true,
                message: 'Transfer amount is lower than payment amount',
                code,
            });
        }

        const transactionReference = payload?.referenceCode
            || payload?.transactionId
            || payload?.id
            || payload?.gatewayTransactionId
            || null;

        const { error: updateError } = await supabase
            .from('payments')
            .update({
                status: 'paid',
                paid_at: new Date().toISOString(),
                transaction_reference: transactionReference,
                raw_payload: { ...rawPayload, transfer },
            })
            .eq('id', payment.id)
            .neq('status', 'paid');

        if (updateError) throw updateError;

        return json(res, 200, { success: true, message: 'Payment marked paid', code });
    } catch (error) {
        console.error('Sepay webhook failed:', error);
        return json(res, 500, { success: false, message: error.message || 'Webhook failed' });
    }
}
