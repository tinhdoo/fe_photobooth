import { getSupabaseAdmin, handleOptions, json, methodNotAllowed } from '../lib/supabase.js';

async function resolveBucket(supabase) {
    const configuredBucket = process.env.SUPABASE_BUCKET || 'tomato';
    const { data, error } = await supabase.storage.listBuckets();
    if (error) throw error;

    const buckets = Array.isArray(data) ? data : [];
    if (buckets.some((item) => item.name === configuredBucket)) return configuredBucket;
    if (buckets.length > 0) return buckets[0].name;
    return configuredBucket;
}

function isMissingTable(error) {
    return /Could not find the table|schema cache|does not exist/i.test(error?.message || '');
}

function normalizeSession(row) {
    if (!row) return null;

    const expired = row.expires_at && new Date(row.expires_at).getTime() < Date.now();
    return {
        id: row.id,
        uuid: row.uuid,
        layout_id: row.layout_id,
        composite_url: row.composite_url,
        composite_public_id: row.composite_public_id,
        photos: Array.isArray(row.photos) ? row.photos : [],
        payment_method: row.payment_method,
        amount: row.amount,
        meta_data: row.meta_data || {},
        status: expired ? 'expired' : (row.status || 'active'),
        created_at: row.created_at,
        expires_at: row.expires_at,
    };
}

function buildSession(body) {
    const uuid = String(body.session_id || body.uuid || '').trim();
    return {
        uuid,
        layout_id: body.layout_id || 'strip_4',
        composite_url: body.composite_url || null,
        composite_public_id: body.composite_public_id || null,
        photos: Array.isArray(body.photos) ? body.photos : [],
        payment_method: body.payment_method || 'cash',
        amount: Number(body.amount || 0),
        meta_data: body.meta_data || {},
        status: 'active',
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
    };
}

function parseStoragePublicId(publicId) {
    const value = String(publicId || '').trim();
    const slashIndex = value.indexOf('/');
    if (slashIndex <= 0) return null;
    return {
        bucket: value.slice(0, slashIndex),
        path: value.slice(slashIndex + 1),
    };
}

function collectSessionStoragePaths(session) {
    const paths = new Set();
    const addPublicId = (publicId) => {
        const parsed = parseStoragePublicId(publicId);
        if (parsed?.path) paths.add(parsed.path);
    };

    addPublicId(session.composite_public_id);
    addPublicId(session.gif_public_id);

    const photos = Array.isArray(session.photos) ? session.photos : [];
    photos.forEach((photo) => {
        addPublicId(photo?.public_id);
        addPublicId(photo?.video_public_id);
    });

    const meta = session.meta_data || {};
    addPublicId(meta.composite_public_id);
    addPublicId(meta.video_public_id);

    return Array.from(paths);
}

async function listFilesRecursive(supabase, bucket, prefix) {
    const result = [];
    const { data, error } = await supabase.storage.from(bucket).list(prefix, { limit: 1000 });
    if (error) return result;

    const items = Array.isArray(data) ? data : [];
    for (const item of items) {
        const path = `${prefix}/${item.name}`;
        if (item.id) {
            result.push({ ...item, path });
        } else {
            result.push(...await listFilesRecursive(supabase, bucket, path));
        }
    }
    return result;
}

async function removeStoragePaths(supabase, bucket, paths) {
    const uniquePaths = Array.from(new Set(paths.filter(Boolean)));
    let deleted = 0;

    for (let i = 0; i < uniquePaths.length; i += 100) {
        const batch = uniquePaths.slice(i, i + 100);
        const { error } = await supabase.storage.from(bucket).remove(batch);
        if (!error) deleted += batch.length;
    }

    return deleted;
}

