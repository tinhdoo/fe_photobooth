// useFaceFilter.js
// Hook điều phối toàn bộ luồng Face Filter cho MỘT ảnh tĩnh:
//  - nạp danh mục filter (JSON)
//  - load ảnh gốc + nhận diện khuôn mặt (chạy 1 lần, cache theo ảnh)
//  - vẽ lại canvas mỗi khi đổi filter (preview "thời gian thực")
//  - export ảnh kết quả

import { useCallback, useEffect, useRef, useState } from 'react';
import { loadFilters } from './filterRegistry.js';
import { loadAsset, renderToCanvas, canvasToBlob, canvasToDataUrl } from './engine/stickerRenderer.js';
import { detectFaces } from './engine/faceLandmarkerClient.js';

export function useFaceFilter(imageUrl, { maxFaces = 5 } = {}) {
    const canvasRef = useRef(null);
    const imageElRef = useRef(null);
    const facesRef = useRef([]);

    const [filters, setFilters] = useState([]);
    const [selectedId, setSelectedId] = useState(null); // null = không filter
    const [status, setStatus] = useState('idle'); // idle|loading|detecting|ready|error
    const [faceCount, setFaceCount] = useState(0);
    const [error, setError] = useState('');

    // 1) Nạp danh mục filter (1 lần).
    useEffect(() => {
        let alive = true;
        loadFilters()
            .then((list) => { if (alive) setFilters(list); })
            .catch((e) => { if (alive) setError(e.message || 'Lỗi tải filter'); });
        return () => { alive = false; };
    }, []);

    // 2) Load ảnh + nhận diện mặt khi đổi ảnh.
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

                // Vẽ ảnh gốc ngay để người dùng thấy preview trong lúc nhận diện.
                if (canvasRef.current) await renderToCanvas(canvasRef.current, img, [], null);

                setStatus('detecting');
                const { faces } = await detectFaces(img, { maxFaces });
                if (!alive) return;
                facesRef.current = faces;
                setFaceCount(faces.length);
                setStatus('ready');
            } catch (e) {
                if (!alive) return;
                console.error('[FaceFilter] detect error', e);
                setError(e.message || 'Không nhận diện được khuôn mặt');
                setStatus('error');
            }
        })();

        return () => { alive = false; };
    }, [imageUrl, maxFaces]);

    // 3) Vẽ lại khi đổi filter hoặc khi đã sẵn sàng.
    const redraw = useCallback(async () => {
        const canvas = canvasRef.current;
        const img = imageElRef.current;
        if (!canvas || !img) return;
        const filter = filters.find((f) => f.id === selectedId) || null;
        await renderToCanvas(canvas, img, facesRef.current, filter);
    }, [filters, selectedId]);

    useEffect(() => {
        if (status === 'ready' || status === 'error') redraw();
    }, [selectedId, status, redraw]);

    const selectFilter = useCallback((id) => setSelectedId(id), []);

    const exportDataUrl = useCallback(async (quality = 0.95) => {
        await redraw();
        return canvasRef.current ? canvasToDataUrl(canvasRef.current, quality) : null;
    }, [redraw]);

    const exportBlob = useCallback(async (quality = 0.95) => {
        await redraw();
        return canvasRef.current ? canvasToBlob(canvasRef.current, quality) : null;
    }, [redraw]);

    return {
        canvasRef,
        filters,
        selectedId,
        selectFilter,
        status,
        faceCount,
        error,
        exportDataUrl,
        exportBlob,
    };
}
