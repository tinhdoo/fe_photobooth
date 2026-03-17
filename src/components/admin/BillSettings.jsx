import { useState, useEffect } from 'react';
import axios from 'axios';
import { Save, RefreshCw, Power, Monitor } from 'lucide-react';
import { io } from "socket.io-client";
import { getDeviceId } from "../../utils/deviceId";

const BillSettings = () => {
    const [devices, setDevices] = useState([]);
    const [selectedDeviceId, setSelectedDeviceId] = useState(null);
    const [currentDeviceId, setCurrentDeviceId] = useState(null); // The ID of THIS local machine

    const [config, setConfig] = useState({
        port: 'COM3',
        baudrate: 9600,
        enabled: false,
    });
    const [mapping, setMapping] = useState({});
    const [status, setStatus] = useState('Chưa kết nối');
    const [lastDebug, setLastDebug] = useState(null);
    const [loading, setLoading] = useState(true);
    const [message, setMessage] = useState(null);

    // Initial Mapping State (To ensure fields exist even if empty)
    const defaultHexCodes = ['40', '41', '42', '43', '44', '45', '46', '47'];

    useEffect(() => {
        fetchDevices();

        // Socket Listeners for Status & Debug
        const socket = io('/', {
            transports: ['polling'],
            auth: { deviceId: getDeviceId() }
        });

        socket.on('bill_status', (data) => {
            // Only update status if it matches selected device OR if we are viewing LOCAL device
            if (!selectedDeviceId || selectedDeviceId === data.device_id) {
                setStatus(data.status === 'connected' ? 'Đã kết nối' : 'Lỗi: ' + (data.message || 'Không xác định'));
            }
        });

        // Debug messages usually come from LOCAL machine
        socket.on('bill_debug', (data) => {
            setLastDebug(data.hex);
        });

        // Auto-refresh if config updated remotely
        socket.on('config_updated_global', (data) => {
            if (data.device_id === selectedDeviceId) {
                fetchConfig(selectedDeviceId);
            }
        });

        return () => socket.disconnect();
    }, [selectedDeviceId]);

    const fetchDevices = async () => {
        try {
            // Get local status to know OUR ID
            const resStatus = await axios.get('/api/bill/status');
            const myId = resStatus.data.device_id;
            setCurrentDeviceId(myId);
            if (!selectedDeviceId) setSelectedDeviceId(myId);

            // Get List
            const res = await axios.get('/api/devices');
            setDevices(res.data);
        } catch (error) {
            console.error("Failed to fetch devices", error);
        }
    };

    useEffect(() => {
        if (selectedDeviceId) {
            fetchConfig(selectedDeviceId);
        }
    }, [selectedDeviceId]);

    const fetchConfig = async (deviceId) => {
        setLoading(true);
        try {
            const res = await axios.get(`/api/devices/${deviceId}/config`);
            const data = res.data;

            setConfig({
                port: data.bill_port || 'COM3',
                baudrate: parseInt(data.bill_baudrate) || 9600,
                enabled: data.bill_enabled === 'true'
            });

            const mapVal = data.bill_mapping ? JSON.parse(data.bill_mapping) : {};
            setMapping(mapVal);

            // For status, we rely on the socket updates or the initial load
        } catch (error) {
            console.error("Failed to load config", error);
        } finally {
            setLoading(false);
        }
    };

    const handleConfigChange = (e) => {
        const { name, value, type, checked } = e.target;
        setConfig(prev => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value
        }));
    };

    const handleMappingChange = (hex, value) => {
        setMapping(prev => ({
            ...prev,
            [hex]: parseInt(value) || 0
        }));
    };

    const saveConfig = async () => {
        if (!selectedDeviceId) return;
        try {
            const payload = {
                bill_port: config.port,
                bill_baudrate: config.baudrate,
                bill_enabled: config.enabled,
                bill_mapping: JSON.stringify(mapping)
            };

            await axios.post(`/api/devices/${selectedDeviceId}/config`, payload);
            setMessage({ type: 'success', text: `Đã lưu cấu hình cho ${selectedDeviceId}!` });
        } catch (error) {
            setMessage({ type: 'error', text: 'Lỗi lưu cấu hình: ' + error.message });
        }
        setTimeout(() => setMessage(null), 3000);
    };

    if (loading && !selectedDeviceId) return <div className="p-8 text-center text-gray-500">Đang tải danh sách thiết bị...</div>;

    return (
        <div className="space-y-8 animate-fadeIn">
            <div className="mb-8">
                <h2 className="text-3xl font-bold text-[#2f3e46]">Cài đặt Đầu Đọc Tiền</h2>
                <p className="text-[#52796f]">Cấu hình kết nối và mệnh giá cho thiết bị nhận tiền mặt.</p>
            </div>

            {message && (
                <div className={`p-4 rounded-lg mb-4 ${message.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                    {message.text}
                </div>
            )}

            <div className="flex gap-6 items-start flex-col xl:flex-row">
                {/* LEFT COLUMN: Connection & Device */}
                <div className="w-full xl:w-1/3 space-y-6">
                    {/* Device Selector */}
                    <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                        <div className="flex items-center gap-3 mb-4">
                            <Monitor className="text-[#52796f]" />
                            <h3 className="text-xl font-bold text-[#2f3e46]">Thiết bị</h3>
                        </div>

                        <div className="space-y-3">
                            <label className="block text-sm font-medium text-gray-700">Chọn thiết bị cấu hình</label>
                            <select
                                value={selectedDeviceId || ''}
                                onChange={(e) => setSelectedDeviceId(e.target.value)}
                                className="w-full rounded-lg border-gray-200 shadow-sm focus:border-[#52796f] focus:ring-[#52796f] py-2.5 px-3 border"
                            >
                                {devices.map(d => (
                                    <option key={d.device_id} value={d.device_id}>
                                        {d.name} {d.device_id === currentDeviceId ? '(Máy này)' : ''}
                                    </option>
                                ))}
                            </select>
                            {selectedDeviceId && selectedDeviceId !== currentDeviceId && (
                                <div className="text-xs text-orange-500 bg-orange-50 px-3 py-2 rounded-lg flex items-center gap-2">
                                    <span className="w-2 h-2 rounded-full bg-orange-500"></span>
                                    Đang cấu hình từ xa
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Connection Config */}
                    <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                        <div className="flex items-center justify-between mb-6">
                            <div className="flex items-center gap-2">
                                <Power size={20} className={config.enabled ? "text-green-600" : "text-gray-400"} />
                                <h3 className="text-xl font-bold text-[#2f3e46]">Kết nối</h3>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                    type="checkbox"
                                    name="enabled"
                                    checked={config.enabled}
                                    onChange={handleConfigChange}
                                    className="sr-only peer"
                                />
                                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#52796f]"></div>
                            </label>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Cổng COM</label>
                                <input
                                    type="text"
                                    name="port"
                                    value={config.port}
                                    onChange={handleConfigChange}
                                    placeholder="COM3"
                                    className="block w-full rounded-lg border-gray-200 shadow-sm focus:border-[#52796f] focus:ring-[#52796f] py-2.5 px-3 border"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">BaudRate</label>
                                <select
                                    name="baudrate"
                                    value={config.baudrate}
                                    onChange={handleConfigChange}
                                    className="block w-full rounded-lg border-gray-200 shadow-sm focus:border-[#52796f] focus:ring-[#52796f] py-2.5 px-3 border"
                                >
                                    <option value="9600">9600</option>
                                    <option value="19200">19200</option>
                                    <option value="115200">115200</option>
                                </select>
                            </div>

                            <div className="pt-4 border-t border-gray-50 flex justify-between items-center">
                                <span className="text-sm text-gray-500">Trạng thái:</span>
                                <div className="flex items-center gap-2">
                                    <span className={`inline-block w-2.5 h-2.5 rounded-full ${status === 'Đã kết nối' ? 'bg-green-500' : 'bg-red-500'}`}></span>
                                    <span className={`text-sm font-bold ${status === 'Đã kết nối' ? 'text-green-600' : 'text-red-500'}`}>
                                        {status}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* RIGHT COLUMN: Mapping & Debug */}
                <div className="w-full xl:w-2/3 space-y-6">
                    <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-100">
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-xl font-bold text-[#2f3e46]">Cấu hình Mệnh giá</h3>
                            <button
                                onClick={saveConfig}
                                className="inline-flex items-center px-5 py-2.5 border border-transparent text-sm font-bold rounded-xl shadow-lg shadow-green-900/10 text-white bg-[#52796f] hover:bg-[#3f6158] transition-all transform hover:-translate-y-0.5"
                            >
                                <Save size={18} className="mr-2" />
                                Lưu Cấu hình
                            </button>
                        </div>

                        <p className="text-sm text-gray-500 mb-6 bg-gray-50 p-4 rounded-xl">
                            Nhập giá trị tiền (VND) tương ứng với từng mã Hex mà đầu đọc gửi về.
                            Đặt là 0 để vô hiệu hóa mệnh giá đó.
                        </p>

                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
                            {defaultHexCodes.map(hex => (
                                <div key={hex} className="space-y-2">
                                    <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider">Mã 0x{hex}</label>
                                    <div className="relative rounded-lg shadow-sm">
                                        <input
                                            type="number"
                                            value={mapping[hex] || ''}
                                            onChange={(e) => handleMappingChange(hex, e.target.value)}
                                            className="block w-full rounded-lg border-gray-200 pl-4 pr-12 focus:border-[#52796f] focus:ring-[#52796f] py-3 border font-mono font-medium text-lg"
                                            placeholder="0"
                                        />
                                        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
                                            <span className="text-gray-400 text-xs font-bold">VND</span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Debug Info */}
                    <div className="bg-[#2f3e46] p-6 rounded-2xl border border-gray-700 text-white shadow-inner">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="p-2 bg-white/10 rounded-lg">
                                <RefreshCw size={20} className="text-green-400" />
                            </div>
                            <h4 className="font-bold text-lg">Live Debugger</h4>
                        </div>

                        <div className="flex items-center justify-between bg-black/20 p-6 rounded-xl border border-white/5">
                            <span className="text-gray-400">Mã Hex nhận được gần nhất:</span>
                            <div className="text-3xl font-mono font-bold text-green-400 tracking-wider">
                                {lastDebug ? `0x${lastDebug}` : '--'}
                            </div>
                        </div>
                        <p className="text-xs text-gray-400 mt-4 flex items-center gap-2">
                            <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></span>
                            Đút thử tiền vào máy để xem mã Hex xuất hiện ở đây.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default BillSettings;
