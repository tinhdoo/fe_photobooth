import { getSupabaseAdmin, handleOptions, json, methodNotAllowed } from './_supabase.js';

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
    const pathsToDelete = new Set();
    let expiredSessionRows = 0;
    let deletedMobileRows = 0;

    const { data: sessions, error: sessionError } = await supabase
        .from('photo_sessions')
        .select('*')
        .or(`expires_at.lt.${new Date(now).toISOString()},created_at.lt.${cutoffIso}`)
        .limit(500);

    if (sessionError && !isMissingTable(sessionError)) throw sessionError;

    if (!sessionError && Array.isArray(sessions)) {
        for (const session of sessions) {
            collectSessionStoragePaths(session).forEach((path) => pathsToDelete.add(path));
            pathsToDelete.add(`sessions/${session.uuid}.json`);
        }

        if (sessions.length > 0) {
            const ids = sessions.map((item) => item.id).filter(Boolean);
            const { error } = await supabase
                .from('photo_sessions')
                .update({ status: 'expired' })
                .in('id', ids);
            if (!error) expiredSessionRows = ids.length;
        }
    }

    const sessionFiles = await listFilesRecursive(supabase, bucket, 'sessions');
    for (const file of sessionFiles) {
        let shouldDelete = false;

        try {
            const { data } = await supabase.storage.from(bucket).download(file.path);
            const session = JSON.parse(await data.text());
            const expiresAt = session.expires_at ? new Date(session.expires_at).getTime() : 0;
            shouldDelete = expiresAt > 0 ? expiresAt < now : new Date(file.created_at || file.updated_at || 0).getTime() < now - maxAgeMs;
        } catch {
            shouldDelete = new Date(file.created_at || file.updated_at || 0).getTime() < now - maxAgeMs;
        }

        if (shouldDelete) pathsToDelete.add(file.path);
    }

    for (const prefix of ['booth', 'cloud', 'mobile']) {
        const files = await listFilesRecursive(supabase, bucket, prefix);
        files.forEach((file) => {
            const createdAt = new Date(file.created_at || file.updated_at || 0).getTime();
            if (createdAt && createdAt < now - maxAgeMs) pathsToDelete.add(file.path);
        });
    }

    const { data: mobileRows, error: mobileError } = await supabase
        .from('mobile_uploads')
        .select('*')
        .lt('created_at', cutoffIso)
        .limit(1000);

    if (mobileError && !isMissingTable(mobileError)) throw mobileError;

    if (!mobileError && Array.isArray(mobileRows)) {
        mobileRows.forEach((row) => {
            const parsed = parseStoragePublicId(row.public_id);
            if (parsed?.path) pathsToDelete.add(parsed.path);
        });

        if (mobileRows.length > 0) {
            const ids = mobileRows.map((row) => row.id).filter(Boolean);
            const { error } = await supabase.from('mobile_uploads').delete().in('id', ids);
            if (!error) deletedMobileRows = ids.length;
        }
    }

    const deletedStorageObjects = await removeStoragePaths(supabase, bucket, Array.from(pathsToDelete));

    return json(res, 200, {
        success: true,
        bucket,
        cutoff: cutoffIso,
        expiredSessionRows,
        deletedMobileRows,
        deletedStorageObjects,
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
