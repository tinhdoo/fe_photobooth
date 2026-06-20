import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { AlertCircle, Download, Film, Image as ImageIcon } from 'lucide-react';
import { useWorkflow } from '../context/WorkflowContext';

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
    const candidates = [
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
        resolve(new Blob(chunks, { type: mimeType || 'video/webm' }));
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

const FrameMotionPreview = ({ frameUrl, frameConfig, photos, positions }) => {
    const boxes = Array.isArray(frameConfig?.boxes) ? frameConfig.boxes : [];
    if (!frameUrl || boxes.length === 0 || photos.length === 0) return null;

    let implicitPhotoIndex = 0;

    return (
        <div className="relative mx-auto w-full max-w-[680px] overflow-hidden bg-white shadow-sm">
            <img
                src={frameUrl}
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

const ViewPage = () => {
    const { id } = useParams();
    const { configs } = useWorkflow();
    const logoUrl = configs?.logo_main || '/logo_tomato.png';
    const [session, setSession] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [downloading, setDownloading] = useState(false);
    const [errorDialog, setErrorDialog] = useState(null);

    useEffect(() => {
        let cancelled = false;

        const fetchSession = async () => {
            setLoading(true);
            setError('');
            try {
                const cloudApiUrl = import.meta.env.VITE_CLOUD_API_URL
                    || (window.location.hostname === 'localhost' ? 'https://tomatophotobooth.vercel.app' : '');
                const res = await axios.get(`${cloudApiUrl}/api/sessions`, {
                    params: { id }
                });
                const data = res.data;

                if (cancelled) return;

                const hasComposite = Boolean(data.composite_url);
                const hasPhotos = Array.isArray(data.photos) && data.photos.some((photo) => getPhotoUrl(photo));

                if (data.status === 'expired' || (!hasComposite && !hasPhotos)) {
                    setError('Liên kết đã hết hạn. Cảm ơn bạn đã sử dụng dịch vụ Photobooth.');
                    return;
                }

                setSession(data);
            } catch (err) {
                console.error('Failed to load album', err);
                if (!cancelled) {
                    setError('Không thể tải album. Vui lòng thử lại hoặc quay lại booth để được hỗ trợ.');
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        if (id) fetchSession();
        return () => {
            cancelled = true;
        };
    }, [id]);

    const photos = useMemo(() => session?.photos || [], [session]);
    const hasVideos = photos.some((photo) => getVideoUrl(photo));
    const strip = isStripLayout(session);
    const frameUrl = session?.meta_data?.frame_url || '';
    const frameConfig = session?.meta_data?.frame_config || null;
    const photoPositions = session?.meta_data?.photo_positions || [];
    const canRenderMotionFrame = hasVideos && frameUrl && Array.isArray(frameConfig?.boxes) && frameConfig.boxes.length > 0;

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

    const downloadAll = async () => {
        if (!session || downloading) return;

        setDownloading(true);
        const files = [];

        if (session.composite_url) {
            files.push({
                url: session.composite_url,
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

        for (const file of files) {
            await downloadUrl(file.url, file.filename);
            await new Promise((resolve) => setTimeout(resolve, 180));
        }

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

            const repeatCount = strip ? 2 : 1;
            const frameWidth = frameImage.naturalWidth || frameImage.width;
            const frameHeight = frameImage.naturalHeight || frameImage.height;
            const scale = Math.min(1, 1080 / Math.max(frameWidth * repeatCount, frameHeight));
            const stripWidth = Math.max(2, Math.round(frameWidth * scale / 2) * 2);
            const stripHeight = Math.max(2, Math.round(frameHeight * scale / 2) * 2);

            const canvas = document.createElement('canvas');
            canvas.width = stripWidth * repeatCount;
            canvas.height = stripHeight;
            const ctx = canvas.getContext('2d', { alpha: false });
            const boxes = Array.isArray(frameConfig?.boxes) ? frameConfig.boxes : [];

            const drawOneStrip = (offsetX) => {
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(offsetX, 0, stripWidth, stripHeight);

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
                    const boxY = (Number(box.y) || 0) / 100 * stripHeight;
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
                    drawCoverMedia(ctx, mediaItem.media, innerWidth, innerHeight, position);
                    ctx.restore();
                    ctx.restore();
                });

                ctx.drawImage(frameImage, offsetX, 0, stripWidth, stripHeight);
            };

            const maxDuration = mediaItems.reduce((duration, item) => Math.max(duration, item?.duration || 0), 0);
            const durationMs = Math.min(12000, Math.max(5000, maxDuration * 1000 || 7000));
            const webmBlob = await recordCanvas(canvas, () => {
                for (let index = 0; index < repeatCount; index += 1) {
                    drawOneStrip(index * stripWidth);
                }
            }, durationMs);

            const formData = new FormData();
            formData.append('file', webmBlob, 'motion_frame.webm');
            const apiUrl = import.meta.env.VITE_API_URL || '';
            const res = await fetch(`${apiUrl}/api/convert-motion`, {
                method: 'POST',
                body: formData
            });
            if (!res.ok) throw new Error('Không thể chuyển video sang MP4.');

            const mp4Blob = await res.blob();
            const downloadObjectUrl = URL.createObjectURL(mp4Blob);
            const link = document.createElement('a');
            link.href = downloadObjectUrl;
            link.download = getDownloadFilename(session, 'mp4', 'motion-trong-khung');
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.setTimeout(() => URL.revokeObjectURL(downloadObjectUrl), 60000);
        } catch (error) {
            console.error('Motion frame download failed', error);
            setErrorDialog('Không thể tạo video trong khung. Vui lòng thử lại.');
        } finally {
            objectUrls.forEach((url) => URL.revokeObjectURL(url));
            setDownloading(false);
        }
    };

    if (loading) {
        return (
            <div className="flex min-h-dvh items-center justify-center bg-[#FFF8E7] px-6 font-serif text-[#7B5E43]">
                <div className="text-center">
                    <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-[#F6E6C9] border-t-[#7B5E43]" />
                    <p className="text-lg font-bold">Đang tải album...</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex min-h-dvh items-center justify-center bg-[#FFF8E7] px-5 font-serif text-[#3F3127]">
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
            className="h-dvh overflow-y-auto overflow-x-hidden bg-[#FFF8E7] font-serif text-[#3F3127]"
            style={{ WebkitOverflowScrolling: 'touch' }}
        >
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

            <header className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 pb-5 pt-8 text-center sm:px-6 md:pt-12">
                <div>
                    <img
                        src={logoUrl}
                        onError={(e) => { if (!e.currentTarget.src.endsWith('/logo_tomato.png')) e.currentTarget.src = '/logo_tomato.png'; }}
                        alt="Tomato Photobooth"
                        className="mx-auto mb-3 h-16 w-16 rounded-full object-contain sm:h-20 sm:w-20"
                    />
                    <h1 className="text-3xl font-extrabold uppercase tracking-[0.12em] text-[#7B5E43] sm:text-5xl">
                        Tomato Photobooth
                    </h1>
                    <p className="mt-2 text-sm font-semibold text-[#7B5E43] sm:text-base">
                        Lưu ý: link sẽ hết hạn sau 72 giờ
                    </p>
                </div>

                <button
                    type="button"
                    onClick={downloadAll}
                    disabled={downloading}
                    className="mx-auto flex min-h-12 w-full max-w-sm items-center justify-center gap-2 rounded-2xl bg-[#D5B895] px-5 py-3 text-base font-extrabold text-white shadow-md disabled:opacity-70 sm:w-auto sm:min-w-64"
                >
                    <Download size={20} />
                    {downloading ? 'Đang tải...' : 'Tải xuống tất cả'}
                </button>
            </header>

            <main className="mx-auto w-full max-w-5xl px-4 pb-16 sm:px-6">
                {canRenderMotionFrame && (
                    <section className="mb-8">
                        <div className="mb-3 flex items-center gap-2 text-lg font-extrabold text-[#7B5E43]">
                            <Film size={20} />
                            Motion trong khung
                        </div>

                        <div className="bg-white p-3 shadow-md sm:p-4">
                            <div className={`mx-auto grid w-full gap-0 ${strip ? 'grid-cols-2' : 'grid-cols-1'} max-w-[680px]`}>
                                <FrameMotionPreview
                                    frameUrl={frameUrl}
                                    frameConfig={frameConfig}
                                    photos={photos}
                                    positions={photoPositions}
                                />
                                {strip && (
                                    <FrameMotionPreview
                                        frameUrl={frameUrl}
                                        frameConfig={frameConfig}
                                        photos={photos}
                                        positions={photoPositions}
                                    />
                                )}
                            </div>
                            <button
                                type="button"
                                onClick={downloadVideos}
                                disabled={downloading}
                                className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-[#F6E6C9] px-5 py-3 text-base font-extrabold text-[#7B5E43] disabled:opacity-70"
                            >
                                <Download size={18} />
                                {downloading ? 'Đang tải...' : 'Tải video'}
                            </button>
                        </div>
                    </section>
                )}

                {session?.composite_url && (
                    <section className="mb-8">
                        <div className="mb-3 flex items-center gap-2 text-lg font-extrabold text-[#7B5E43]">
                            <ImageIcon size={20} />
                            Ảnh đã ghép
                        </div>

                        <div className="bg-white p-3 shadow-md sm:p-4">
                            <div className={`mx-auto grid w-full gap-0 ${strip ? 'grid-cols-2' : 'grid-cols-1'} max-w-[680px]`}>
                                <img
                                    src={session.composite_url}
                                    alt="Ảnh đã ghép"
                                    className="h-auto w-full object-contain"
                                    loading="eager"
                                    decoding="async"
                                />
                                {strip && (
                                    <img
                                        src={session.composite_url}
                                        alt="Ảnh đã ghép bản thứ hai"
                                        className="h-auto w-full object-contain"
                                        loading="eager"
                                        decoding="async"
                                    />
                                )}
                            </div>

                            <button
                                type="button"
                                onClick={() => downloadUrl(session.composite_url, getDownloadFilename(session, 'jpg'))}
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
                                    <article key={`${photoUrl}-${index}`} className="rounded-2xl bg-white p-2 shadow-sm">
                                        <img
                                            src={photoUrl}
                                            alt={`Ảnh gốc ${index + 1}`}
                                            className="h-auto w-full rounded-xl object-contain"
                                            loading="lazy"
                                            decoding="async"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => downloadUrl(photoUrl, getDownloadFilename(session, 'jpg', `anh-${pad2(index + 1)}`))}
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

                <footer className="mt-12 text-center text-xs font-semibold uppercase tracking-widest text-[#7B5E43]/70">
                    Session ID: {id}
                </footer>
            </main>
        </div>
    );
};

export default ViewPage;
