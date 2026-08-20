import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { AlertCircle, Download, Film, Image as ImageIcon } from 'lucide-react';
import { useWorkflow } from '../context/WorkflowContext';
import { API_URL, CLOUD_API_URL } from '../config/api';

const pad2 = (value) => String(value).padStart(2, '0');

const getAlbumFilenameBase = (session) => {
    const date = session?.created_at ? new Date(session.created_at) : new Date();
    const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
    const yyyy = safeDate.getFullYear();
    const mm = pad2(safeDate.getMonth() + 1);
    const dd = pad2(safeDate.getDate());
    const hh = pad2(safeDate.getHours());
    const min = pad2(safeDate.getMinutes());

    return `TomatoPhotobooth_${yyyy}-${mm}-${dd}_${hh}-${min}`;
};

const getDownloadFilename = (session, extension, suffix = '') => {
    const cleanSuffix = suffix ? `_${suffix}` : '';
    return `${getAlbumFilenameBase(session)}${cleanSuffix}.${extension}`;
};

const getPhotoUrl = (photo) => {
    if (!photo) return '';
    return typeof photo === 'string' ? photo : photo.url;
};

const getVideoUrl = (photo) => {
    if (!photo || typeof photo === 'string') return '';
    return photo.video_url || '';
};

const isStripLayout = (session) => {
    const layoutId = session?.layout_id || session?.meta_data?.layout_id || '';
    return layoutId === 'strip_3' || layoutId === 'strip_4' || layoutId.includes('strip');
};

// Strip NGANG (Layout 7): 2 strip xếp CHỒNG DỌC (không phải cạnh nhau như strip dọc).
const isStripHorizontalLayout = (session) => {
    const layoutId = session?.layout_id || session?.meta_data?.layout_id || '';
    return layoutId.includes('strip_h') || layoutId.includes('strip_horizontal');
};

const isQuarterTurn = (rotation = 0) => {
    const normalized = Math.abs(Number(rotation) || 0) % 180;
    return normalized === 90;
};

const getPosition = (positions, index) => {
    const position = positions?.[index];
    return {
        x: Number.isFinite(position?.x) ? position.x : 0.5,
        y: Number.isFinite(position?.y) ? position.y : 0.5
    };
};

const resolveAssetUrl = (url) => {
    if (!url) return '';
    if (/^https?:\/\//i.test(url) || url.startsWith('blob:') || url.startsWith('data:')) return url;
    return `${window.location.origin}${url.startsWith('/') ? url : `/${url}`}`;
};

// Fetch-cors cho ảnh R2: r2.dev cache KHÔNG vary theo Origin -> khi <img> (không gửi Origin) tải
// trước, cache lưu bản THIẾU header ACAO -> fetch cors sau bị chặn CORS (ghép 2 strip / tải file
// thất bại). Dùng cache key RIÊNG (?cors=1) cho các fetch cors (luôn gửi Origin) -> luôn có ACAO.
// Chỉ áp cho R2 (r2.dev); Supabase/blob giữ nguyên.
const corsAssetUrl = (url) => {
    const u = resolveAssetUrl(url);
    if (/r2\.dev/i.test(u)) return `${u}${u.includes('?') ? '&' : '?'}cors=1`;
    return u;
};

const fetchAsObjectUrl = async (url) => {
    const response = await fetch(corsAssetUrl(url), { mode: 'cors' });
    if (!response.ok) throw new Error(`Không tải được tài nguyên: ${url}`);
    const blob = await response.blob();
    return URL.createObjectURL(blob);
};

const waitForImage = (src) => new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
});

const waitForVideo = (src) => new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.onloadedmetadata = () => resolve(video);
    video.onerror = reject;
    video.src = src;
    video.load();
});

const drawCoverMedia = (ctx, media, width, height, position = { x: 0.5, y: 0.5 }) => {
    const sourceWidth = media.videoWidth || media.naturalWidth || media.width;
    const sourceHeight = media.videoHeight || media.naturalHeight || media.height;
    if (!sourceWidth || !sourceHeight || !width || !height) return;

    const scale = Math.max(width / sourceWidth, height / sourceHeight);
    const drawWidth = sourceWidth * scale;
    const drawHeight = sourceHeight * scale;
    const drawX = -width / 2 - (drawWidth - width) * position.x;
    const drawY = -height / 2 - (drawHeight - height) * position.y;

    ctx.drawImage(media, drawX, drawY, drawWidth, drawHeight);
};

const getMediaRecorderMimeType = () => {
    // Ưu tiên MP4/H.264: iOS (Safari) chỉ xem & lưu được MP4 vào Photos, không hỗ trợ
    // WebM. Chrome mới cũng ghi được MP4. Trình duyệt cũ rơi xuống WebM.
    const candidates = [
        'video/mp4;codecs=avc1',
        'video/mp4',
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        'video/webm'
    ];
    return candidates.find((type) => window.MediaRecorder?.isTypeSupported(type)) || '';
};

