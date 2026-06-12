import { getSupabaseAdmin, handleOptions, json } from '../lib/supabase.js';

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

async function getUploadsFromStorage(supabase, sessionId) {
    const bucket = await resolveBucket(supabase);
    const { data, error } = await supabase.storage
        .from(bucket)
        .list(`mobile/${sessionId}`, {
            limit: 100,
            sortBy: { column: 'name', order: 'asc' },
        });

    if (error) throw error;

    const files = Array.isArray(data) ? data.filter((item) => item.name && !item.name.endsWith('/')) : [];
    const rows = await Promise.all(files.map(async (file) => {
        const objectPath = `mobile/${sessionId}/${file.name}`;
        const { data: publicData } = supabase.storage.from(bucket).getPublicUrl(objectPath);
        const { data: signedData } = await supabase.storage.from(bucket).createSignedUrl(objectPath, 72 * 60 * 60);

        return {
            id: objectPath,
            session_uuid: sessionId,
            url: signedData?.signedUrl || publicData.publicUrl,
            public_id: `${bucket}/${objectPath}`,
            created_at: file.created_at || file.updated_at || new Date().toISOString(),
        };
    }));

    return rows;
}

export default async function handler(req, res) {
    if (handleOptions(req, res)) return;

    if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return json(res, 405, { error: 'Method not allowed' });
    }

    try {
        const sessionId = String(req.query?.session_id || '').trim();
        if (!sessionId) {
            return json(res, 400, { error: 'Missing session_id' });
        }

        const supabase = getSupabaseAdmin();
        const { data, error } = await supabase
            .from('mobile_uploads')
            .select('*')
            .eq('session_uuid', sessionId)
            .order('created_at', { ascending: true });

        if (error && isMissingTable(error)) {
            const storageRows = await getUploadsFromStorage(supabase, sessionId);
            return json(res, 200, storageRows);
        }
        if (error) throw error;

        return json(res, 200, Array.isArray(data) ? data : []);
    } catch (error) {
        console.error('Fetch mobile uploads failed:', error);
        return json(res, 500, { error: error.message || 'Fetch mobile uploads failed' });
    }
}
