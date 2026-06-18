import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://ltmbliusizokulbbpgir.supabase.co';
const supabaseKey = 'sb_publishable_x1vBxmCXfjEA7ckz8wWnvA_-1pbt8IW';
const supabase = createClient(supabaseUrl, supabaseKey);

function normalizeSessionTransaction(session) {
    const id = session.uuid || session.id;
    return {
        id,
        value: Number(session.amount || 0),
        used_at: session.created_at || session.updated_at,
    };
}

async function test() {
    const { data, error } = await supabase
        .from('photo_sessions')
        .select('id, uuid, payment_method, amount, meta_data, status, created_at, updated_at')
        .order('created_at', { ascending: false })
        .limit(10);

    console.log('Error:', error);
    const dbSessions = (Array.isArray(data) ? data : []).map(s => normalizeSessionTransaction(s)).filter(s => s.id);
    
    console.log('dbSessions:', dbSessions);
}

test();