const recordCanvas = (canvas, drawFrame, durationMs = 7000, fps = 24) => new Promise((resolve, reject) => {
    if (!window.MediaRecorder || !canvas.captureStream) {
        reject(new Error('Trình duyệt không hỗ trợ ghi video canvas.'));
        return;
    }

    const stream = canvas.captureStream(fps);
    const mimeType = getMediaRecorderMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks = [];
    let animationId = null;
    let startedAt = 0;

    recorder.ondataavailable = (event) => {
        if (event.data?.size) chunks.push(event.data);
    };
    recorder.onerror = () => {
        if (animationId) cancelAnimationFrame(animationId);
        reject(recorder.error || new Error('Không thể ghi video.'));
    };
    recorder.onstop = () => {
        if (animationId) cancelAnimationFrame(animationId);
        stream.getTracks().forEach((track) => track.stop());
        // recorder.mimeType phản ánh ĐÚNG định dạng recorder thực dùng (kể cả khi tạo với
        // undefined -> Safari mặc định MP4). Tránh dán nhãn nhầm MP4 thành webm.
        const actualType = recorder.mimeType || mimeType || 'video/webm';
        resolve(new Blob(chunks, { type: actualType }));
    };

    const tick = (time) => {
        if (!startedAt) startedAt = time;
        drawFrame();
        if (time - startedAt >= durationMs) {
            recorder.stop();
            return;
        }
        animationId = requestAnimationFrame(tick);
    };

    recorder.start();
    animationId = requestAnimationFrame(tick);
});

