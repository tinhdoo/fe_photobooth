import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { motion } from 'framer-motion';

const PhotoView = () => {
    const { id } = useParams();
    const [session, setSession] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchSession = async () => {
            try {
                // Ensure id is valid
                if (!id) return;
                const res = await axios.get(`/api/sessions/${id}`);
                setSession(res.data);
            } catch (err) {
                console.error("Error fetching session:", err);
            } finally {
                setLoading(false);
            }
        };
        fetchSession();
    }, [id]);

    if (loading) return <div className="h-screen w-full flex items-center justify-center text-[#52796f]">Loading...</div>;
    if (!session) return <div className="h-screen w-full flex items-center justify-center text-red-500">Session not found</div>;

    const photos = session.photos || [];

    return (
        <div className="min-h-screen bg-[#F9FAF7] p-8 flex flex-col items-center">

            <h1 className="text-3xl font-serif text-[#52796f] mb-8 uppercase tracking-widest text-center">
                Your Memories
            </h1>

            <div className="w-full max-w-6xl flex flex-col md:flex-row gap-8">

                {/* LEFT: Vertical Strip (All photos in a column) */}
                <div className="w-full md:w-1/3 flex flex-col gap-4">
                    <div className="bg-white p-4 shadow-xl rounded-lg flex flex-col gap-4 items-center">
                        {photos.map((photo, index) => (
                            <motion.div
                                key={index}
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: index * 0.1 }}
                                className="w-full aspect-[3/2] overflow-hidden rounded bg-gray-100"
                            >
                                <img
                                    src={photo.url}
                                    alt={`Photo ${index + 1}`}
                                    className="w-full h-full object-cover"
                                />
                            </motion.div>
                        ))}
                    </div>
                </div>

                {/* RIGHT: Grid & Video */}
                <div className="w-full md:w-2/3 flex flex-col gap-8">

                    {/* Top Right: 2x2 Grid */}
                    <div className="grid grid-cols-2 gap-4">
                        {photos.slice(0, 4).map((photo, index) => (
                            <motion.div
                                key={`grid-${index}`}
                                initial={{ opacity: 0, scale: 0.9 }}
                                animate={{ opacity: 1, scale: 1 }}
                                transition={{ delay: 0.4 + index * 0.1 }}
                                className="w-full aspect-[3/2] overflow-hidden rounded-lg shadow-md bg-white p-2"
                            >
                                <img
                                    src={photo.url}
                                    alt={`Grid ${index + 1}`}
                                    className="w-full h-full object-cover rounded"
                                />
                            </motion.div>
                        ))}
                    </div>

                    {/* Bottom Right: Video/GIF Placeholder */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 1 }}
                        className="w-full aspect-video bg-[#A8B5A0] rounded-xl flex items-center justify-center shadow-lg relative overflow-hidden"
                    >
                        {/* If we had a real GIF url, we'd show it here */}
                        {session.gif_url ? (
                            <img src={session.gif_url} className="w-full h-full object-cover" alt="Session GIF" />
                        ) : (
                            <div className="text-white font-serif text-2xl tracking-widest opacity-80">
                                VIDEO/GIF
                            </div>
                        )}
                    </motion.div>

                </div>

            </div>

            <div className="mt-12 text-[#52796f] text-sm font-sans">
                Quét mã QR để tải ảnh
            </div>

        </div>
    );
};

export default PhotoView;
