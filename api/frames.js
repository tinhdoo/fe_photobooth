import fs from 'node:fs/promises';
import { formidable } from 'formidable';
import { getSupabaseAdmin, handleOptions, json } from '../lib/supabase.js';

export const config = {
    api: {
        bodyParser: false,
    },
};

function parseForm(req) {
    const form = formidable({
        multiples: false,
        maxFileSize: 120 * 1024 * 1024,
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
    if (buckets.some((item) => item.name === 'photobooth')) return 'photobooth';
    if (buckets.length > 0) return buckets[0].name;
    return configuredBucket;
}

function cleanLayout(value) {
    return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
}

function cleanFilename(value) {
    const filename = String(value || 'frame.png').split(/[\\/]/).pop();
    return filename.replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 120) || `frame-${Date.now()}.png`;
}

function cleanFrameName(value) {
    if (!value) return '';
    const filename = String(value).split(/[\\/]/).pop();
    return filename.replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 120);
}

function cleanExtension(filename, mimetype) {
    const fromName = filename && filename.includes('.') ? filename.split('.').pop().toLowerCase() : '';
    if (fromName) return fromName.replace(/[^a-z0-9]/g, '') || 'bin';
    if (mimetype?.includes('png')) return 'png';
    if (mimetype?.includes('jpeg') || mimetype?.includes('jpg')) return 'jpg';
    if (mimetype?.includes('webp')) return 'webp';
    return 'bin';
}

function publicUrl(supabase, bucket, objectPath) {
    return supabase.storage.from(bucket).getPublicUrl(objectPath).data.publicUrl;
}

function withVersion(url, version) {
    const safeVersion = encodeURIComponent(String(version || Date.now()));
    return `${url}${url.includes('?') ? '&' : '?'}v=${safeVersion}`;
}

async function bumpFrameRevision(supabase, layout) {
    const now = new Date().toISOString();
    const { data: row, error: readError } = await supabase
        .from('app_configs')
        .select('config')
        .eq('key', 'app')
        .maybeSingle();

    if (readError && !/Could not find the table|schema cache|does not exist/i.test(readError.message || '')) {
        throw readError;
    }

    const current = row?.config && typeof row.config === 'object' ? row.config : {};
    const next = {
        ...current,
        frame_revision: Date.now(),
        frame_revision_layout: layout || current.frame_revision_layout || '',
        updated_at: now,
    };

    const { error } = await supabase
        .from('app_configs')
        .upsert({
            key: 'app',
            config: next,
            updated_at: now,
        }, { onConflict: 'key' });

    if (error && !/Could not find the table|schema cache|does not exist/i.test(error.message || '')) {
        throw error;
    }
}

function framePath(layout, name) {
    return `frames/${layout}/${name}`;
}

function configPath(layout, name) {
    return `frames/${layout}/${name}.config.json`;
}

function iconPrefix(layout, name) {
    return `frames/${layout}/${name}.icon.`;
}

async function listFrames(req, res, supabase, bucket) {
    const layout = cleanLayout(req.query.layout);
    if (!layout) return json(res, 400, { error: 'Missing layout' });

    const { data, error } = await supabase.storage
        .from(bucket)
        .list(`frames/${layout}`, {
            limit: 1000,
            sortBy: { column: 'created_at', order: 'desc' },
        });

    if (error) throw error;

    const files = Array.isArray(data) ? data : [];
    const icons = new Map();
    files.forEach((item) => {
        const name = item.name || '';
        const marker = '.icon.';
        const markerIndex = name.indexOf(marker);
        if (markerIndex > 0) {
            icons.set(name.slice(0, markerIndex), name);
        }
    });

    const frames = files
        .filter((item) => {
            const name = item.name || '';
            return item.id && !name.endsWith('.config.json') && !name.includes('.icon.');
        })
        .map((item) => {
            const name = item.name;
            const objectPath = framePath(layout, name);
            const iconName = icons.get(name);
            const frameVersion = item.updated_at || item.created_at || Date.now();
            const iconItem = iconName ? files.find((file) => file.name === iconName) : null;
            const iconVersion = iconItem?.updated_at || iconItem?.created_at || frameVersion;
            const frameUrl = withVersion(publicUrl(supabase, bucket, objectPath), frameVersion);
            return {
                id: `${layout}-${name}`,
                name,
                layout,
                url: frameUrl,
                image: frameUrl,
                icon_url: iconName ? withVersion(publicUrl(supabase, bucket, framePath(layout, iconName)), iconVersion) : null,
                created_at: item.created_at,
                updated_at: item.updated_at,
            };
        });

    return json(res, 200, frames);
}

