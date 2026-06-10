const DIGICAM_API = 'http://localhost:5513';

export const CameraService = {
    // Lấy đường dẫn Liveview Stream
    getLiveViewUrl: () => `${DIGICAM_API}/liveview.jpg?t=${Date.now()}`,

    // Gửi lệnh chụp ảnh
    triggerCapture: async () => {
        try {
            // Gọi lệnh chụp của digiCamControl
            const response = await fetch(`${DIGICAM_API}/?cmd=Capture`);
            if (!response.ok) throw new Error('Capture failed');

            // Đợi một chút để ảnh lưu xong (digiCamControl trả về tên file trong response nếu config đúng, nhưng ta sẽ dùng watcher của backend thì an toàn hơn)
            const data = await response.json();
            return data;
        } catch (error) {
            console.error("Camera trigger error:", error);
            // Giả lập cho dev environment nếu không có camera thật
            if (import.meta.env.DEV) {
                console.warn("Running in DEV mode, returning mock data");
                return { success: true, mock: true };
            }
            throw error;
        }
    },

    // Ping để kiểm tra digiCamControl có đang chạy không
    checkConnection: async () => {
        try {
            await fetch(DIGICAM_API);
            return true;
        } catch {
            return false;
        }
    }
};
