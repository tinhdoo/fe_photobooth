import fs from 'node:fs/promises';
import { formidable } from 'formidable';
import { getSupabaseAdmin, handleOptions, json, methodNotAllowed } from './_supabase.js';

export const config = {
    api: {
        bodyParser: false,
    },
};

function parseForm(req) {
    const form = formidable({
        multiples: false,
        maxFileSize: 100 * 1024 * 1024,
        keepExtensions: true,
    });

    return new Promise((resolve, reject) => {
        form.parse(req, (error, fields, files) => {
            if (error) reject(error);
            else resolve({ fields, files });
        });
    });
}

function firstValue(value) {
    return Array.isArray(value) ? value[0] : value;
}

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
    const { data, error } = await supabase.storage
        .from(bucket)
        .download('config/app.json');

    if (error) return {};

    try {
        return JSON.parse(await data.text());
    } catch {
        return {};
    }
}

async function writeConfig(supabase, bucket, config) {
    const payload = Buffer.from(JSON.stringify(config, null, 2), 'utf8');
    const { error } = await supabase.storage
        .from(bucket)
        .upload('config/app.json', payload, {
            contentType: 'application/json',
            upsert: true,
        });

    if (error) throw error;
}

function cleanKey(value) {
    return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
}

function cleanExtension(filename, mimetype) {
    const fromName = filename && filename.includes('.') ? filename.split('.').pop().toLowerCase() : '';
    if (fromName) return fromName.replace(/[^a-z0-9]/g, '') || 'bin';
    if (mimetype?.includes('mp4')) return 'mp4';
    if (mimetype?.includes('webm')) return 'webm';
    if (mimetype?.includes('png')) return 'png';
    if (mimetype?.includes('jpeg') || mimetype?.includes('jpg')) return 'jpg';
    return 'bin';
}

export default async function handler(req, res) {
    if (handleOptions(req, res)) return;
    if (req.method !== 'POST') return methodNotAllowed(res);

    try {
        const { fields, files } = await parseForm(req);
        const file = firstValue(files.file);
        const key = cleanKey(firstValue(fields.key));

        if (!file) return json(res, 400, { error: 'Missing file' });
        if (!key) return json(res, 400, { error: 'Missing config key' });

        const supabase = getSupabaseAdmin();
        const bucket = await resolveBucket(supabase);
        await supabase.storage.updateBucket(bucket, { public: true }).catch(() => null);

        const extension = cleanExtension(file.originalFilename, file.mimetype);
        const objectPath = `branding/${key}-${Date.now()}.${extension}`;
        const buffer = await fs.readFile(file.filepath);

        const { error: uploadError } = await supabase.storage
            .from(bucket)
            .upload(objectPath, buffer, {
                contentType: file.mimetype || 'application/octet-stream',
                upsert: true,
            });

        if (uploadError) throw uploadError;

        const { data: publicData } = supabase.storage
            .from(bucket)
            .getPublicUrl(objectPath);

        const url = publicData.publicUrl;
        const current = await readConfig(supabase, bucket);
        const next = {
            ...current,
            [key]: url,
            updated_at: new Date().toISOString(),
        };
        await writeConfig(supabase, bucket, next);

        return json(res, 201, {
            success: true,
            key,
            url,
        });
    } catch (error) {
        console.error('Branding upload failed:', error);
        return json(res, 500, { error: error.message || 'Branding upload failed' });
    }
}