const FrameMotionPreview = ({ frameUrl, frameConfig, photos, positions, sizerUrl }) => {
    const boxes = Array.isArray(frameConfig?.boxes) ? frameConfig.boxes : [];
    // Cho phép motion KHÔNG cần frame overlay: chỉ cần có ô (boxes) + ảnh/video. Frame chỉ là
    // lớp trang trí phủ lên; layout không có ảnh khung (frame_url null) vẫn phát motion trong ô.
    if (boxes.length === 0 || photos.length === 0) return null;

    let implicitPhotoIndex = 0;

    return (
        <div className="relative mx-auto w-full max-w-[680px] overflow-hidden bg-white shadow-sm">
            {/* Ảnh định kích thước: ưu tiên dùng composite (ảnh ghép) để khung motion có ĐÚNG
                tỉ lệ như phần "Ảnh đã ghép"; khung overlay vẫn dùng frameUrl. */}
            <img
                src={sizerUrl || frameUrl}
                alt=""
                aria-hidden="true"
                className="block h-auto w-full opacity-0"
                loading="eager"
                decoding="async"
            />

            <div className="absolute inset-0 z-0">
                {boxes.map((box, index) => {
                    if (box.type === 'qr') return null;

                    const targetIndex = box.photoIndex !== undefined
                        ? box.photoIndex
                        : implicitPhotoIndex % photos.length;
                    if (box.photoIndex === undefined) implicitPhotoIndex += 1;

                    const photo = photos[targetIndex];
                    const photoUrl = getPhotoUrl(photo);
                    const videoUrl = getVideoUrl(photo);
                    if (!photoUrl && !videoUrl) return null;

                    const position = getPosition(positions, targetIndex);
                    const innerRotation = Number(box.innerRotation) || 0;
                    const quarterTurn = isQuarterTurn(innerRotation);

                    return (
                        <div
                            key={`motion-box-${index}`}
                            className="absolute overflow-hidden bg-[#F6E6C9]"
                            style={{
                                left: `${box.x}%`,
                                top: `${box.y}%`,
                                width: `${box.width}%`,
                                height: `${box.height}%`,
                                transform: `rotate(${Number(box.rotation) || 0}deg)`,
                                borderRadius: `${frameConfig?.borderRadius || 0}px`,
                                containerType: 'size'
                            }}
                        >
                            <div
                                className="absolute left-1/2 top-1/2"
                                style={{
                                    width: quarterTurn ? '100cqh' : '100%',
                                    height: quarterTurn ? '100cqw' : '100%',
                                    transform: `translate(-50%, -50%) rotate(${innerRotation}deg)`
                                }}
                            >
                                {videoUrl ? (
                                    <video
                                        src={videoUrl}
                                        autoPlay
                                        muted
                                        loop
                                        playsInline
                                        preload="metadata"
                                        className="h-full w-full object-cover"
                                        style={{ objectPosition: `${position.x * 100}% ${position.y * 100}%`, transform: 'scaleX(-1)' }}
                                    />
                                ) : (
                                    <img
                                        src={photoUrl}
                                        alt=""
                                        className="h-full w-full object-cover"
                                        style={{ objectPosition: `${position.x * 100}% ${position.y * 100}%` }}
                                        loading="lazy"
                                        decoding="async"
                                    />
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            {frameUrl && (
                <img
                    src={frameUrl}
                    alt="Motion trong khung"
                    className="pointer-events-none absolute inset-0 z-10 h-full w-full object-fill"
                    loading="eager"
                    decoding="async"
                />
            )}
        </div>
    );
};

const ALBUM_BG_STYLE = {
    backgroundImage: "url('/background.png')",
    backgroundColor: '#FFF8E7',
    backgroundSize: 'cover',
    backgroundPosition: 'center top',
    backgroundRepeat: 'no-repeat',
    backgroundAttachment: 'fixed'
};

// ====== LINK MẠNG XÃ HỘI (điền URL vào đây; để '' thì icon đó KHÔNG hiện) ======
const SOCIAL_LINKS = {
    facebook: 'https://www.facebook.com/profile.php?id=61583398170126',
    instagram: 'https://www.instagram.com/tomato.photobooth',
    tiktok: 'https://www.tiktok.com/@tomato.photobooth',
};

// Icon thương hiệu (SVG inline, không phụ thuộc thư viện) — TikTok không có trong lucide.
const SOCIAL_ICONS = {
    facebook: <path d="M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z" />,
    instagram: <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z" />,
    tiktok: <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" />,
};

// Footer mạng xã hội: chỉ hiện icon nào có link. Không có link nào -> không render gì.
const SocialFooter = ({ className = '' }) => {
    const items = Object.entries(SOCIAL_LINKS).filter(([, url]) => url && url.trim());
    if (items.length === 0) return null;
    return (
        <div className={`flex items-center justify-center gap-4 ${className}`}>
            {items.map(([key, url]) => (
                <a
                    key={key}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={key}
                    className="flex h-11 w-11 items-center justify-center rounded-full bg-[#e63946] text-white shadow-sm transition-transform active:scale-90 hover:bg-[#c1121f]"
                >
                    <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5" aria-hidden="true">
                        {SOCIAL_ICONS[key]}
                    </svg>
                </a>
            ))}
        </div>
    );
};

const ViewPage = () => {
    const { id } = useParams();
    const { configs } = useWorkflow();
    const logoUrl = configs?.logo_main || '/logo_tomato.png';
    const [session, setSession] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null); // { title, message } | null
    const [downloading, setDownloading] = useState(false);
    const [errorDialog, setErrorDialog] = useState(null);
    const [motionVideo, setMotionVideo] = useState(null); // { blob, filename } sau khi tạo xong
    const [combined, setCombined] = useState(null); // { url, blob } — 2 strip GHÉP thành 1 ảnh (chỉ layout strip)
    const [combineFailed, setCombineFailed] = useState(false); // ghép strip lỗi -> hiện thẳng composite gốc
    // Album đã có ảnh ghép nhưng ảnh lẻ/video CHƯA về (booth đang upload nền) -> báo cho khách biết
    // "đang tải thêm" để KHÔNG tưởng chỉ có mỗi ảnh ghép rồi bỏ đi.
    const [loadingMore, setLoadingMore] = useState(false);

    useEffect(() => {
        let cancelled = false;
        let pollTimer = null;
        let attempts = 0;
        const MAX_POLLS = 12; // ~30s (2.5s/lần) chờ ảnh lẻ + video upload nền ở booth xong

        // isPoll = true: lần gọi lại nền -> KHÔNG bật loading / không báo lỗi phá album đang hiện.
        const fetchSession = async (isPoll = false) => {
            if (!isPoll) { setLoading(true); setError(null); }
            try {
                const res = await axios.get(`${CLOUD_API_URL}/api/sessions`, {
                    params: { id }
                });
                const data = res.data;

                if (cancelled) return;

                const hasComposite = Boolean(data.composite_url);
                const hasPhotos = Array.isArray(data.photos) && data.photos.some((photo) => getPhotoUrl(photo));

                if (data.status === 'expired' || (!hasComposite && !hasPhotos)) {
                    if (!isPoll) setError({ title: 'Oops! Liên kết đã hết hạn 😿', message: 'Hy vọng sẽ sớm gặp lại bạn tại Tomato Photobooth! ❤️' });
                    return;
                }

                setSession(data);

                // Album đã có ảnh ghép nhưng ảnh lẻ/video CHƯA về (booth đang upload nền) -> poll
                // bổ sung tới khi có, hoặc hết MAX_POLLS thì thôi (giữ ảnh ghép đang hiện).
                if (hasComposite && !hasPhotos && attempts < MAX_POLLS) {
                    setLoadingMore(true); // báo cho khách: còn ảnh lẻ + video đang tải
                    attempts += 1;
                    pollTimer = setTimeout(() => fetchSession(true), 2500);
                } else {
                    setLoadingMore(false); // đã có ảnh lẻ, hoặc đã chờ hết -> tắt báo
                }
            } catch (err) {
                console.error('Failed to load album', err);
                if (!cancelled && !isPoll) {
                    setError({ title: 'Rất tiếc', message: 'Không thể tải album. Vui lòng thử lại hoặc quay lại booth để được hỗ trợ.' });
                }
            } finally {
                if (!cancelled && !isPoll) setLoading(false);
            }
        };

        if (id) fetchSession();
        return () => {
            cancelled = true;
            if (pollTimer) clearTimeout(pollTimer);
        };
    }, [id]);

    const photos = useMemo(() => session?.photos || [], [session]);
    const hasVideos = photos.some((photo) => getVideoUrl(photo));
    const strip = isStripLayout(session);
    const stripHorizontal = isStripHorizontalLayout(session);
    const frameUrl = session?.meta_data?.frame_url || '';
    const frameConfig = session?.meta_data?.frame_config || null;
    const photoPositions = session?.meta_data?.photo_positions || [];
    // Motion chỉ CẦN có video + ô (boxes) — KHÔNG bắt buộc frame overlay. Nhờ vậy session cũ lỡ
    // mất frame_url vẫn phát được motion trong ô (frame chỉ là lớp trang trí phủ lên nếu có).
    const canRenderMotionFrame = hasVideos && Array.isArray(frameConfig?.boxes) && frameConfig.boxes.length > 0;

    // GHÉP 2 strip thành 1 ẢNH DUY NHẤT (nguyên tờ 4x6) để hiển thị + tải về.
    // composite_url là 1 strip đơn (1:3). Layout strip in ra 2 strip/tờ nên bản digital cũng
    // ghép 2 bản: strip dọc -> cạnh nhau; strip ngang -> chồng dọc. Layout khác giữ nguyên.
    useEffect(() => {
        const src = session?.composite_url;
        setCombineFailed(false);
        if (!src || !strip) { setCombined(null); return undefined; }
        let cancelled = false;
        let createdUrl = null;
        (async () => {
            try {
                const objUrl = await fetchAsObjectUrl(src);
                const img = await waitForImage(objUrl);
                const w = img.naturalWidth || img.width;
                const h = img.naturalHeight || img.height;
                const canvas = document.createElement('canvas');
                canvas.width = stripHorizontal ? w : w * 2;
                canvas.height = stripHorizontal ? h * 2 : h;
                const ctx = canvas.getContext('2d');
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0, w, h);
                if (stripHorizontal) ctx.drawImage(img, 0, h, w, h);
                else ctx.drawImage(img, w, 0, w, h);
                URL.revokeObjectURL(objUrl);
                const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.95));
                if (cancelled || !blob) return;
                createdUrl = URL.createObjectURL(blob);
                setCombined({ url: createdUrl, blob });
            } catch (e) {
                console.warn('Ghép 2 strip thất bại, dùng ảnh gốc:', e);
                if (!cancelled) { setCombined(null); setCombineFailed(true); }
            }
        })();
        return () => { cancelled = true; if (createdUrl) URL.revokeObjectURL(createdUrl); };
    }, [session?.composite_url, strip, stripHorizontal]);

    // Ảnh ghép dùng để HIỂN THỊ + TẢI:
    //  - strip: dùng bản ĐÃ GHÉP (blob). KHÔNG hiện composite gốc trong lúc chờ ghép để tránh tải
    //    ảnh 2 lần (r2.dev bị throttle) — chờ ghép xong; chỉ khi ghép LỖI mới rơi về composite gốc.
    //  - layout khác: composite gốc.
    const displayCompositeUrl = strip
        ? (combined?.url || (combineFailed ? session?.composite_url : null))
        : session?.composite_url;

    const downloadUrl = async (url, filename) => {
        if (!url) return;

        try {
            const response = await fetch(corsAssetUrl(url), { mode: 'cors' });
            const blob = await response.blob();
            const objectUrl = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = objectUrl;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(objectUrl);
        } catch (downloadError) {
            console.warn('Download fallback opened in new tab', downloadError);
            window.open(url, '_blank', 'noopener,noreferrer');
        }
    };

    // Chỉ ưu tiên Web Share trên điện thoại/máy tính bảng (để ảnh vào thẳng album).
    // Trên PC, Chrome/Edge cũng hỗ trợ navigator.share nhưng nó bung "bảng chia sẻ"
    // của Windows thay vì tải file -> gây khó chịu. PC luôn tải thẳng về Downloads.
    const isMobileDevice = () => {
        if (typeof navigator === 'undefined') return false;
        const ua = navigator.userAgent || '';
        if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return true;
        // iPadOS 13+ báo là "Macintosh" nhưng có cảm ứng.
        if (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1) return true;
        return false;
    };

    // Có hỗ trợ chia sẻ trực tiếp file (đường vào album Ảnh) không?
    const canShareFiles = (files) => {
        try {
            return typeof navigator !== 'undefined'
                && typeof navigator.canShare === 'function'
                && navigator.canShare({ files });
        } catch {
            return false;
        }
    };

    const fetchAsFile = async (url, filename) => {
        const response = await fetch(corsAssetUrl(url), { mode: 'cors' });
        const blob = await response.blob();
        const type = blob.type || (/\.mp4$/i.test(filename) ? 'video/mp4' : 'image/jpeg');
        return new File([blob], filename, { type });
    };

    // Lưu ảnh: trên điện thoại ưu tiên Web Share API để ảnh vào thẳng album Ảnh/
    // Thư viện (qua bảng chia sẻ -> "Lưu ảnh"). Máy tính / trình duyệt không hỗ trợ
    // thì tải về như cũ (vào Downloads).
    const saveImages = async (items) => {
        const valid = (items || []).filter((it) => it && it.url);
        if (valid.length === 0) return;

        try {
            const files = await Promise.all(valid.map((it) => fetchAsFile(it.url, it.filename)));
            if (isMobileDevice() && canShareFiles(files)) {
                await navigator.share({ files });
                return;
            }
        } catch (shareError) {
            if (shareError?.name === 'AbortError') return; // khách bấm Hủy -> dừng, không tải
            console.warn('Share failed, fallback to download', shareError);
        }

        // Fallback: tải về như cũ.
        for (const it of valid) {
            await downloadUrl(it.url, it.filename);
            await new Promise((resolve) => setTimeout(resolve, 180));
        }
    };

    // Lưu 1 blob (đã có sẵn trong bộ nhớ, vd video motion vừa ghi): ưu tiên chia sẻ
    // vào album, không hỗ trợ thì tải về.
    const saveBlob = async (blob, filename) => {
        if (!blob) return;
        // Suy type theo đuôi file cho các định dạng đã biết (iOS nhận dạng qua đây để
        // hiện "Lưu video/ảnh"); chỉ dùng blob.type khi đuôi lạ. Bỏ ";codecs=...".
        const fileExt = (filename.split('.').pop() || '').toLowerCase();
        const extType = { mp4: 'video/mp4', webm: 'video/webm', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' }[fileExt];
        const type = (extType || blob.type || 'application/octet-stream').split(';')[0];
        const file = new File([blob], filename, { type });

        try {
            if (isMobileDevice() && canShareFiles([file])) {
                await navigator.share({ files: [file] });
                return;
            }
        } catch (shareError) {
            if (shareError?.name === 'AbortError') return;
            console.warn('Share blob failed, fallback to download', shareError);
        }

        const objectUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
    };

    const downloadAll = async () => {
        if (!session || downloading) return;

        setDownloading(true);
        const files = [];

        if (session.composite_url) {
            // strip -> ảnh đã ghép 2 strip (nguyên tờ 4x6); layout khác -> composite gốc.
            files.push({
                url: displayCompositeUrl,
                filename: getDownloadFilename(session, 'jpg')
            });
        }

        photos.forEach((photo, index) => {
            const photoUrl = getPhotoUrl(photo);
            if (photoUrl) {
                files.push({
                    url: photoUrl,
                    filename: getDownloadFilename(session, 'jpg', `anh-${pad2(index + 1)}`)
                });
            }
        });

        await saveImages(files);

        setDownloading(false);
    };

    const downloadVideos = async () => {
        if (!session || downloading) return;

        setDownloading(true);

        const objectUrls = [];
        try {
            if (!canRenderMotionFrame) return;

            // Ảnh để LẤY KÍCH THƯỚC (tỉ lệ strip): ưu tiên frame overlay; nếu layout không có frame
            // thì dùng ảnh ghép (composite) để canh đúng tỉ lệ. frameImage (overlay) chỉ có khi có frame.
            const sizerSrc = frameUrl || session.composite_url;
            const sizerObjectUrl = await fetchAsObjectUrl(sizerSrc);
            objectUrls.push(sizerObjectUrl);
            const sizerImage = await waitForImage(sizerObjectUrl);
            const frameImage = frameUrl ? sizerImage : null;

            const mediaItems = await Promise.all(photos.map(async (photo) => {
                const videoUrl = getVideoUrl(photo);
                const photoUrl = getPhotoUrl(photo);

                if (videoUrl) {
                    const objectUrl = await fetchAsObjectUrl(videoUrl);
                    objectUrls.push(objectUrl);
                    const video = await waitForVideo(objectUrl);
                    try {
                        video.currentTime = 0;
                        await video.play();
                    } catch {
                        // Drawing the first frame still works if autoplay is blocked.
                    }
                    return { type: 'video', media: video, duration: Number.isFinite(video.duration) ? video.duration : 7 };
                }

                if (photoUrl) {
                    const objectUrl = await fetchAsObjectUrl(photoUrl);
                    objectUrls.push(objectUrl);
                    return { type: 'image', media: await waitForImage(objectUrl), duration: 7 };
                }

                return null;
            }));

            // Motion = 2 strip cạnh nhau (nguyên tờ 4x6), khớp với ảnh ghép tải về.
            const repeatCount = strip ? 2 : 1;
            const frameWidth = sizerImage.naturalWidth || sizerImage.width;
            const frameHeight = sizerImage.naturalHeight || sizerImage.height;
            // Strip ngang -> nhân đôi theo CHIỀU CAO (chồng dọc); strip dọc -> theo chiều rộng.
            const scale = stripHorizontal
                ? Math.min(1, 1080 / Math.max(frameWidth, frameHeight * repeatCount))
                : Math.min(1, 1080 / Math.max(frameWidth * repeatCount, frameHeight));
            const stripWidth = Math.max(2, Math.round(frameWidth * scale / 2) * 2);
            const stripHeight = Math.max(2, Math.round(frameHeight * scale / 2) * 2);

            const canvas = document.createElement('canvas');
            canvas.width = stripHorizontal ? stripWidth : stripWidth * repeatCount;
            canvas.height = stripHorizontal ? stripHeight * repeatCount : stripHeight;
            const ctx = canvas.getContext('2d', { alpha: false });
            const boxes = Array.isArray(frameConfig?.boxes) ? frameConfig.boxes : [];

            const drawOneStrip = (offsetX, offsetY) => {
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(offsetX, offsetY, stripWidth, stripHeight);

                let implicitPhotoIndex = 0;
                boxes.forEach((box) => {
                    if (box.type === 'qr') return;

                    const targetIndex = box.photoIndex !== undefined
                        ? box.photoIndex
                        : implicitPhotoIndex % mediaItems.length;
                    if (box.photoIndex === undefined) implicitPhotoIndex += 1;

                    const mediaItem = mediaItems[targetIndex];
                    if (!mediaItem?.media) return;

                    const boxX = offsetX + (Number(box.x) || 0) / 100 * stripWidth;
                    const boxY = offsetY + (Number(box.y) || 0) / 100 * stripHeight;
                    const boxWidth = (Number(box.width) || 0) / 100 * stripWidth;
                    const boxHeight = (Number(box.height) || 0) / 100 * stripHeight;
                    if (boxWidth <= 0 || boxHeight <= 0) return;

                    const position = getPosition(photoPositions, targetIndex);
                    const innerRotation = Number(box.innerRotation) || 0;
                    const quarterTurn = isQuarterTurn(innerRotation);
                    const innerWidth = quarterTurn ? boxHeight : boxWidth;
                    const innerHeight = quarterTurn ? boxWidth : boxHeight;

                    ctx.save();
                    ctx.translate(boxX + boxWidth / 2, boxY + boxHeight / 2);
                    ctx.rotate(((Number(box.rotation) || 0) * Math.PI) / 180);
                    ctx.beginPath();
                    ctx.rect(-boxWidth / 2, -boxHeight / 2, boxWidth, boxHeight);
                    ctx.clip();

                    ctx.save();
                    ctx.rotate((innerRotation * Math.PI) / 180);
                    // Video quay RAW -> lật gương khi xuất cho khớp ảnh chụp + bản preview (CSS scaleX(-1)).
                    // Ảnh tĩnh đã mirror sẵn nên KHÔNG lật.
                    if (mediaItem.type === 'video') ctx.scale(-1, 1);
                    drawCoverMedia(ctx, mediaItem.media, innerWidth, innerHeight, position);
                    ctx.restore();
                    ctx.restore();
                });

                if (frameImage) ctx.drawImage(frameImage, offsetX, offsetY, stripWidth, stripHeight);
            };

            const maxDuration = mediaItems.reduce((duration, item) => Math.max(duration, item?.duration || 0), 0);
            const durationMs = Math.min(12000, Math.max(5000, maxDuration * 1000 || 7000));
            const recordedBlob = await recordCanvas(canvas, () => {
                for (let index = 0; index < repeatCount; index += 1) {
                    if (stripHorizontal) drawOneStrip(0, index * stripHeight);
                    else drawOneStrip(index * stripWidth, 0);
                }
            }, durationMs);

            // Nếu trình duyệt ghi thẳng MP4 (iOS Safari / Chrome mới) -> dùng luôn, iPhone
            // xem & lưu Photos được. Nếu là WebM -> thử nhờ backend booth (có ffmpeg) đổi
            // sang MP4; không khả dụng (vd xem album qua cloud/Vercel) thì giữ WebM.
            let downloadBlob = recordedBlob;
            let ext = /mp4/i.test(recordedBlob.type) ? 'mp4' : 'webm';

            if (ext !== 'mp4') {
                try {
                    const formData = new FormData();
                    formData.append('file', recordedBlob, 'motion_frame.webm');
                    const res = await fetch(`${API_URL}/api/convert-motion`, { method: 'POST', body: formData });
                    if (res.ok) {
                        downloadBlob = await res.blob();
                        ext = 'mp4';
                    } else {
                        console.warn(`convert-motion không khả dụng (${res.status}) -> giữ WebM`);
                    }
                } catch (convErr) {
                    console.warn('convert-motion lỗi -> giữ WebM', convErr);
                }
            }

            // KHÔNG share ngay: việc quay mất 5-12s nên "user activation" đã hết hạn,
            // navigator.share sẽ bị chặn -> rơi về Downloads. Lưu blob lại, để khách bấm
            // nút "Lưu video" (gesture mới) thì share mới chạy -> vào album.
            setMotionVideo({
                blob: downloadBlob,
                filename: getDownloadFilename(session, ext, 'motion-trong-khung'),
            });
        } catch (error) {
            console.error('Motion frame download failed', error);
            setErrorDialog('Không thể tạo video trong khung. Vui lòng thử lại.');
        } finally {
            objectUrls.forEach((url) => URL.revokeObjectURL(url));
            setDownloading(false);
        }
    };

    // Bấm sau khi video đã tạo xong -> chạy trong gesture mới nên share hoạt động.
    const saveMotionVideo = () => {
        if (motionVideo) saveBlob(motionVideo.blob, motionVideo.filename);
    };

    if (loading) {
        // Dùng CÙNG kiểu với LoadingScreen của Suspense (logo + 3 chấm nảy, nền trắng) để khi
        // reload không hiện 2 loader khác nhau (Suspense -> rồi loader nội bộ).
        return (
            <div className="flex h-dvh min-h-dvh w-full flex-col items-center justify-center bg-[#FFF8E7] font-serif">
                <div className="flex flex-col items-center gap-5">
                    <img
                        src={logoUrl}
                        alt="Đang tải..."
                        className="h-24 w-24 animate-pulse object-contain"
                        onError={(e) => { if (!e.currentTarget.src.endsWith('/logo_tomato.png')) e.currentTarget.src = '/logo_tomato.png'; }}
                    />
                    <div className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-[#e63946]" style={{ animationDelay: '0ms' }} />
                        <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-[#e63946]" style={{ animationDelay: '150ms' }} />
                        <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-[#e63946]" style={{ animationDelay: '300ms' }} />
                    </div>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-5 py-8 font-serif text-[#3F3127]" style={ALBUM_BG_STYLE}>
                {/* Tiêu đề wordmark "tomato" phía trên. Ưu tiên /tomato.png; nếu chưa có file thì
                    tự fallback về /tomato_memories.png; nếu cả 2 không có thì ẩn. */}
                <img
                    src="/tomato.png"
                    alt="Tomato"
                    className="block h-auto w-full max-w-[200px] object-contain sm:max-w-[260px]"
                    loading="eager"
                    decoding="async"
                    onError={(e) => {
                        if (e.currentTarget.src.endsWith('/tomato.png')) e.currentTarget.src = '/tomato_memories.png';
                        else e.currentTarget.style.display = 'none';
                    }}
                />
                <div className="flex w-full max-w-sm flex-col items-center rounded-[2rem] bg-white px-5 py-8 text-center shadow-md sm:px-8">
                    <img
                        src={logoUrl}
                        onError={(e) => { if (!e.currentTarget.src.endsWith('/logo_tomato.png')) e.currentTarget.src = '/logo_tomato.png'; }}
                        alt="Tomato Photobooth"
                        className="mb-4 h-16 w-16 object-contain"
                    />
                    <h1 className="mb-2 whitespace-nowrap text-lg font-extrabold text-[#7B5E43] sm:text-2xl">{error.title}</h1>
                    <p className="text-sm leading-relaxed text-[#7B5E43]/75 sm:text-[15px]">{error.message}</p>
                </div>
                <SocialFooter className="mt-1" />
            </div>
        );
    }

    return (
        <div
            className="relative h-dvh overflow-y-auto overflow-x-hidden font-serif text-[#3F3127]"
            style={{ WebkitOverflowScrolling: 'touch', backgroundColor: '#FFF8E7' }}
        >
            <div className="pointer-events-none fixed inset-0 z-0" style={ALBUM_BG_STYLE} aria-hidden="true" />
            {errorDialog && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-6">
                    <div className="w-full max-w-sm rounded-3xl border border-[#E7D3B7] bg-white p-7 text-center shadow-2xl">
                        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-50 text-red-500">
                            <AlertCircle size={30} />
                        </div>
                        <h2 className="mb-3 text-2xl font-black text-[#3F3127]">Đã xảy ra lỗi</h2>
                        <p className="mb-6 text-base font-semibold leading-relaxed text-[#7B5E43]">{errorDialog}</p>
                        <button
                            type="button"
                            onClick={() => setErrorDialog(null)}
                            className="min-h-12 rounded-2xl bg-[#D5B895] px-9 text-base font-extrabold text-white shadow-md active:scale-95"
                        >
                            Đã hiểu
                        </button>
                    </div>
                </div>
            )}

            <header className="relative z-10 mx-auto flex w-full max-w-5xl flex-col items-center gap-5 px-4 pb-5 pt-8 text-center sm:px-6 md:pt-12">
                {/* Tiêu đề album: logo "tomato memories" + dòng hết hạn ngay dưới. Cả khối nằm
                    trong <header> dòng-chảy (relative) nên CUỘN theo trang, không phải lớp cố định. */}
                <div className="flex flex-col items-center gap-2">
                    <img
                        src="/tomato_memories.png"
                        alt="Tomato Memories"
                        className="mx-auto block h-auto w-full max-w-[240px] object-contain sm:max-w-[300px]"
                        loading="eager"
                        decoding="async"
                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                    />
                    <p className="text-sm font-semibold text-[#7B5E43] sm:text-base">
                        Lưu ý: link sẽ hết hạn sau 48 giờ
                    </p>
                </div>

                <button
                    type="button"
                    onClick={downloadAll}
                    disabled={downloading || loadingMore}
                    className="mx-auto flex min-h-12 w-full max-w-sm items-center justify-center gap-2 rounded-2xl border border-[#D9BE92] bg-[#E6D0A8] px-5 py-3 text-base font-extrabold text-[#6B5234] shadow-sm disabled:opacity-60 disabled:cursor-not-allowed sm:w-auto sm:min-w-64"
                >
                    {loadingMore ? (
                        <><span className="h-5 w-5 shrink-0 rounded-full border-[3px] border-[#6B5234]/30 border-t-[#6B5234] animate-spin" /> Đang tải thêm ảnh…</>
                    ) : (
                        <><Download size={20} /> {downloading ? 'Đang tải...' : 'Tải xuống tất cả'}</>
                    )}
                </button>
            </header>

            <main className="relative z-10 mx-auto w-full max-w-5xl px-4 pb-16 sm:px-6">
                {canRenderMotionFrame && (
                    <section className="mb-8">
                        <div className="mb-3 flex items-center gap-2 text-lg font-extrabold text-[#7B5E43]">
                            <Film size={20} />
                            Motion trong khung
                        </div>

                        <div className="rounded-3xl border border-[#EFE0C8] bg-[#FFFDF7] p-3 shadow-sm sm:p-4">
                            <div className={`mx-auto grid w-full gap-0 ${strip && !stripHorizontal ? 'grid-cols-2' : 'grid-cols-1'} ${stripHorizontal ? 'max-w-[520px]' : 'max-w-[680px]'}`}>
                                <FrameMotionPreview
                                    frameUrl={frameUrl}
                                    sizerUrl={session?.composite_url}
                                    frameConfig={frameConfig}
                                    photos={photos}
                                    positions={photoPositions}
                                />
                                {strip && !stripHorizontal && (
                                    <FrameMotionPreview
                                        frameUrl={frameUrl}
                                        sizerUrl={session?.composite_url}
                                        frameConfig={frameConfig}
                                        photos={photos}
                                        positions={photoPositions}
                                    />
                                )}
                            </div>
                            {motionVideo ? (
                                <div className="mt-4 flex flex-col items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={saveMotionVideo}
                                        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#7B5E43] px-5 py-3 text-base font-extrabold text-white shadow-md active:scale-[0.98]"
                                    >
                                        <Download size={18} />
                                        Lưu video
                                    </button>
                                    <button
                                        type="button"
                                        onClick={downloadVideos}
                                        disabled={downloading}
                                        className="text-sm font-semibold text-[#7B5E43]/70 underline disabled:opacity-50"
                                    >
                                        {downloading ? 'Đang tạo lại...' : 'Tạo lại video'}
                                    </button>
                                </div>
                            ) : (
                                <button
                                    type="button"
                                    onClick={downloadVideos}
                                    disabled={downloading}
                                    className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-[#F6E6C9] px-5 py-3 text-base font-extrabold text-[#7B5E43] disabled:opacity-70"
                                >
                                    <Film size={18} />
                                    {downloading ? 'Đang tạo video...' : 'Tạo video'}
                                </button>
                            )}
                        </div>
                    </section>
                )}

                {loadingMore && !canRenderMotionFrame && Array.isArray(frameConfig?.boxes) && frameConfig.boxes.length > 0 && (
                    <section className="mb-8">
                        <div className="mb-3 flex items-center gap-2 text-lg font-extrabold text-[#7B5E43]">
                            <Film size={20} />
                            Motion trong khung
                        </div>
                        <div className="flex flex-col items-center justify-center gap-3 rounded-3xl border border-[#EFE0C8] bg-[#FFFDF7] p-10 shadow-sm">
                            <div className="h-9 w-9 rounded-full border-4 border-[#D5B895]/30 border-t-[#7B5E43] animate-spin" />
                            <p className="text-sm font-bold text-[#7B5E43]/80">Đang tải video chuyển động…</p>
                        </div>
                    </section>
                )}

                {session?.composite_url && (
                    <section className="mb-8">
                        <div className="mb-3 flex items-center gap-2 text-lg font-extrabold text-[#7B5E43]">
                            <ImageIcon size={20} />
                            Ảnh đã ghép
                        </div>

                        <div className="rounded-3xl border border-[#EFE0C8] bg-[#FFFDF7] p-3 shadow-sm sm:p-4">
                            {/* 1 ẢNH DUY NHẤT: strip -> đã ghép 2 strip thành nguyên tờ 4x6 (giữ ảnh/
                                tải về ra 1 ảnh, không còn 2 nửa rời). Layout khác -> composite gốc. */}
                            <div className={`mx-auto w-full ${stripHorizontal ? 'max-w-[520px]' : 'max-w-[680px]'}`}>
                                {displayCompositeUrl ? (
                                    <img
                                        src={displayCompositeUrl}
                                        alt="Ảnh đã ghép"
                                        className="h-auto w-full object-contain"
                                        loading="eager"
                                        decoding="async"
                                    />
                                ) : (
                                    // strip: đang ghép 2 strip (chưa có blob) -> skeleton, tránh tải composite thô
                                    <div className={`mx-auto flex ${stripHorizontal ? 'aspect-[3/2]' : 'aspect-[2/3]'} w-full animate-pulse items-center justify-center rounded-xl bg-[#F3E7CF]`}>
                                        <span className="h-8 w-8 rounded-full border-4 border-[#D5B895]/30 border-t-[#7B5E43] animate-spin" />
                                    </div>
                                )}
                            </div>

                            <button
                                type="button"
                                onClick={() => (combined?.blob
                                    ? saveBlob(combined.blob, getDownloadFilename(session, 'jpg'))
                                    : saveImages([{ url: session.composite_url, filename: getDownloadFilename(session, 'jpg') }]))}
                                className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-[#F6E6C9] px-5 py-3 text-base font-extrabold text-[#7B5E43]"
                            >
                                <Download size={18} />
                                Tải ảnh này
                            </button>
                        </div>
                    </section>
                )}

                {loadingMore && photos.length === 0 && (
                    <section className="mb-8">
                        <div className="mb-3 flex items-center gap-2 text-lg font-extrabold text-[#7B5E43]">
                            <ImageIcon size={20} />
                            Ảnh gốc
                        </div>
                        <div className="grid grid-cols-2 gap-3 sm:gap-4">
                            {Array.from({ length: 4 }).map((_, i) => (
                                <div key={i} className="aspect-[3/4] animate-pulse rounded-2xl border border-[#EFE0C8] bg-[#F3E7CF]" />
                            ))}
                        </div>
                        <div className="mt-3 flex items-center justify-center gap-2 text-sm font-bold text-[#7B5E43]/80">
                            <span className="h-4 w-4 rounded-full border-[3px] border-[#D5B895]/30 border-t-[#7B5E43] animate-spin" />
                            Đang tải ảnh gốc…
                        </div>
                    </section>
                )}

                {photos.length > 0 && (
                    <section className="mb-8">
                        <div className="mb-3 flex items-center gap-2 text-lg font-extrabold text-[#7B5E43]">
                            <ImageIcon size={20} />
                            Ảnh gốc
                        </div>

                        <div className="grid grid-cols-2 gap-3 sm:gap-4">
                            {photos.map((photo, index) => {
                                const photoUrl = getPhotoUrl(photo);
                                if (!photoUrl) return null;

                                return (
                                    <article key={`${photoUrl}-${index}`} className="rounded-2xl border border-[#EFE0C8] bg-[#FFFDF7] p-2 shadow-sm">
                                        <img
                                            src={photoUrl}
                                            alt={`Ảnh gốc ${index + 1}`}
                                            className="h-auto w-full rounded-xl object-contain"
                                            loading="lazy"
                                            decoding="async"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => saveImages([{ url: photoUrl, filename: getDownloadFilename(session, 'jpg', `anh-${pad2(index + 1)}`) }])}
                                            className="mt-2 flex w-full items-center justify-center gap-1 rounded-xl bg-[#F6E6C9] px-3 py-2 text-sm font-bold text-[#7B5E43]"
                                        >
                                            <Download size={15} />
                                            Tải
                                        </button>
                                    </article>
                                );
                            })}
                        </div>
                    </section>
                )}

                {/* Footer mạng xã hội cuối trang album */}
                <SocialFooter className="mt-2 pt-4" />

            </main>
        </div>
    );
};

export default ViewPage;
