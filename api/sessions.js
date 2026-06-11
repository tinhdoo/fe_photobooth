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