async function cleanupExpiredCloud(req, res, supabase) {
    const secret = process.env.CLEANUP_SECRET;
    const auth = String(req.headers.authorization || '');
    if (secret && auth !== `Bearer ${secret}` && req.query.secret !== secret) {
        return json(res, 401, { error: 'Unauthorized cleanup request' });
    }

    const bucket = await resolveBucket(supabase);
    const now = Date.now();
    const maxAgeMs = 72 * 60 * 60 * 1000;
    const cutoffIso = new Date(now - maxAgeMs).toISOString();
    const SESSION_BATCH = 200; // giới hạn mỗi lần để function luôn chạy xong (tránh timeout)

    let expiredSessionRows = 0;
    let deletedMobileRows = 0;
    let deletedStorageObjects = 0;

    // 1) Lấy các session HẾT HẠN nhưng CHƯA được đánh dấu, ưu tiên cũ nhất trước để
    //    cuốn chiếu backlog. Loại bỏ status='expired' để mỗi lần chạy đều tiến tới
    //    (nếu không sẽ chọn lại đúng các row cũ và không bao giờ hết).
    // select('*') có chủ đích: collectSessionStoragePaths đọc nhiều field (kể cả
    // gif_public_id không có trong schema -> chỉ undefined, vô hại). Nếu liệt kê
    // tên cột không tồn tại, PostgREST sẽ lỗi và hỏng cả truy vấn.
    const { data: sessions, error: sessionError } = await supabase
        .from('photo_sessions')
        .select('*')
        .neq('status', 'expired')
        .or(`expires_at.lt.${new Date(now).toISOString()},created_at.lt.${cutoffIso}`)
        .order('created_at', { ascending: true })
        .limit(SESSION_BATCH);

    if (sessionError && !isMissingTable(sessionError)) throw sessionError;

    if (!sessionError && Array.isArray(sessions) && sessions.length > 0) {
        const sessionPaths = new Set();
        for (const session of sessions) {
            collectSessionStoragePaths(session).forEach((path) => sessionPaths.add(path));
            if (session.uuid) sessionPaths.add(`sessions/${session.uuid}.json`);
        }

        // 2) Đánh dấu expired — GIỮ row để báo cáo doanh thu không mất lịch sử.
        const ids = sessions.map((item) => item.id).filter(Boolean);
        const { error } = await supabase
            .from('photo_sessions')
            .update({ status: 'expired' })
            .in('id', ids);
        if (!error) expiredSessionRows = ids.length;

        // 3) Xóa ảnh của các session vừa xử lý NGAY (trước các bước quét tốn thời gian)
        //    để mỗi lần chạy đều dọn được dữ liệu, không phụ thuộc bước sau có kịp không.
        deletedStorageObjects += await removeStoragePaths(supabase, bucket, Array.from(sessionPaths));
    }

    // 4) Dọn mobile_uploads cũ: xóa row staging + ảnh tương ứng.
    const { data: mobileRows, error: mobileError } = await supabase
        .from('mobile_uploads')
        .select('id, public_id')
        .lt('created_at', cutoffIso)
        .limit(1000);

    if (mobileError && !isMissingTable(mobileError)) throw mobileError;

    if (!mobileError && Array.isArray(mobileRows) && mobileRows.length > 0) {
        const mobilePaths = new Set();
        mobileRows.forEach((row) => {
            const parsed = parseStoragePublicId(row.public_id);
            if (parsed?.path) mobilePaths.add(parsed.path);
        });

        const ids = mobileRows.map((row) => row.id).filter(Boolean);
        const { error } = await supabase.from('mobile_uploads').delete().in('id', ids);
        if (!error) deletedMobileRows = ids.length;
        deletedStorageObjects += await removeStoragePaths(supabase, bucket, Array.from(mobilePaths));
    }

    // 5) Quét file mồ côi theo thời gian tạo (chỉ list, KHÔNG tải từng file) — dọn nốt
    //    ảnh của các row đã 'expired' từ trước (backlog) hoặc file không còn row tham chiếu.
    //    Xóa ngay sau mỗi prefix để giữ tiến độ nếu hết thời gian ở giữa.
    for (const prefix of ['booth', 'cloud', 'mobile', 'sessions']) {
        const files = await listFilesRecursive(supabase, bucket, prefix);
        const oldPaths = files
            .filter((file) => {
                const t = new Date(file.created_at || file.updated_at || 0).getTime();
                return t && t < now - maxAgeMs;
            })
            .map((file) => file.path);
        deletedStorageObjects += await removeStoragePaths(supabase, bucket, oldPaths);
    }

    const moreLikely = Array.isArray(sessions) && sessions.length === SESSION_BATCH;

    return json(res, 200, {
        success: true,
        bucket,
        cutoff: cutoffIso,
        expiredSessionRows,
        deletedMobileRows,
        deletedStorageObjects,
        moreLikely, // true => còn backlog, nên gọi cleanup lại
    });
}

async function saveSessionToStorage(supabase, session) {
    const bucket = await resolveBucket(supabase);
    const objectPath = `sessions/${session.uuid}.json`;
    const payload = Buffer.from(JSON.stringify(session), 'utf8');

    const { error } = await supabase.storage
        .from(bucket)
        .upload(objectPath, payload, {
            contentType: 'application/json',
            upsert: true,
        });

    if (error) throw error;
    return session;
}

async function getSessionFromStorage(supabase, sessionId) {
    const bucket = await resolveBucket(supabase);
    const { data, error } = await supabase.storage
        .from(bucket)
        .download(`sessions/${sessionId}.json`);

    if (error) return null;
    const text = await data.text();
    return JSON.parse(text);
}

export default async function handler(req, res) {
    if (handleOptions(req, res)) return;

    try {
        const supabase = getSupabaseAdmin();

        if (req.query.action === 'cleanup') {
            if (req.method !== 'GET' && req.method !== 'POST') return methodNotAllowed(res);
            return cleanupExpiredCloud(req, res, supabase);
        }

        if (req.method === 'GET') {
            const sessionId = String(req.query.id || req.query.uuid || '').trim();

            if (sessionId) {
                const { data, error } = await supabase
                    .from('photo_sessions')
                    .select('*')
                    .eq('uuid', sessionId)
                    .maybeSingle();

                if (error && isMissingTable(error)) {
                    const storageSession = await getSessionFromStorage(supabase, sessionId);
                    if (!storageSession) return json(res, 404, { error: 'Session not found' });
                    return json(res, 200, normalizeSession(storageSession));
                }

                if (error) throw error;
                if (!data) return json(res, 404, { error: 'Session not found' });
                return json(res, 200, normalizeSession(data));
            }

            const { data, error } = await supabase
                .from('photo_sessions')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(100);

            if (error && isMissingTable(error)) return json(res, 200, []);
            if (error) throw error;
            return json(res, 200, (data || []).map(normalizeSession));
        }

        if (req.method === 'POST') {
            const body = req.body || {};
            const session = buildSession(body);
            if (!session.uuid) return json(res, 400, { error: 'Missing session_id' });

            const { data, error } = await supabase
                .from('photo_sessions')
                .upsert(session, {
                    onConflict: 'uuid',
                })
                .select()
                .single();

            if (error && isMissingTable(error)) {
                const storageSession = await saveSessionToStorage(supabase, session);
                return json(res, 201, normalizeSession(storageSession));
            }

            if (error) throw error;
            return json(res, 201, normalizeSession(data));
        }

        return methodNotAllowed(res);
    } catch (error) {
        console.error('Sessions API failed:', error);
        return json(res, 500, { error: error.message || 'Sessions API failed' });
    }
}
