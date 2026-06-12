import fs from 'node:fs/promises';
import { formidable } from 'formidable';
import { getSupabaseAdmin, handleOptions, json, methodNotAllowed } from '../lib/supabase.js';

export const config = {
    api: {
        bodyParser: false,
    },
};

function parseForm(req) {
    const form = formidable({
        multiples: false,
        maxFileSize: 80 * 1024 * 1024,
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

function cleanExtension(filename, mimetype) {
    const fromName = filename && filename.includes('.') ? filename.split('.').pop().toLowerCase() : '';
    if (fromName) return fromName.replace(/[^a-z0-9]/g, '') || 'bin';
    if (mimetype?.includes('webm')) return 'webm';
    if (mimetype?.includes('png')) return 'png';
    if (mimetype?.includes('jpeg') || mimetype?.includes('jpg')) return 'jpg';
    return 'bin';
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

async function uploadToBucket(supabase, bucket, objectPath, buffer, options) {
    let { error } = await supabase.storage
        .from(bucket)
        .upload(objectPath, buffer, options);

    if (error && /bucket/i.test(error.message || '')) {
        const { error: createError } = await supabase.storage.createBucket(bucket, {
            public: false,
            fileSizeLimit: 80 * 1024 * 1024,
        });

        if (createError) {
            throw new Error(`Storage bucket "${bucket}" không tồn tại và API không tạo được bucket: ${createError.message}`);
        }

        const retry = await supabase.storage
            .from(bucket)
            .upload(objectPath, buffer, options);
        error = retry.error;
    }

    if (error) throw error;
}

export default async function handler(req, res) {
    if (handleOptions(req, res)) return;

    try {
        const supabase = getSupabaseAdmin();
        const configuredBucket = process.env.SUPABASE_BUCKET || 'tomato';
        const bucket = await resolveBucket(supabase);

        if (req.method === 'GET') {
            const { data, error } = await supabase.storage.listBuckets();
            if (error) throw error;

            return json(res, 200, {
                configuredBucket,
                bucket,
                exists: Array.isArray(data) && data.some((item) => item.name === bucket),
                buckets: Array.isArray(data) ? data.map((item) => item.name) : [],
            });
        }

        if (req.method !== 'POST') return methodNotAllowed(res);

        const { files } = await parseForm(req);
        const file = firstValue(files.file);
        if (!file) return json(res, 400, { error: 'Missing file' });

        const extension = cleanExtension(file.originalFilename, file.mimetype);
        const objectPath = `booth/${new Date().toISOString().slice(0, 10)}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
        const buffer = await fs.readFile(file.filepath);

        await uploadToBucket(supabase, bucket, objectPath, buffer, {
                contentType: file.mimetype || 'application/octet-stream',
                upsert: false,
        });

        const { data: publicData } = supabase.storage
            .from(bucket)
            .getPublicUrl(objectPath);

        const { data: signedData } = await supabase.storage
            .from(bucket)
            .createSignedUrl(objectPath, 72 * 60 * 60);

        return json(res, 201, {
            success: true,
            url: signedData?.signedUrl || publicData.publicUrl,
            public_id: `${bucket}/${objectPath}`,
        });
    } catch (error) {
        console.error('Cloud upload failed:', error);
        return json(res, 500, { error: error.message || 'Cloud upload failed' });
    }
}
