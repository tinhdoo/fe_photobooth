import fs from 'node:fs/promises';
import { formidable } from 'formidable';
import { getSupabaseAdmin, handleOptions, json, methodNotAllowed } from '../_supabase.js';

export const config = {
    api: {
        bodyParser: false,
    },
};

function parseForm(req) {
    const form = formidable({
        multiples: false,
        maxFileSize: 25 * 1024 * 1024,
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

async function uploadToBucket(supabase, bucket, objectPath, buffer, options) {
    let { error } = await supabase.storage
        .from(bucket)
        .upload(objectPath, buffer, options);

    if (error && /bucket/i.test(error.message || '')) {
        const { error: createError } = await supabase.storage.createBucket(bucket, {
            public: false,
            fileSizeLimit: 25 * 1024 * 1024,
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

async function resolveBucket(supabase) {
    const configuredBucket = process.env.SUPABASE_BUCKET || 'tomato';
    const { data, error } = await supabase.storage.listBuckets();
    if (error) throw error;

    const buckets = Array.isArray(data) ? data : [];
    if (buckets.some((item) => item.name === configuredBucket)) return configuredBucket;
    if (buckets.length > 0) return buckets[0].name;
    return configuredBucket;
}

export default async function handler(req, res) {
    if (handleOptions(req, res)) return;
    if (req.method !== 'POST') return methodNotAllowed(res);

    try {
        const { fields, files } = await parseForm(req);
        const sessionId = String(firstValue(fields.session_id) || '').trim();
        const file = firstValue(files.file);

        if (!sessionId) return json(res, 400, { error: 'Missing session_id' });
        if (!file) return json(res, 400, { error: 'Missing file' });

        const supabase = getSupabaseAdmin();
        const bucket = await resolveBucket(supabase);
        const originalName = file.originalFilename || 'photo.jpg';
        const extension = originalName.includes('.') ? originalName.split('.').pop().toLowerCase() : 'jpg';
        const objectPath = `mobile/${sessionId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
        const buffer = await fs.readFile(file.filepath);

        await uploadToBucket(supabase, bucket, objectPath, buffer, {
                contentType: file.mimetype || 'image/jpeg',
                upsert: false,
        });

        const { data: publicData } = supabase.storage
            .from(bucket)
            .getPublicUrl(objectPath);

        const { data: signedData } = await supabase.storage
            .from(bucket)
            .createSignedUrl(objectPath, 72 * 60 * 60);

        const url = signedData?.signedUrl || publicData.publicUrl;
        const { data, error } = await supabase
            .from('mobile_uploads')
            .insert({
                session_uuid: sessionId,
                url,
                public_id: `${bucket}/${objectPath}`,
            })
            .select()
            .single();

        if (error) throw error;

        return json(res, 201, {
            success: true,
            url: data.url,
            public_id: data.public_id,
        });
    } catch (error) {
        console.error('Mobile upload failed:', error);
        return json(res, 500, { error: error.message || 'Mobile upload failed' });
    }
}
