import fs from 'node:fs/promises';
import { formidable } from 'formidable';
import { getSupabaseAdmin, handleOptions, json, methodNotAllowed } from '../lib/supabase.js';
import { photosUseR2, putR2Object, r2PublicUrl } from '../lib/r2.js';
import { sniffMedia } from '../lib/uploads.js';

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
        if (req.method === 'POST') {
            const { files } = await parseForm(req);
            const file = firstValue(files.file);
            if (!file) return json(res, 400, { error: 'Missing file' });

            const buffer = await fs.readFile(file.filepath);
            // Loại file theo BYTE ĐẦU (lib/uploads.js). Trước 2026-10-08 đuôi lấy từ tên file, content-type
            // từ request -> host được .html/.svg trên domain ảnh công khai. Kiosk chỉ gửi JPEG/PNG + WebM/MP4.
            const media = sniffMedia(buffer);
            if (!media) return json(res, 415, { error: 'Chỉ nhận ảnh JPEG/PNG/WebP hoặc video WebM/MP4' });
            const extension = media.ext;
            // Đường dẫn có random -> khó đoán (public bucket + xoá sau 48h theo hạn album).
            const objectPath = `booth/${new Date().toISOString().slice(0, 10)}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
            const contentType = media.type;

            // Ưu tiên R2 (egress miễn phí) khi PHOTO_STORAGE=r2 + cấu hình đủ. Lỗi -> fallback Supabase
            // để KHÁCH luôn có ảnh. public_id 'r2:...' để cron cleanup xoá đúng nguồn.
            if (photosUseR2()) {
                try {
                    await putR2Object(objectPath, buffer, contentType);
                    return json(res, 201, {
                        success: true,
                        url: r2PublicUrl(objectPath),
                        public_id: `r2:${objectPath}`,
                    });
                } catch (r2err) {
                    console.error('R2 upload failed, fallback Supabase:', r2err?.message || r2err);
                }
            }

            // Supabase (mặc định / fallback)
            const supabase = getSupabaseAdmin();
            const bucket = await resolveBucket(supabase);
            await uploadToBucket(supabase, bucket, objectPath, buffer, { contentType, upsert: false });

            const { data: publicData } = supabase.storage.from(bucket).getPublicUrl(objectPath);
            const { data: signedData } = await supabase.storage.from(bucket).createSignedUrl(objectPath, 72 * 60 * 60);

            return json(res, 201, {
                success: true,
                url: signedData?.signedUrl || publicData.publicUrl,
                public_id: `${bucket}/${objectPath}`,
            });
        }

        if (req.method === 'GET') {
            const supabase = getSupabaseAdmin();
            const configuredBucket = process.env.SUPABASE_BUCKET || 'tomato';
            const bucket = await resolveBucket(supabase);
            const { data, error } = await supabase.storage.listBuckets();
            if (error) throw error;

            return json(res, 200, {
                configuredBucket,
                bucket,
                exists: Array.isArray(data) && data.some((item) => item.name === bucket),
                buckets: Array.isArray(data) ? data.map((item) => item.name) : [],
                photos_storage: photosUseR2() ? 'r2' : 'supabase',
            });
        }

        return methodNotAllowed(res);
    } catch (error) {
        console.error('Cloud upload failed:', error);
        return json(res, 500, { error: error.message || 'Cloud upload failed' });
    }
}