async function uploadFrame(req, res, supabase, bucket) {
    const { fields, files } = await parseForm(req);
    const file = firstValue(files.file);
    const layout = cleanLayout(firstValue(fields.layout) || req.query.layout);

    if (!file) return json(res, 400, { error: 'Missing file' });
    if (!layout) return json(res, 400, { error: 'Missing layout' });

    const filename = cleanFilename(file.originalFilename);
    const objectPath = framePath(layout, filename);
    const buffer = await fs.readFile(file.filepath);

    const { data: exists } = await supabase.storage
        .from(bucket)
        .list(`frames/${layout}`, { search: filename, limit: 1 });

    if (Array.isArray(exists) && exists.some((item) => item.name === filename)) {
        return json(res, 409, { error: 'Frame already exists' });
    }

    const { error } = await supabase.storage
        .from(bucket)
        .upload(objectPath, buffer, {
            contentType: file.mimetype || 'image/png',
            upsert: false,
        });

    if (error) throw error;

    await bumpFrameRevision(supabase, layout);

    return json(res, 201, {
        id: `${layout}-${filename}`,
        name: filename,
        layout,
        url: withVersion(publicUrl(supabase, bucket, objectPath), Date.now()),
    });
}

async function getConfig(req, res, supabase, bucket, layout, name) {
    const { data, error } = await supabase.storage
        .from(bucket)
        .download(configPath(layout, name));

    if (error) return json(res, 200, { borderRadius: 0, boxes: [] });

    try {
        return json(res, 200, JSON.parse(await data.text()));
    } catch {
        return json(res, 200, { borderRadius: 0, boxes: [] });
    }
}

async function saveConfig(req, res, supabase, bucket, layout, name) {
    const body = await readJsonBody(req);
    const payload = Buffer.from(JSON.stringify(body || {}, null, 2), 'utf8');
    const { error } = await supabase.storage
        .from(bucket)
        .upload(configPath(layout, name), payload, {
            contentType: 'application/json',
            upsert: true,
        });

    if (error) throw error;
    await bumpFrameRevision(supabase, layout);
    return json(res, 200, { success: true });
}

function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        let raw = '';
        req.on('data', (chunk) => {
            raw += chunk;
        });
        req.on('end', () => {
            if (!raw) return resolve({});
            try {
                resolve(JSON.parse(raw));
            } catch (error) {
                reject(error);
            }
        });
        req.on('error', reject);
    });
}

async function uploadIcon(req, res, supabase, bucket, layout, name) {
    const { files } = await parseForm(req);
    const file = firstValue(files.file);
    if (!file) return json(res, 400, { error: 'Missing file' });

    const extension = cleanExtension(file.originalFilename, file.mimetype);
    const objectPath = `${iconPrefix(layout, name)}${extension}`;
    const buffer = await fs.readFile(file.filepath);

    const { error } = await supabase.storage
        .from(bucket)
        .upload(objectPath, buffer, {
            contentType: file.mimetype || 'image/png',
            upsert: true,
        });

    if (error) throw error;
    await bumpFrameRevision(supabase, layout);
    return json(res, 200, { success: true, icon_url: withVersion(publicUrl(supabase, bucket, objectPath), Date.now()) });
}

async function deleteFrame(req, res, supabase, bucket, layout, name) {
    const { data } = await supabase.storage
        .from(bucket)
        .list(`frames/${layout}`, { search: `${name}.icon.`, limit: 20 });

    const paths = [framePath(layout, name), configPath(layout, name)];
    if (Array.isArray(data)) {
        data.forEach((item) => {
            if ((item.name || '').startsWith(`${name}.icon.`)) paths.push(framePath(layout, item.name));
        });
    }

    const { error } = await supabase.storage.from(bucket).remove(paths);
    if (error) throw error;

    await bumpFrameRevision(supabase, layout);

    return json(res, 200, { success: true });
}

export default async function handler(req, res) {
    if (handleOptions(req, res)) return;

    try {
        const supabase = getSupabaseAdmin();
        const bucket = await resolveBucket(supabase);
        await supabase.storage.updateBucket(bucket, { public: true }).catch(() => null);

        const layout = cleanLayout(req.query.layout);
        const name = cleanFrameName(req.query.name || '');
        const resource = String(req.query.resource || '').trim();

        if (req.method === 'GET') {
            if (resource === 'config') return getConfig(req, res, supabase, bucket, layout, name);
            return listFrames(req, res, supabase, bucket);
        }

        if (req.method === 'POST') {
            if (resource === 'config') return saveConfig(req, res, supabase, bucket, layout, name);
            if (resource === 'icon') return uploadIcon(req, res, supabase, bucket, layout, name);
            return uploadFrame(req, res, supabase, bucket);
        }

        if (req.method === 'DELETE') {
            if (!layout || !name) return json(res, 400, { error: 'Missing layout or name' });
            return deleteFrame(req, res, supabase, bucket, layout, name);
        }

        res.setHeader('Allow', 'GET,POST,DELETE,OPTIONS');
        return json(res, 405, { error: 'Method not allowed' });
    } catch (error) {
        console.error('Frames API failed:', error);
        return json(res, 500, { error: error.message || 'Frames API failed' });
    }
}
