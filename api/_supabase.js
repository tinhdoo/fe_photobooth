import { createClient } from '@supabase/supabase-js';

export function getSupabaseAdmin() {
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !key) {
        throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    }

    return createClient(url, key, {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
        },
    });
}

export function json(res, status, body) {
    res.status(status).json(body);
}

export function methodNotAllowed(res) {
    res.setHeader('Allow', 'POST');
    json(res, 405, { error: 'Method not allowed' });
}
