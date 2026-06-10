import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Monitor, Zap, DollarSign, RefreshCw, Edit2, Check, X, Trash2, AlertTriangle } from 'lucide-react';

const DeviceManager = () => {
    const [devices, setDevices] = useState([]);
    const [loading, setLoading] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [editName, setEditName] = useState('');
    const [deleteTarget, setDeleteTarget] = useState(null); // device to confirm delete

    const fetchDevices = async () => {
        setLoading(true);
        try {
            const res = await axios.get('/api/devices');
            setDevices(Array.isArray(res.data) ? res.data : []);
        } catch (error) {
            console.error("Failed to fetch devices:", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchDevices();
        const interval = setInterval(fetchDevices, 10000);
        return () => clearInterval(interval);
    }, []);

    const toggleMode = async (device) => {
        const newMode = device.mode === 'event' ? 'payment' : 'event';
        try {
            await axios.put(`/api/devices/${device.id}`, { mode: newMode });
            fetchDevices();
        } catch (error) {
            console.error("Failed to update mode:", error);
        }
    };

    const startEdit = (device) => {
        setEditingId(device.id);
        setEditName(device.name);
    };

    const saveName = async (id) => {
        try {
            await axios.put(`/api/devices/${id}`, { name: editName });
            setEditingId(null);
            fetchDevices();
        } catch (error) {
            console.error("Failed to update name:", error);
        }
    };

    const confirmDelete = async () => {
        if (!deleteTarget) return;
        try {
            await axios.delete(`/api/devices/${deleteTarget.id}`);
            setDeleteTarget(null);
            fetchDevices();
        } catch (error) {
            console.error("Failed to delete device:", error);
        }
    };

    return (
        <div className="space-y-8 animate-fadeIn">
            {/* Delete Confirmation Modal */}
            {deleteTarget && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-sm mx-4 flex flex-col items-center gap-5">
                        <div className="p-4 bg-red-50 rounded-full">
                            <AlertTriangle size={32} className="text-red-500" />
                        </div>
                        <div className="text-center">
                            <h3 className="text-lg font-bold text-[#2f3e46] mb-1">Xóa thiết bị?</h3>
                            <p className="text-sm text-gray-500">
                                Thiết bị <span className="font-semibold text-[#2f3e46]">"{deleteTarget.name}"</span> sẽ bị xóa khỏi hệ thống.
                                Khi mở lại, máy đó sẽ tự đăng ký lại.
                            </p>
                        </div>
                        <div className="flex gap-3 w-full">
                            <button
                                onClick={() => setDeleteTarget(null)}
                                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-600 font-semibold hover:bg-gray-50 transition-colors"
                            >
                                Hủy
                            </button>
                            <button
                                onClick={confirmDelete}
                                className="flex-1 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white font-semibold transition-colors"
                            >
                                Xóa
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className="flex justify-end items-center">
                <button
                    onClick={fetchDevices}
                    className="p-2 text-gray-500 hover:text-[#52796f] transition-colors"
                >
                    <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {devices.map((device) => (
                    <div key={device.id} className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col gap-4">
                        <div className="flex justify-between items-start">
                            <div className="p-3 bg-gray-100 rounded-xl text-gray-600">
                                <Monitor size={24} />
                            </div>
                            <div className="flex items-center gap-2">
                                <div className={`px-3 py-1 rounded-full text-xs font-bold uppercase ${device.mode === 'event' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
                                    }`}>
                                    {device.mode === 'event' ? 'Chế độ Sự kiện' : 'Chế độ Thanh toán'}
                                </div>
                                <button
                                    onClick={() => setDeleteTarget(device)}
                                    className="p-1 text-gray-300 hover:text-red-500 transition-colors"
                                    title="Xóa thiết bị"
                                >
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        </div>

                        <div>
                            {editingId === device.id ? (
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={editName}
                                        onChange={(e) => setEditName(e.target.value)}
                                        className="border border-gray-300 rounded px-2 py-1 text-sm w-full"
                                        autoFocus
                                    />
                                    <button onClick={() => saveName(device.id)} className="text-green-600"><Check size={18} /></button>
                                    <button onClick={() => setEditingId(null)} className="text-red-500"><X size={18} /></button>
                                </div>
                            ) : (
                                <h3 className="text-xl font-bold text-[#2f3e46] flex items-center gap-2 group">
                                    {device.name}
                                    <button onClick={() => startEdit(device)} className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-gray-600 transition-opacity">
                                        <Edit2 size={14} />
                                    </button>
                                </h3>
                            )}
                            <p className="text-xs text-gray-400 font-mono mt-1">ID: {device.device_id}</p>
                            <p className="text-xs text-gray-400 mt-1">
                                Hoạt động gần nhất: {device.last_active ? new Date(device.last_active).toLocaleString() : 'Chưa bao giờ'}
                            </p>
                        </div>

                        <div className="mt-auto pt-4 border-t border-gray-50">
                            <button
                                onClick={() => toggleMode(device)}
                                className={`w-full py-2 rounded-lg font-bold text-sm transition-colors flex items-center justify-center gap-2 ${device.mode === 'event'
                                    ? 'bg-white border border-blue-200 text-blue-600 hover:bg-blue-50'
                                    : 'bg-white border border-purple-200 text-purple-600 hover:bg-purple-50'
                                    }`}
                            >
                                {device.mode === 'event' ? (
                                    <>Chuyển sang Trả phí <DollarSign size={16} /></>
                                ) : (
                                    <>Chuyển sang Sự kiện <Zap size={16} /></>
                                )}
                            </button>
                        </div>
                    </div>
                ))}

                {devices.length === 0 && (
                    <div className="col-span-full text-center py-12 text-gray-400">
                        Chưa có thiết bị nào kết nối. Mở photobooth trên thiết bị để đăng ký.
                    </div>
                )}
            </div>
        </div>
    );
};

export default DeviceManager;
