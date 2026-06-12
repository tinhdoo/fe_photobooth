import { getSupabaseAdmin, handleOptions, json, methodNotAllowed } from '../lib/supabase.js';

const DEFAULT_CONFIG = {
    price: 60000,
    print_price: 20000,
    mobile_price: 30000,
    mobile_print_price: 10000,
    session_timeout: 600,
    mobile_session_timeout: 300,
    countdown: 5,
    camera_mode: 'webcam',
    hot_folder: 'C:/Photobooth_Input',
    brand_text_primary: '#7B5E43',
    brand_text_secondary: '#5E6B78',
};

async function resolveBucket(supabase) {
    const configuredBucket = process.env.SUPABASE_BUCKET || 'tomato';
    const { data, error } = await supabase.storage.listBuckets();
    if (error) throw error;

    const buckets = Array.isArray(data) ? data : [];
    if (buckets.some((item) => item.name === configuredBucket)) return configuredBucket;
    if (buckets.length > 0) return buckets[0].name;
    return configuredBucket;
}

async function readConfig(supabase, bucket) {
    const { data: row, error: dbError } = await supabase
        .from('app_configs')
        .select('config')
        .eq('key', 'app')
        .maybeSingle();

    if (!dbError && row?.config && typeof row.config === 'object' && Object.keys(row.config).length > 0) {
        return {
            ...DEFAULT_CONFIG,
            ...row.config,
        };
    }

    const { data, error } = await supabase.storage
        .from(bucket)
        .download('config/app.json');

    if (error) return { ...DEFAULT_CONFIG };

    try {
        return {
            ...DEFAULT_CONFIG,
            ...JSON.parse(await data.text()),
        };
    } catch {
        return { ...DEFAULT_CONFIG };
    }
}

async function writeConfig(supabase, bucket, config) {
    const { error: dbError } = await supabase
        .from('app_configs')
        .upsert({
            key: 'app',
            config,
            updated_at: new Date().toISOString(),
        }, { onConflict: 'key' });

    if (dbError && !/Could not find the table|schema cache|does not exist/i.test(dbError.message || '')) {
        throw dbError;
    }

    const payload = Buffer.from(JSON.stringify(config, null, 2), 'utf8');
    const { error } = await supabase.storage
        .from(bucket)
        .upload('config/app.json', payload, {
            contentType: 'application/json',
            upsert: true,
        });

    if (error) throw error;
}

export default async function handler(req, res) {
    if (handleOptions(req, res)) return;
    res.setHeader('Cache-Control', 'no-store, max-age=0');

    try {
        const supabase = getSupabaseAdmin();
        const bucket = await resolveBucket(supabase);

        if (req.method === 'GET') {
            return json(res, 200, await readConfig(supabase, bucket));
        }

        if (req.method === 'POST') {
            const current = await readConfig(supabase, bucket);
            const next = {
                ...current,
                ...(req.body || {}),
                updated_at: new Date().toISOString(),
            };
            await writeConfig(supabase, bucket, next);
            return json(res, 200, next);
        }

        return methodNotAllowed(res);
    } catch (error) {
        console.error('Config API failed:', error);
        return json(res, 500, { error: error.message || 'Config API failed' });
    }
}
