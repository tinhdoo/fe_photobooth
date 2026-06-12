import { useEffect, useState } from 'react';
import axios from 'axios';
import { Banknote, Monitor, Power, RefreshCw, Save } from 'lucide-react';
import { io } from 'socket.io-client';
import { getDeviceId } from '../../utils/deviceId';

const defaultHexCodes = ['40', '41', '42', '43', '44', '45', '46', '47'];

const BillSettings = () => {
    const [devices, setDevices] = useState([]);
    const [selectedDeviceId, setSelectedDeviceId] = useState('');
    const [currentDeviceId, setCurrentDeviceId] = useState('');
    const [config, setConfig] = useState({ port: 'COM3', baudrate: 9600, enabled: false });
    const [mapping, setMapping] = useState({});
    const [ports, setPorts] = useState([]);
    const [status, setStatus] = useState({ state: 'disconnected', message: 'Chưa kết nối' });
    const [lastDebug, setLastDebug] = useState(null);
    const [loading, setLoading] = useState(true);
    const [message, setMessage] = useState(null);

    const selectedIsLocal = selectedDeviceId && selectedDeviceId === currentDeviceId;

    useEffect(() => {
        const socket = io('/', {
            transports: ['polling'],
            auth: { deviceId: getDeviceId() }
        });

        socket.on('bill_status', (data) => {
            if (!data.device_id || data.device_id === selectedDeviceId) {
                setStatus({
                    state: data.status,
                    message: data.status === 'connected'
                        ? `Đã kết nối ${data.port || ''}`.trim()
                        : `Lỗi: ${data.message || 'Không xác định'}`
                });
            }
        });

        socket.on('bill_debug', (data) => {
            if (!data.device_id || data.device_id === selectedDeviceId) {
                setLastDebug(data.hex);
            }
        });

        socket.on('config_updated_global', (data) => {
            if (data.device_id === selectedDeviceId) {
                fetchConfig(selectedDeviceId);
            }
        });

        return () => socket.disconnect();
    }, [selectedDeviceId]);

    useEffect(() => {
        fetchDevices();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (selectedDeviceId) {
            fetchConfig(selectedDeviceId);
        }
    }, [selectedDeviceId]);

    const fetchDevices = async () => {
        setLoading(true);
        try {
            const [statusRes, devicesRes] = await Promise.all([
                axios.get('/api/bill/status'),
                axios.get('/api/devices')
            ]);

            const localId = statusRes.data?.device_id || getDeviceId();
            setCurrentDeviceId(localId);
            setSelectedDeviceId((prev) => prev || localId);
            setStatus({
                state: statusRes.data?.status || 'disconnected',
                message: statusRes.data?.status === 'connected'
                    ? `Đã kết nối ${statusRes.data?.port || ''}`.trim()
                    : statusRes.data?.enabled
                        ? 'Chưa kết nối'
                        : 'Đang tắt'
            });
            setDevices(Array.isArray(devicesRes.data) ? devicesRes.data : []);
            fetchPorts();
        } catch (error) {
            console.error('Failed to fetch bill devices', error);
            setMessage({ type: 'error', text: 'Không tải được danh sách thiết bị.' });
        } finally {
            setLoading(false);
        }
    };

    const fetchPorts = async () => {
        try {
            const res = await axios.get('/api/bill/ports');
            setPorts(Array.isArray(res.data) ? res.data : []);
        } catch (error) {
            console.warn('Failed to fetch serial ports', error);
            setPorts([]);
        }
    };

    const fetchConfig = async (deviceId) => {
        setLoading(true);
        try {
            const res = await axios.get(`/api/devices/${deviceId}/config`);
            const data = res.data;

            setConfig({
                port: data.bill_port || 'COM3',
                baudrate: parseInt(data.bill_baudrate, 10) || 9600,
                enabled: data.bill_enabled === 'true'
            });

            try {
                setMapping(data.bill_mapping ? JSON.parse(data.bill_mapping) : {});
            } catch {
                setMapping({});
            }
        } catch (error) {
            console.error('Failed to load bill config', error);
            setMessage({ type: 'error', text: 'Không tải được cấu hình đầu đọc tiền.' });
        } finally {
            setLoading(false);
        }
    };

    const handleConfigChange = (event) => {
        const { name, value, type, checked } = event.target;
        setConfig((prev) => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value
        }));
    };

    const handleMappingChange = (hex, value) => {
        setMapping((prev) => ({
            ...prev,
            [hex]: parseInt(value, 10) || 0
        }));
    };

    const saveConfig = async () => {
        if (!selectedDeviceId) return;

        try {
            await axios.post(`/api/devices/${selectedDeviceId}/config`, {
                bill_port: config.port,
                bill_baudrate: config.baudrate,
                bill_enabled: config.enabled,
                bill_mapping: JSON.stringify(mapping)
            });
            setMessage({ type: 'success', text: `Đã lưu cấu hình cho ${selectedDeviceId}.` });
            if (selectedIsLocal) {
                setStatus({
                    state: config.enabled ? 'restarting' : 'disabled',
                    message: config.enabled ? 'Đang khởi động lại đầu đọc...' : 'Đang tắt'
                });
            }
        } catch (error) {
            setMessage({ type: 'error', text: `Lỗi lưu cấu hình: ${error.message}` });
        }

        setTimeout(() => setMessage(null), 3000);
    };

    if (loading && !selectedDeviceId) {
        return <div className="p-8 text-center text-gray-500">Đang tải danh sách thiết bị...</div>;
    }

    const statusIsConnected = status.state === 'connected';

    return (
        <div className="space-y-8">
            <div>
                <h2 className="text-3xl font-bold text-[#2f3e46]">Cài đặt đầu đọc tiền</h2>
                <p className="text-[#52796f]">Cấu hình cổng COM, baudrate và mệnh giá nhận tiền mặt.</p>
            </div>

            {message && (
                <div className={`rounded-lg p-4 ${message.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                    {message.text}
                </div>
            )}

            <div className="flex flex-col items-start gap-6 xl:flex-row">
                <div className="w-full space-y-6 xl:w-1/3">
                    <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
                        <div className="mb-4 flex items-center gap-3">
                            <Monitor className="text-[#52796f]" />
                            <h3 className="text-xl font-bold text-[#2f3e46]">Thiết bị</h3>
                        </div>

                        <label className="mb-2 block text-sm font-medium text-gray-700">Chọn thiết bị cấu hình</label>
                        <select
                            value={selectedDeviceId}
                            onChange={(event) => setSelectedDeviceId(event.target.value)}
                            className="w-full rounded-lg border border-gray-200 px-3 py-2.5 shadow-sm focus:border-[#52796f] focus:ring-[#52796f]"
                        >
                            {devices.map((device) => (
                                <option key={device.device_id} value={device.device_id}>
                                    {device.name} {device.device_id === currentDeviceId ? '(Máy này)' : ''}
                                </option>
                            ))}
                        </select>

                        {!selectedIsLocal && selectedDeviceId && (
                            <div className="mt-3 rounded-lg bg-orange-50 px-3 py-2 text-xs text-orange-600">
                                Bạn đang cấu hình thiết bị khác. Trạng thái live chỉ chính xác khi máy đó đang mở.
                            </div>
                        )}
                    </div>

                    <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
                        <div className="mb-6 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Power size={20} className={config.enabled ? 'text-green-600' : 'text-gray-400'} />
                                <h3 className="text-xl font-bold text-[#2f3e46]">Kết nối</h3>
                            </div>
                            <label className="relative inline-flex cursor-pointer items-center">
                                <input
                                    type="checkbox"
                                    name="enabled"
                                    checked={config.enabled}
                                    onChange={handleConfigChange}
                                    className="peer sr-only"
                                />
                                <div className="peer h-6 w-11 rounded-full bg-gray-200 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-[#52796f] peer-checked:after:translate-x-full peer-checked:after:border-white" />
                            </label>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label className="mb-1 block text-sm font-medium text-gray-700">Cổng COM</label>
                                {ports.length > 0 ? (
                                    <select
                                        name="port"
                                        value={config.port}
                                        onChange={handleConfigChange}
                                        className="block w-full rounded-lg border border-gray-200 px-3 py-2.5 shadow-sm focus:border-[#52796f] focus:ring-[#52796f]"
                                    >
                                        {ports.map((port) => (
                                            <option key={port.device} value={port.device}>
                                                {port.device} - {port.description}
                                            </option>
                                        ))}
                                        {!ports.some((port) => port.device === config.port) && (
                                            <option value={config.port}>{config.port}</option>
                                        )}
                                    </select>
                                ) : (
                                    <input
                                        type="text"
                                        name="port"
                                        value={config.port}
                                        onChange={handleConfigChange}
                                        placeholder="COM3"
                                        className="block w-full rounded-lg border border-gray-200 px-3 py-2.5 shadow-sm focus:border-[#52796f] focus:ring-[#52796f]"
                                    />
                                )}
                                <button
                                    type="button"
                                    onClick={fetchPorts}
                                    className="mt-2 text-sm font-semibold text-[#52796f]"
                                >
                                    Quét lại cổng COM
                                </button>
                            </div>

                            <div>
                                <label className="mb-1 block text-sm font-medium text-gray-700">Baudrate</label>
                                <select
                                    name="baudrate"
                                    value={config.baudrate}
                                    onChange={handleConfigChange}
                                    className="block w-full rounded-lg border border-gray-200 px-3 py-2.5 shadow-sm focus:border-[#52796f] focus:ring-[#52796f]"
                                >
                                    <option value="9600">9600</option>
                                    <option value="19200">19200</option>
                                    <option value="115200">115200</option>
                                </select>
                            </div>

                            <div className="flex items-center justify-between border-t border-gray-50 pt-4">
                                <span className="text-sm text-gray-500">Trạng thái</span>
                                <div className="flex items-center gap-2">
                                    <span className={`inline-block h-2.5 w-2.5 rounded-full ${statusIsConnected ? 'bg-green-500' : 'bg-red-500'}`} />
                                    <span className={`text-sm font-bold ${statusIsConnected ? 'text-green-600' : 'text-red-500'}`}>
                                        {status.message}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="w-full space-y-6 xl:w-2/3">
                    <div className="rounded-2xl border border-gray-100 bg-white p-8 shadow-sm">
                        <div className="mb-6 flex items-center justify-between">
                            <h3 className="text-xl font-bold text-[#2f3e46]">Cấu hình mệnh giá</h3>
                            <button
                                type="button"
                                onClick={saveConfig}
                                className="inline-flex items-center rounded-xl bg-[#52796f] px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-green-900/10"
                            >
                                <Save size={18} className="mr-2" />
                                Lưu cấu hình
                            </button>
                        </div>

                        <p className="mb-6 rounded-xl bg-gray-50 p-4 text-sm text-gray-500">
                            Nhập giá trị tiền VND tương ứng với từng mã Hex đầu đọc gửi về. Đặt 0 để vô hiệu hóa mệnh giá đó.
                        </p>

                        <div className="grid grid-cols-2 gap-6 lg:grid-cols-4">
                            {defaultHexCodes.map((hex) => (
                                <div key={hex} className="space-y-2">
                                    <label className="block text-xs font-bold uppercase tracking-wider text-gray-400">Mã 0x{hex}</label>
                                    <div className="relative rounded-lg shadow-sm">
                                        <input
                                            type="number"
                                            value={mapping[hex] || ''}
                                            onChange={(event) => handleMappingChange(hex, event.target.value)}
                                            className="block w-full rounded-lg border border-gray-200 py-3 pl-4 pr-12 font-mono text-lg font-medium focus:border-[#52796f] focus:ring-[#52796f]"
                                            placeholder="0"
                                        />
                                        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
                                            <span className="text-xs font-bold text-gray-400">VND</span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="rounded-2xl border border-gray-700 bg-[#2f3e46] p-6 text-white shadow-inner">
                        <div className="mb-4 flex items-center gap-3">
                            <div className="rounded-lg bg-white/10 p-2">
                                <RefreshCw size={20} className="text-green-400" />
                            </div>
                            <h4 className="text-lg font-bold">Live debugger</h4>
                        </div>

                        <div className="flex items-center justify-between rounded-xl border border-white/5 bg-black/20 p-6">
                            <span className="text-gray-400">Mã Hex nhận gần nhất</span>
                            <div className="font-mono text-3xl font-bold tracking-wider text-green-400">
                                {lastDebug ? `0x${lastDebug}` : '--'}
                            </div>
                        </div>
                        <p className="mt-4 flex items-center gap-2 text-xs text-gray-400">
                            <Banknote size={14} />
                            Đút thử tiền vào máy để xem mã Hex xuất hiện tại đây.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default BillSettings;

