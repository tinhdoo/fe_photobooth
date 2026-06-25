// useAIFilter.js
// Điều phối AI face filter cho 1 ảnh tĩnh: nạp filter JSON, nhận diện landmark -> geometry,
// render preview realtime khi đổi filter, export ảnh ở độ phân giải gốc.

import { useCallback, useEffect, useRef, useState } from 'react';
import { getFaceLandmarker } from '../engine/faceLandmarkerClient.js';
import { loadAsset } from '../engine/stickerRenderer.js';
import { buildFaceGeometry } from './geometry.js';
import { renderAIFilter } from './aiPipeline.js';

const AI_FILTERS_URL = '/face-filters/ai-filters.json';
const PREVIEW_MAX = 820; // cạnh dài tối đa khi preview cho mượt

async function loadAIFilters() {
    const res = await fetch(`${AI_FILTERS_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error('Không tải được ai-filters.json');
    const data = await res.json();
    return (Array.isArray(data.filters) ? data.filters : []).filter((f) => f && f.id);
}

function fitSize(w, h, max) {
    const scale = Math.min(1, max / Math.max(w, h));
    return { w: Math.round(w * scale), h: Math.round(h * scale) };
}

export function useAIFilter(imageUrl, { maxFaces = 5 } = {}) {
    const canvasRef = useRef(null);
    const imageElRef = useRef(null);
    const facesRef = useRef([]);

    const [filters, setFilters] = useState([]);
    const [selectedId, setSelectedId] = useState(null);
    const [status, setStatus] = useState('idle'); // idle|loading|detecting|ready|error
    const [faceCount, setFaceCount] = useState(0);
    const [error, setError] = useState('');

    useEffect(() => {
        let alive = true;
        loadAIFilters()
            .then((list) => { if (alive) setFilters(list); })
            .catch((e) => { if (alive) setError(e.message); });
        return () => { alive = false; };
    }, []);

    const drawPreview = useCallback((filter) => {
        const img = imageElRef.current;
        const canvas = canvasRef.current;
        if (!img || !canvas) return;
        const natW = img.naturalWidth || img.width;
        const natH = img.naturalHeight || img.height;
        const { w, h } = fitSize(natW, natH, PREVIEW_MAX);

        const out = filter
            ? renderAIFilter({ image: img, faces: facesRef.current, filter, width: w, height: h })
            : (() => { const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(img, 0, 0, w, h); return c; })();

        canvas.width = out.width;
        canvas.height = out.height;
        canvas.getContext('2d').drawImage(out, 0, 0);
    }, []);

    useEffect(() => {
        if (!imageUrl) return undefined;
        let alive = true;
        setStatus('loading');
        setError('');
        facesRef.current = [];
        setFaceCount(0);

        (async () => {
            try {
                const img = await loadAsset(imageUrl);
                if (!alive) return;
                imageElRef.current = img;
                drawPreview(null); // hiện ảnh gốc ngay

                setStatus('detecting');
                const landmarker = await getFaceLandmarker({ maxFaces });
                const aspect = (img.naturalWidth || img.width) / (img.naturalHeight || img.height);
                const result = landmarker.detect(img);
                if (!alive) return;
                facesRef.current = (result.faceLandmarks || [])
                    .map((lm) => buildFaceGeometry(lm, aspect))
                    .filter(Boolean);
                setFaceCount(facesRef.current.length);
                setStatus('ready');
            } catch (e) {
                if (!alive) return;
                console.error('[AIFilter] detect error', e);
                setError(e.message || 'Không nhận diện được khuôn mặt');
                setStatus('error');
            }
        })();

        return () => { alive = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [imageUrl, maxFaces]);

    useEffect(() => {
        if (status !== 'ready' && status !== 'error') return;
        const filter = filters.find((f) => f.id === selectedId) || null;
        drawPreview(filter);
    }, [selectedId, status, filters, drawPreview]);

    const selectFilter = useCallback((id) => setSelectedId(id), []);

    // Export ở ĐỘ PHÂN GIẢI GỐC.
    const exportBlob = useCallback(async (quality = 0.95) => {
        const img = imageElRef.current;
        if (!img) return null;
        const filter = filters.find((f) => f.id === selectedId) || null;
        const natW = img.naturalWidth || img.width;
        const natH = img.naturalHeight || img.height;
        const out = filter
            ? renderAIFilter({ image: img, faces: facesRef.current, filter, width: natW, height: natH })
            : img;
        const canvas = out instanceof HTMLCanvasElement ? out : (() => {
            const c = document.createElement('canvas'); c.width = natW; c.height = natH; c.getContext('2d').drawImage(img, 0, 0); return c;
        })();
        return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    }, [filters, selectedId]);

    return { canvasRef, filters, selectedId, selectFilter, status, faceCount, error, exportBlob };
}
