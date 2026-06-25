// icons.js — CRUD icon/sticker cho khách tự chọn. Lưu trong Supabase Storage thư mục `face-icons/`.
//   GET                      -> list [{id,name,url}]
//   POST (multipart file)    -> thêm icon
//   POST {action:'rename'}   -> đổi tên icon (cập nhật)
//   DELETE ?name=...         -> xoá icon
import fs from 'node:fs/promises';
import { formidable } from 'formidable';
import { getSupabaseAdmin, handleOptions, json } from '../lib/supabase.js';

export const config = { api: { bodyParser: false } };

const FOLDER = 'face-icons';

function parseForm(req) {
    const form = formidable({ multiples: false, maxFileSize: 30 * 1024 * 1024, keepExtensions: true });
    return new Promise((resolve, reject) => {
        form.parse(req, (error, fields, files) => (error ? reject(error) : resolve({ fields, files })));
    });
}

function firstValue(value) {
    return Array.isArray(value) ? value[0] : value;
}

function cleanName(value, fallback) {
    const base = String(value || '').split(/[\\/]/).pop();
    return base.replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 120) || fallback;
}

function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        let raw = '';
        req.on('data', (c) => { raw += c; });
        req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(e); } });
        req.on('error', reject);
    });
}

async function resolveBucket(supabase) {
    const configured = process.env.SUPABASE_BUCKET || 'tomato';
    const { data } = await supabase.storage.listBuckets();
    const buckets = Array.isArray(data) ? data : [];
    if (buckets.some((b) => b.name === configured)) return configured;
    if (buckets.some((b) => b.name === 'photobooth')) return 'photobooth';
    return buckets[0]?.name || configured;
}

function publicUrl(supabase, bucket, path, version) {
    const url = supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
    return `${url}${url.includes('?') ? '&' : '?'}v=${encodeURIComponent(version || Date.now())}`;
}

async function listIcons(res, supabase, bucket) {
    const { data, error } = await supabase.storage
        .from(bucket)
        .list(FOLDER, { limit: 1000, sortBy: { column: 'created_at', order: 'desc' } });
    if (error) throw error;
    const icons = (Array.isArray(data) ? data : [])
        .filter((it) => it.id && it.name && !it.name.startsWith('.'))
        .map((it) => ({
            id: it.name,
            name: it.name,
            url: publicUrl(supabase, bucket, `${FOLDER}/${it.name}`, it.updated_at || it.created_at),
            created_at: it.created_at,
        }));
    return json(res, 200, icons);
}

async function uploadIcon(req, res, supabase, bucket) {
    const { files } = await parseForm(req);
    const file = firstValue(files.file);
    if (!file) return json(res, 400, { error: 'Missing file' });
    const name = cleanName(file.originalFilename, `icon-${Date.now()}.png`);
    const buffer = await fs.readFile(file.filepath);
    const { error } = await supabase.storage
        .from(bucket)
        .upload(`${FOLDER}/${name}`, buffer, { contentType: file.mimetype || 'image/png', upsert: true });
    if (error) throw error;
    return json(res, 201, { id: name, name, url: publicUrl(supabase, bucket, `${FOLDER}/${name}`, Date.now()) });
}

async function renameIcon(req, res, supabase, bucket, body) {
    const from = cleanName(body.name, '');
    let to = cleanName(body.newName, '');
    if (!from || !to) return json(res, 400, { error: 'Missing name/newName' });
    // Giữ nguyên đuôi file gốc nếu tên mới chưa có đuôi.
    if (!to.includes('.') && from.includes('.')) to = `${to}.${from.split('.').pop()}`;
    const { error } = await supabase.storage.from(bucket).move(`${FOLDER}/${from}`, `${FOLDER}/${to}`);
    if (error) throw error;
    return json(res, 200, { id: to, name: to, url: publicUrl(supabase, bucket, `${FOLDER}/${to}`, Date.now()) });
}

async function deleteIcon(res, supabase, bucket, name) {
    const clean = cleanName(name, '');
    if (!clean) return json(res, 400, { error: 'Missing name' });
    const { error } = await supabase.storage.from(bucket).remove([`${FOLDER}/${clean}`]);
    if (error) throw error;
    return json(res, 200, { success: true });
}

export default async function handler(req, res) {
    if (handleOptions(req, res)) return;
    try {
        const supabase = getSupabaseAdmin();
        const bucket = await resolveBucket(supabase);
        await supabase.storage.updateBucket(bucket, { public: true }).catch(() => null);

        if (req.method === 'GET') return listIcons(res, supabase, bucket);
        if (req.method === 'POST') {
            const ct = String(req.headers['content-type'] || '');
            if (ct.includes('multipart/form-data')) return uploadIcon(req, res, supabase, bucket);
            const body = await readJsonBody(req);
            if (body.action === 'rename') return renameIcon(req, res, supabase, bucket, body);
            return json(res, 400, { error: 'Unsupported action' });
        }
        if (req.method === 'DELETE') return deleteIcon(res, supabase, bucket, req.query.name);

        res.setHeader('Allow', 'GET,POST,DELETE,OPTIONS');
        return json(res, 405, { error: 'Method not allowed' });
    } catch (error) {
        console.error('Icons API failed:', error);
        return json(res, 500, { error: error.message || 'Icons API failed' });
    }
}
