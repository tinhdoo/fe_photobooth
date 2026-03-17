import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { Download, Image as ImageIcon, Film, Facebook, Instagram } from 'lucide-react';
import LogoTomato from '../assets/images/logo_tomato.png';

const FrameBox = ({ box, photo, borderRadius, index, isReplica, videoRefs }) => {
    const canvasRef = useRef(null);

    useEffect(() => {
        if (!photo.video_url) return;

        let raf;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');

        const video = document.createElement("video");
        video.src = photo.video_url;
        video.muted = true;
        video.loop = true;
        video.playsInline = true;
        video.crossOrigin = "anonymous";

        // Mute Safari auto-play policies
        video.play().catch(e => console.warn("Video auto-play suppressed", e));

        const draw = () => {
            if (video.readyState >= 2) {

                if (canvas.width !== video.videoWidth) {
                    canvas.width = video.videoWidth;
                    canvas.height = video.videoHeight;
                }

                // mirror preview (photobooth style)
                ctx.save();
                ctx.scale(-1, 1);
                ctx.drawImage(video, -canvas.width, 0, canvas.width, canvas.height);
                ctx.restore();
            }
            raf = requestAnimationFrame(draw);
        };

        draw();

        // Update global refs for the Motion MP4 Generator to grab
        if (videoRefs && videoRefs.current) {
            videoRefs.current[index] = video;
        }

        return () => {
            cancelAnimationFrame(raf);
            video.pause();
            video.removeAttribute('src');
            video.load();
        };
    }, [index, photo.video_url, videoRefs]);

    return (
        <div
            className="absolute overflow-hidden bg-gray-100"
            style={{
                left: `${box.x}%`, top: `${box.y}%`,
                width: `${box.width}%`, height: `${box.height}%`,
                transform: `rotate(${box.rotation || 0}deg)`,
                borderRadius: `${borderRadius || 0}px`,
                containerType: 'size'
            }}
        >
            <div style={{
                position: 'absolute', top: '50%', left: '50%',
                width: (box.innerRotation === 90 || box.innerRotation === -90 || box.innerRotation === 270 || box.innerRotation === -270) ? '100cqh' : '100%',
                height: (box.innerRotation === 90 || box.innerRotation === -90 || box.innerRotation === 270 || box.innerRotation === -270) ? '100cqw' : '100%',
                transform: `translate(-50%, -50%) rotate(${box.innerRotation || 0}deg)`,
            }}>
                {photo.video_url ? (
                    <canvas
                        ref={canvasRef}
                        className="w-full h-full object-cover"
                    />
                ) : (
                    <img
                        src={photo.url || photo}
                        className="w-full h-full object-cover"
                        alt="frame"
                    />
                )}
            </div>
        </div>
    );
};

