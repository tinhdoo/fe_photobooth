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

const fetchAsObjectUrl = async (url) => {
    const response = await fetch(resolveAssetUrl(url), { mode: 'cors' });
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
    if (!frameUrl || boxes.length === 0 || photos.length === 0) return null;

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

            <img
                src={frameUrl}
                alt="Motion trong khung"
                className="pointer-events-none absolute inset-0 z-10 h-full w-full object-fill"
                loading="eager"
                decoding="async"
            />
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

const ViewPage = () => {
    const { id } = useParams();
    const { configs } = useWorkflow();
    const logoUrl = configs?.logo_main || '/logo_tomato.png';
    const [session, setSession] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [downloading, setDownloading] = useState(false);
    const [errorDialog, setErrorDialog] = useState(null);
    const [motionVideo, setMotionVideo] = useState(null); // { blob, filename } sau khi tạo xong
    const [combined, setCombined] = useState(null); // { url, blob } — 2 strip GHÉP thành 1 ảnh (chỉ layout strip)

    useEffect(() => {
        let cancelled = false;
        let pollTimer = null;
        let attempts = 0;
        const MAX_POLLS = 12; // ~30s (2.5s/lần) chờ ảnh lẻ + video upload nền ở booth xong

        // isPoll = true: lần gọi lại nền -> KHÔNG bật loading / không báo lỗi phá album đang hiện.
        const fetchSession = async (isPoll = false) => {
            if (!isPoll) { setLoading(true); setError(''); }
            try {
                const res = await axios.get(`${CLOUD_API_URL}/api/sessions`, {
                    params: { id }
                });
                const data = res.data;

                if (cancelled) return;

                const hasComposite = Boolean(data.composite_url);
                const hasPhotos = Array.isArray(data.photos) && data.photos.some((photo) => getPhotoUrl(photo));

                if (data.status === 'expired' || (!hasComposite && !hasPhotos)) {
                    if (!isPoll) setError('Liên kết đã hết hạn. Cảm ơn bạn đã sử dụng dịch vụ Photobooth.');
                    return;
                }

                setSession(data);

                // Album đã có ảnh ghép nhưng ảnh lẻ/video CHƯA về (booth đang upload nền) -> poll
                // bổ sung tới khi có, hoặc hết MAX_POLLS thì thôi (giữ ảnh ghép đang hiện).
                if (hasComposite && !hasPhotos && attempts < MAX_POLLS) {
                    attempts += 1;
                    pollTimer = setTimeout(() => fetchSession(true), 2500);
                }
            } catch (err) {
                console.error('Failed to load album', err);
                if (!cancelled && !isPoll) {
                    setError('Không thể tải album. Vui lòng thử lại hoặc quay lại booth để được hỗ trợ.');
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
    const canRenderMotionFrame = hasVideos && frameUrl && Array.isArray(frameConfig?.boxes) && frameConfig.boxes.length > 0;

    // GHÉP 2 strip thành 1 ẢNH DUY NHẤT (nguyên tờ 4x6) để hiển thị + tải về.
    // composite_url là 1 strip đơn (1:3). Layout strip in ra 2 strip/tờ nên bản digital cũng
    // ghép 2 bản: strip dọc -> cạnh nhau; strip ngang -> chồng dọc. Layout khác giữ nguyên.
    useEffect(() => {
        const src = session?.composite_url;
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
                if (!cancelled) setCombined(null);
            }
        })();
        return () => { cancelled = true; if (createdUrl) URL.revokeObjectURL(createdUrl); };
    }, [session?.composite_url, strip, stripHorizontal]);

    // Ảnh ghép dùng để HIỂN THỊ + TẢI: strip -> bản đã ghép 2 strip; layout khác -> composite gốc.
    const displayCompositeUrl = combined?.url || session?.composite_url;

    const downloadUrl = async (url, filename) => {
        if (!url) return;

        try {
            const response = await fetch(url, { mode: 'cors' });
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
        const response = await fetch(url, { mode: 'cors' });
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
            if (canShareFiles(files)) {
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
            if (canShareFiles([file])) {
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

            const frameObjectUrl = await fetchAsObjectUrl(frameUrl);
            objectUrls.push(frameObjectUrl);
            const frameImage = await waitForImage(frameObjectUrl);

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
            const frameWidth = frameImage.naturalWidth || frameImage.width;
            const frameHeight = frameImage.naturalHeight || frameImage.height;
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

                ctx.drawImage(frameImage, offsetX, offsetY, stripWidth, stripHeight);
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
            <div className="flex min-h-dvh items-center justify-center px-5 font-serif text-[#3F3127]" style={ALBUM_BG_STYLE}>
                <div className="w-full max-w-sm rounded-3xl bg-white p-7 text-center shadow-md">
                    <img
                        src={logoUrl}
                        onError={(e) => { if (!e.currentTarget.src.endsWith('/logo_tomato.png')) e.currentTarget.src = '/logo_tomato.png'; }}
                        alt="Tomato Photobooth"
                        className="mx-auto mb-5 h-20 w-20 rounded-full object-contain"
                    />
                    <h1 className="mb-3 text-2xl font-extrabold text-[#7B5E43]">Rất tiếc</h1>
                    <p className="text-base leading-relaxed text-[#7B5E43]">{error}</p>
                </div>
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
                    disabled={downloading}
                    className="mx-auto flex min-h-12 w-full max-w-sm items-center justify-center gap-2 rounded-2xl border border-[#D9BE92] bg-[#E6D0A8] px-5 py-3 text-base font-extrabold text-[#6B5234] shadow-sm disabled:opacity-70 sm:w-auto sm:min-w-64"
                >
                    <Download size={20} />
                    {downloading ? 'Đang tải...' : 'Tải xuống tất cả'}
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
                                <img
                                    src={displayCompositeUrl}
                                    alt="Ảnh đã ghép"
                                    className="h-auto w-full object-contain"
                                    loading="eager"
                                    decoding="async"
                                />
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

            </main>
        </div>
    );
};

export default ViewPage;
