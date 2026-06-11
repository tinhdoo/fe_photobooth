import { getSupabaseAdmin, handleOptions, json } from '../_supabase.js';

export default async function handler(req, res) {
    if (handleOptions(req, res)) return;

    const { id } = req.query;
    if (!id) return json(res, 400, { error: 'Missing device id' });

    try {
        const supabase = getSupabaseAdmin();

        if (req.method === 'PUT') {
            const updates = {
                updated_at: new Date().toISOString(),
            };

            if (typeof req.body?.name === 'string') updates.name = req.body.name.trim();
            if (typeof req.body?.mode === 'string') updates.mode = req.body.mode;

            const { data, error } = await supabase
                .from('devices')
                .update(updates)
                .eq('id', id)
                .select()
                .single();

            if (error) throw error;
            return json(res, 200, data);
        }

        if (req.method === 'DELETE') {
            const { error } = await supabase
                .from('devices')
                .delete()
                .eq('id', id);

            if (error) throw error;
            return json(res, 200, { success: true });
        }

        res.setHeader('Allow', 'PUT,DELETE');
        return json(res, 405, { error: 'Method not allowed' });
    } catch (error) {
        console.error('Update device failed:', error);
        return json(res, 500, { error: error.message || 'Update device failed' });
    }
}