const ViewPage = () => {
    const { id } = useParams();
    const [session, setSession] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const videoRefs = useRef({});

    useEffect(() => {
        const fetchSession = async () => {
            try {
                const apiUrl = import.meta.env.VITE_API_URL || '';
                const res = await axios.get(`${apiUrl}/api/sessions/${id}`);
                const sessionData = res.data;

                // Primary check: explicit expired status (set by cleanup job)
                if (sessionData.status === 'expired') {
                    setError("Liên kết đã hết hạn, cảm ơn bạn đã sử dụng dịch vụ của Tomato Photobooth");
                    setLoading(false);
                    return;
                }

                // Fallback: URLs were nullified but status wasn't updated (legacy)
                if (!sessionData.composite_url && (!sessionData.photos || sessionData.photos.length === 0 || !sessionData.photos[0]?.url)) {
                    setError("Liên kết đã hết hạn, cảm ơn bạn đã sử dụng dịch vụ của Tomato Photobooth");
                    setLoading(false);
                    return;
                }

                setSession(sessionData);
            } catch (err) {
                setError("Liên kết đã hết hạn, cảm ơn bạn đã sử dụng dịch vụ của Tomato");
            } finally {
                setLoading(false);
            }
        };
        if (id) fetchSession();
    }, [id]);

    const renderMotionStrip = (isReplica = false) => {
        const meta = session?.meta_data;
        if (!meta || !meta.frame_config) return null;

        const { frame_config, frame_url } = meta;
        const boxes = frame_config.boxes || [];
        const photos = session.photos || [];

        return (
            <div className="relative w-full bg-white shadow-lg overflow-hidden">
                {/* Transparent spacer — drives container height from the frame image dimensions */}
                {frame_url ? (
                    <img src={frame_url} className="w-full h-auto opacity-0 pointer-events-none select-none" alt="" aria-hidden="true" />
                ) : (
                    <div className="w-full aspect-[1/3]" />
                )}

                {/* Videos/Photos Layer — z-0, behind everything */}
                <div className="absolute inset-0" style={{ zIndex: 0 }}>
                    {(() => {
                        let implicitPhotoIndex = 0;
                        return boxes.map((box, i) => {
                            if (box.type === 'qr') return null;

                            const targetIdx = box.photoIndex !== undefined ? box.photoIndex : (implicitPhotoIndex % (photos.length || 1));
                            if (box.photoIndex === undefined) implicitPhotoIndex++;
                            const photo = photos[targetIdx];

                            if (!photo) return null;

                            return (
                                <FrameBox
                                    key={i}
                                    box={box}
                                    photo={photo}
                                    borderRadius={frame_config.borderRadius}
                                    index={targetIdx}
                                    isReplica={isReplica}
                                    videoRefs={videoRefs}
                                />
                            );
                        });
                    })()}
                </div>

                {/* Frame Overlay — absolute on top, isolation:isolate forces a new stacking context
                    so iOS GPU compositing cannot push canvas above it */}
                {frame_url && (
                    <img
                        src={frame_url}
                        className="absolute inset-0 w-full h-full pointer-events-none select-none"
                        style={{ zIndex: 10, isolation: 'isolate', objectFit: 'fill' }}
                        alt="Frame Overlay"
                    />
                )}
            </div>
        );
    };

    const createDoubleStripImage = (url) => {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = () => {
                const gap = 0; // No gap as requested 
                // Using fixed gap for now. 

                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');

                canvas.width = img.width * 2 + gap;
                canvas.height = img.height;

                // Fill white background (for gap)
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                // Draw left
                ctx.drawImage(img, 0, 0);
                // Draw right
                ctx.drawImage(img, img.width + gap, 0);

                resolve(canvas.toDataURL('image/jpeg', 0.95));
            };
            img.onerror = reject;
            img.src = url;
        });
    };

    const generateSingleMotionVideo = async () => {
        return new Promise((resolve, reject) => {
            const meta = session?.meta_data;
            if (!meta || !meta.frame_url) return reject("No frame config");

            const frameImg = new Image();
            frameImg.crossOrigin = "anonymous";
            frameImg.onload = async () => {
                const w = frameImg.width;
                const h = frameImg.height;
                const canvas = document.createElement('canvas');
                canvas.width = w; // Single
                canvas.height = h;
                const ctx = canvas.getContext('2d');

                // Setup Recorder
                const stream = canvas.captureStream(30);
                const mimeType = 'video/webm; codecs=vp8';
                const ext = 'webm';

                const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 5000000 });
                const chunks = [];
                recorder.ondataavailable = e => chunks.push(e.data);
                recorder.onstop = () => {
                    const blob = new Blob(chunks, { type: 'video/webm' });
                    resolve({ url: URL.createObjectURL(blob), ext });
                };

                // Get Videos
                const videos = [];
                let maxDuration = 0;
                const boxes = meta.frame_config.boxes || [];
                let photoIndex = 0;

                boxes.forEach((box) => {
                    if (box.type === 'qr') return;
                    const photo = session.photos[photoIndex];
                    if (photo && photo.video_url) {
                        const videoEl = videoRefs.current[photoIndex] || document.getElementById(`video-${photoIndex}`);
                        if (videoEl) {
                            videos.push({ el: videoEl, box });
                            if (videoEl.duration && isFinite(videoEl.duration) && videoEl.duration > maxDuration) {
                                maxDuration = videoEl.duration;
                            }
                        }
                    }
                    photoIndex++;
                });

                if (videos.length === 0) return reject("No videos found");

                // Wait for all videos to have enough data to play before recording
                await Promise.all(
                    videos.map(v =>
                        new Promise(res => {
                            if (v.el.readyState >= 2) res();
                            else {
                                // Add listener but also timeout to avoid infinite hang
                                let fired = false;
                                const onData = () => {
                                    if (!fired) { fired = true; res(); }
                                    v.el.removeEventListener('loadeddata', onData);
                                };
                                v.el.addEventListener('loadeddata', onData);
                                setTimeout(() => { if (!fired) { fired = true; res(); } }, 2000);
                            }
                        })
                    )
                );

                // Start Recording
                recorder.start();
                videos.forEach(v => {
                    try {
                        v.el.currentTime = 0;
                        v.el.play();
                    } catch (e) {
                        console.error("Play error", e);
                    }
                });

                // Animation Loop
                let animationId;
                const draw = () => {
                    if (recorder.state === 'inactive') return;

                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(0, 0, canvas.width, canvas.height);

                    // Draw Videos
                    videos.forEach(({ el, box }) => {
                        if (el.paused || el.ended) return;

                        const bx = (box.x / 100) * w;
                        const by = (box.y / 100) * h;
                        const bw = (box.width / 100) * w;
                        const bh = (box.height / 100) * h;

                        // Calculate object-cover dimensions
                        let drawW = bw;
                        let drawH = bh;
                        if (el.videoWidth > 0 && el.videoHeight > 0) {
                            const videoRatio = el.videoWidth / el.videoHeight;
                            const boxRatio = bw / bh;
                            if (videoRatio > boxRatio) {
                                drawH = bh;
                                drawW = bh * videoRatio;
                            } else {
                                drawW = bw;
                                drawH = bw / videoRatio;
                            }
                        }

                        ctx.save();
                        ctx.beginPath();
                        ctx.rect(bx, by, bw, bh);
                        ctx.clip();

                        /* mirror quanh tâm frame */
                        ctx.translate(bx + bw / 2, by + bh / 2);
                        ctx.scale(-1, 1);

                        try {
                            /* vẽ video centered object-cover */
                            ctx.drawImage(el, -drawW / 2, -drawH / 2, drawW, drawH);
                        } catch (err) { }
                        ctx.restore();
                    });

                    // Draw Overlays
                    try {
                        ctx.drawImage(frameImg, 0, 0, w, h);
                    } catch (e) {
                        // ignore failed overlay draws on mobile
                    }

                    animationId = requestAnimationFrame(draw);
                };
                draw();

                // Stop after duration
                setTimeout(() => {
                    cancelAnimationFrame(animationId);
                    if (recorder.state !== 'inactive') recorder.stop();
                }, (maxDuration || 5) * 1000);
            };
            frameImg.onerror = reject;
            frameImg.src = session.meta_data.frame_url;
        });
    };

    const generateDoubleMotionVideo = async () => {
        return new Promise((resolve, reject) => {
            const meta = session?.meta_data;
            if (!meta || !meta.frame_url) return reject("No frame config");

            const frameImg = new Image();
            frameImg.crossOrigin = "anonymous";
            frameImg.onload = async () => {
                const w = frameImg.width;
                const h = frameImg.height;
                const canvas = document.createElement('canvas');
                canvas.width = w * 2; // Double strip
                canvas.height = h;
                const ctx = canvas.getContext('2d');

                // Setup Recorder (Reverted to WEBM due to MP4 playback issues)
                const stream = canvas.captureStream(30);
                const mimeType = 'video/webm; codecs=vp8';
                const ext = 'webm';

                const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 5000000 });
                const chunks = [];
                recorder.ondataavailable = e => chunks.push(e.data);
                recorder.onstop = () => {
                    const blob = new Blob(chunks, { type: 'video/webm' });
                    resolve({ url: URL.createObjectURL(blob), ext });
                };

                // Get Videos
                const videos = [];
                let maxDuration = 0;
                // Find videos from DOM
                const boxes = meta.frame_config.boxes || [];
                let photoIndex = 0;

                boxes.forEach((box, i) => {
                    if (box.type === 'qr') return;
                    const photo = session.photos[photoIndex];
                    if (photo && photo.video_url) {
                        const videoEl = videoRefs.current[photoIndex] || document.getElementById(`video-${photoIndex}`);
                        if (videoEl) {
                            videos.push({ el: videoEl, box });
                            if (videoEl.duration && isFinite(videoEl.duration) && videoEl.duration > maxDuration) {
                                maxDuration = videoEl.duration;
                            }
                        }
                    }
                    photoIndex++;
                });

                if (videos.length === 0) return reject("No videos found");

                // Wait for all videos to have enough data to play before recording
                await Promise.all(
                    videos.map(v =>
                        new Promise(res => {
                            if (v.el.readyState >= 2) res();
                            else {
                                let fired = false;
                                const onData = () => {
                                    if (!fired) { fired = true; res(); }
                                    v.el.removeEventListener('loadeddata', onData);
                                };
                                v.el.addEventListener('loadeddata', onData);
                                setTimeout(() => { if (!fired) { fired = true; res(); } }, 2000);
                            }
                        })
                    )
                );

                // Start Recording
                recorder.start();
                videos.forEach(v => {
                    try {
                        v.el.currentTime = 0;
                        v.el.play();
                    } catch (e) {
                        console.error("Play error", e);
                    }
                });

                // Animation Loop
                let animationId;
                const draw = () => {
                    if (recorder.state === 'inactive') return;

                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(0, 0, canvas.width, canvas.height);

                    // Draw Videos
                    videos.forEach(({ el, box }) => {
                        if (el.paused || el.ended) return;

                        const bx = (box.x / 100) * w;
                        const by = (box.y / 100) * h;
                        const bw = (box.width / 100) * w;
                        const bh = (box.height / 100) * h;

                        // Calculate object-cover dimensions
                        let drawW = bw;
                        let drawH = bh;
                        if (el.videoWidth > 0 && el.videoHeight > 0) {
                            const videoRatio = el.videoWidth / el.videoHeight;
                            const boxRatio = bw / bh;
                            if (videoRatio > boxRatio) {
                                drawH = bh;
                                drawW = bh * videoRatio;
                            } else {
                                drawW = bw;
                                drawH = bw / videoRatio;
                            }
                        }

                        const drawV = (offsetX) => {
                            ctx.save();
                            ctx.beginPath();
                            ctx.rect(bx + offsetX, by, bw, bh);
                            ctx.clip();

                            /* mirror quanh tâm frame */
                            ctx.translate(bx + offsetX + bw / 2, by + bh / 2);
                            ctx.scale(-1, 1);

                            try {
                                /* vẽ video centered object-cover */
                                ctx.drawImage(el, -drawW / 2, -drawH / 2, drawW, drawH);
                            } catch (err) { }
                            ctx.restore();
                        };

                        drawV(0); // Left
                        drawV(w); // Right (no gap)
                    });

                    // Draw Overlays
                    try {
                        ctx.drawImage(frameImg, 0, 0, w, h);
                        ctx.drawImage(frameImg, w, 0, w, h);
                    } catch (e) {
                        // ignore failed overlay draws on mobile
                    }

                    animationId = requestAnimationFrame(draw);
                };
                draw();

                // Stop after duration
                setTimeout(() => {
                    cancelAnimationFrame(animationId);
                    if (recorder.state !== 'inactive') recorder.stop();
                }, (maxDuration || 5) * 1000);
            };
            frameImg.onerror = reject;
            frameImg.src = session.meta_data.frame_url;
        });
    };

    const forceDownload = async (url, filename) => {
        try {
            const response = await fetch(url);
            const blob = await response.blob();
            const blobUrl = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = blobUrl;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(blobUrl);
        } catch (error) {
            console.error("Download failed:", error);
            // Fallback opening in new tab
            window.open(url, '_blank');
        }
    };

    const downloadStatic = async (isStrip) => {
        if (!session?.composite_url) return;
        try {
            let url = session.composite_url;
            let filename = `tomato_print_${id.slice(0, 4)}.jpg`;

            if (isStrip) {
                url = await createDoubleStripImage(session.composite_url);
                filename = `tomato_print_double_${id.slice(0, 4)}.jpg`;
                // createDoubleStripImage returns a data URL, so we can just download it directly
                const link = document.createElement('a');
                link.href = url;
                link.download = filename;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            } else {
                // Not a strip - this is a cross-origin cloudinary URL, use forceDownload
                await forceDownload(url, filename);
            }
        } catch (e) {
            console.error("Download static failed", e);
        }
    };

    const convertWebmToMp4 = async (webmUrl, fallbackName) => {
        try {
            const blob = await fetch(webmUrl).then(r => r.blob());
            const formData = new FormData();
            formData.append('file', blob, 'motion.webm');

            const apiUrl = import.meta.env.VITE_API_URL || '';

            const res = await axios.post(
                `${apiUrl}/api/convert-motion`,
                formData,
                {
                    responseType: 'blob',
                    headers: { 'Accept': 'video/mp4' }
                }
            );

            const mp4Blob = new Blob([res.data], { type: 'video/mp4' });
            const mp4Url = URL.createObjectURL(mp4Blob);

            return {
                url: mp4Url,
                name: fallbackName.replace('.webm', '.mp4'),
                ext: 'mp4'
            };

        } catch (e) {
            console.error("MP4 convert fail -> fallback WEBM", e);
            return { url: webmUrl, name: fallbackName, ext: 'webm' };
        }
    };

    const downloadMotion = async (isStrip) => {
        try {
            // Generate Motion Video locally
            const { url: webmUrl } = isStrip ? await generateDoubleMotionVideo() : await generateSingleMotionVideo();
            let baseName = isStrip ? `tomato_motion_double_${id.slice(0, 4)}.webm` : `tomato_motion_${id.slice(0, 4)}.webm`;

            // Try converting to MP4 via Backend
            const { url: finalUrl, name: finalName } = await convertWebmToMp4(webmUrl, baseName);



            if (finalUrl.startsWith('http')) {
                // It's a Cloudinary URL (MP4 via Backend)
                await forceDownload(finalUrl, finalName);
            } else {
                // It's a local object URL (WEBM from captureStream)
                const link = document.createElement('a');
                link.href = finalUrl;
                link.download = finalName;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            }
        } catch (e) {
            console.error("Download motion failed", e);
        }
    };

    const downloadAll = async (isStrip) => {
        const files = [];

        // 1. Generate Strip IMAGE or single original layout
        if (session?.composite_url) {
            try {
                if (isStrip) {
                    const doubleStripUrl = await createDoubleStripImage(session.composite_url);
                    files.push({ url: doubleStripUrl, name: `tomato_print_double_${id.slice(0, 4)}.jpg` });
                } else {
                    files.push({ url: session.composite_url, name: `tomato_print_${id.slice(0, 4)}.jpg` });
                }
            } catch (e) {
                console.error("Failed to generate double strip", e);
                files.push({ url: session.composite_url, name: `tomato_print_${id.slice(0, 4)}.png` });
            }
        }

        // 2. Generate Strip VIDEO if applicable
        try {
            if (session?.photos?.some(p => p.video_url)) {
                if (isStrip) {
                    const { url: videoUrl } = await generateDoubleMotionVideo();
                    const { url: finalUrl, name: finalName } = await convertWebmToMp4(videoUrl, `tomato_motion_double_${id.slice(0, 4)}.webm`);
                    files.push({ url: finalUrl, name: finalName });
                } else {
                    const { url: videoUrl } = await generateSingleMotionVideo();
                    const { url: finalUrl, name: finalName } = await convertWebmToMp4(videoUrl, `tomato_motion_${id.slice(0, 4)}.webm`);
                    files.push({ url: finalUrl, name: finalName });
                }
            }
        } catch (e) {
            console.error("Failed to generate motion video", e);
        }

        // 3. Original Photos & Single Videos
        if (session?.photos) {
            session.photos.forEach((p, i) => {
                const url = p.url || p;
                files.push({ url, name: `tomato_photo_${i + 1}_${id.slice(0, 4)}.jpg` });
            });
        }

        // Batch Download
        for (let i = 0; i < files.length; i++) {
            const file = files[i];

            try {
                let objectUrl = file.url;
                let isHttp = file.url.startsWith('http');

                if (isHttp) {
                    const response = await fetch(file.url);
                    const blob = await response.blob();
                    objectUrl = URL.createObjectURL(blob);
                }

                const link = document.createElement('a');
                link.href = objectUrl;
                link.download = file.name;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);

                if (isHttp) {
                    URL.revokeObjectURL(objectUrl);
                }
            } catch (error) {
                console.error("Failed to download file:", file.url, error);
            }

            await new Promise(resolve => setTimeout(resolve, 800));
        }
    };

    if (loading) return <div className="min-h-screen flex items-center justify-center bg-[#F1F3EE] font-serif italic text-[#52796f]">Đang tải kỷ niệm...</div>;

    if (error) return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-[#F1F3EE] font-serif px-4">
            <div className="flex flex-col items-center bg-white/80 p-10 rounded-3xl shadow-xl max-w-lg w-full backdrop-blur-md border border-white/50">
                <img src={LogoTomato} alt="Tomato Photobooth Logo" className="w-32 h-auto mb-6 drop-shadow-sm" />
                <h2 className="text-2xl md:text-3xl font-bold text-[#354f52] mb-4 text-center tracking-wide">Rất Tiếc!</h2>
                <div className="w-12 h-1 bg-[#8C9E8E] mb-6 rounded-full"></div>
                <p className="text-lg md:text-xl text-[#52796f] text-center mb-10 leading-relaxed italic">
                    {error}
                </p>
                <p className="text-sm text-[#8C9E8E] mb-4 font-semibold uppercase tracking-wider">Theo dõi chúng tôi tại</p>
                <div className="flex gap-6 items-center justify-center">
                    <a href="https://www.facebook.com/profile.php?id=61583398170126" target="_blank" rel="noopener noreferrer" className="p-3 bg-[#e8ece9] rounded-full text-[#354f52] hover:bg-[#8C9E8E] hover:text-white transition-all transform hover:-translate-y-1 shadow-sm">
                        <Facebook size={22} />
                    </a>
                    <a href="https://www.instagram.com/tomato.photobooth?fbclid=IwY2xjawQKOIRleHRuA2FlbQIxMABicmlkETJscHhhYmZENUFuRUJ0SFpPc3J0YwZhcHBfaWQQMjIyMDM5MTc4ODIwMDg5MgABHsc2EZwl_l3j4J-c7dp_cHIqSwz7Xd_YqksAVhVsSrS3_i6wfpEXzjIs641__aem_gNUuKjjb_8XtOpQco8PI2w" target="_blank" rel="noopener noreferrer" className="p-3 bg-[#e8ece9] rounded-full text-[#354f52] hover:bg-[#8C9E8E] hover:text-white transition-all transform hover:-translate-y-1 shadow-sm">
                        <Instagram size={22} />
                    </a>
                    <a href="https://www.tiktok.com/@tomato.photobooth?fbclid=IwY2xjawQKOIdleHRuA2FlbQIxMABicmlkETJscHhhYmZENUFuRUJ0SFpPc3J0YwZhcHBfaWQQMjIyMDM5MTc4ODIwMDg5MgABHrkDDKUjG0EQ4Om0L1PsQuz5xlK0oNzmPCe0a5x67LQ-9xn68R7FvewLx4PJ_aem_QeORumRzh7tiwjFC0v6XTw" target="_blank" rel="noopener noreferrer" className="p-3 bg-[#e8ece9] rounded-full text-[#354f52] hover:bg-[#8C9E8E] hover:text-white transition-all transform hover:-translate-y-1 shadow-sm flex items-center justify-center">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5v3a8 8 0 0 1-5-3v5.5a4 4 0 0 1-4 4Z" />
                        </svg>
                    </a>
                </div>
            </div>

            <footer className="mt-12 text-center opacity-60">
                <p className="tracking-widest uppercase text-xs text-[#52796f]">Tomato Photobooth © 2026</p>
            </footer>
        </div>
    );

    return (
        <div className="h-screen overflow-y-auto bg-[#F7F9F5] font-serif pb-20">
            <header className="text-center pt-12 pb-6 px-4 space-y-2">
                <h1 className="text-3xl md:text-5xl font-bold text-[#354f52] tracking-[0.1em] uppercase">
                    TOMATO PHOTOBOOTH
                </h1>
                <p className="text-[#52796f] italic text-sm md:text-base tracking-wide">
                    Lưu ý link sẽ hết hạn sau 72h
                </p>
            </header>

            <main className="max-w-6xl mx-auto px-4 md:px-8">
                {/* Download Button - Top Right */}
                <div className="flex justify-end mb-6">
                    {(() => {
                        const layoutId = session?.layout_id || session?.meta_data?.layout_id || '';
                        const isStrip = layoutId === 'strip_4' || layoutId === 'strip_3';
                        return (
                            <button
                                onClick={() => downloadAll(isStrip)}
                                className="bg-[#8C9E8E] text-white px-6 py-2 rounded-xl shadow-md hover:bg-[#6b7c6e] transition-colors font-bold text-sm tracking-wide flex items-center gap-2"
                            >
                                Tải xuống tất cả
                            </button>
                        );
                    })()}
                </div>

                {/* Main Content Area */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 lg:gap-16 items-start justify-center mb-16 px-4 md:px-0">
                    {(() => {
                        // Extract layout ID from either the root session object or nested meta_data (legacy)
                        const layoutId = session?.layout_id || session?.meta_data?.layout_id || '';

                        // Strict check: Only classical 'strip_3' or 'strip_4' are vertical double strips.
                        // All other single grids/horizontals should be shown as 1x.
                        const isStrip = layoutId === 'strip_4' || layoutId === 'strip_3';
                        const showDouble = isStrip;


                        return (
                            <>
                                {/* LEFT: STATIC COMPOSITE */}
                                <div className="flex flex-col items-center gap-2 w-full">
                                    {session?.composite_url && (
                                        <div className="flex flex-row gap-0 bg-white p-1 shadow-2xl relative group cursor-pointer w-full max-w-[450px]" onClick={() => downloadStatic(isStrip)}>
                                            <img
                                                src={session.composite_url}
                                                className={`${showDouble ? 'w-1/2' : 'w-full'} h-auto object-contain`}
                                                alt="Original Print 1"
                                            />
                                            {showDouble && (
                                                <img
                                                    src={session.composite_url}
                                                    className="w-1/2 h-auto object-contain"
                                                    alt="Original Print 2"
                                                />
                                            )}
                                            <div className="absolute top-4 right-4 bg-white/90 hover:bg-white text-[#52796f] p-3 rounded-full shadow-lg transition-transform hover:scale-105 flex items-center justify-center z-20">
                                                <Download size={24} strokeWidth={2.5} />
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* RIGHT: MOTION STRIP */}
                                <div className="flex flex-col items-center gap-2 w-full">
                                    <div className="flex flex-row gap-0 bg-white p-1 shadow-2xl relative group cursor-pointer w-full max-w-[450px]" onClick={() => downloadMotion(isStrip)}>
                                        <div className={`${showDouble ? 'w-1/2' : 'w-full'} relative`}>
                                            {renderMotionStrip(false)}
                                        </div>
                                        {showDouble && (
                                            <div className="w-1/2 relative">
                                                {renderMotionStrip(true)}
                                            </div>
                                        )}
                                        <div className="absolute top-4 right-4 bg-white/90 hover:bg-white text-[#52796f] p-3 rounded-full shadow-lg transition-transform hover:scale-105 flex items-center justify-center z-20">
                                            <Download size={24} strokeWidth={2.5} />
                                        </div>
                                    </div>
                                </div>
                            </>
                        );
                    })()}
                </div>

                {/* BOTTOM: ORIGINALS GRID (2x2) */}
                <div className="max-w-4xl mx-auto mt-12">
                    <div className="grid grid-cols-2 gap-4 md:gap-8">
                        {session?.photos?.map((p, i) => (
                            <div key={i} className="bg-[#8C9E8E]/20 p-2 md:p-4 shadow-sm">
                                <div className="aspect-[4/3] bg-gray-100 overflow-hidden relative group">
                                    <img
                                        src={p.url || p}
                                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                                        alt={`Original ${i + 1}`}
                                    />
                                    {/* Number Overlay */}
                                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                        {/* Optional: big number overlay like mockup? Mockup has number in center. */}
                                        {/* <span className="text-4xl text-white/50 font-bold">{i+1}</span> */}
                                    </div>
                                    <button
                                        onClick={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            forceDownload(p.url || p, `tomato_photo_${i + 1}_${id.slice(0, 4)}.jpg`);
                                        }}
                                        className="absolute top-3 right-3 bg-white/90 hover:bg-white text-[#52796f] p-2.5 rounded-full shadow-md transition-transform hover:scale-110 flex items-center justify-center z-20"
                                    >
                                        <Download size={20} strokeWidth={2.5} />
                                    </button>
                                </div>
                                <div className="text-center mt-3">
                                    <span className="text-xl md:text-2xl font-serif text-[#354f52] opacity-80">{i + 1}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <footer className="mt-20 text-center opacity-60 pb-8">
                    <p className="tracking-widest uppercase text-xs text-[#52796f]">Session ID: {id}</p>
                    <p className="text-xs text-[#52796f] mt-1 italic">Tomato Photobooth © 2026</p>
                </footer>
            </main>
        </div>
    );
};

export default ViewPage;