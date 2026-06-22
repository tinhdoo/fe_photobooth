// Tính giá hiệu lực hiện tại từ cấu hình + lịch đổi giá (price_schedule).
//
// Mô hình lịch (kiểu "mốc kích hoạt"):
//  - item.repeat === 'daily' : mỗi ngày tới ĐÚNG GIỜ của run_at -> đổi sang giá này, giữ tới mốc kế.
//  - còn lại (once)          : chạy MỘT lần khi đã qua run_at.
// Giá hiệu lực = giá của MỐC ĐÃ KÍCH HOẠT GẦN NHẤT (<= bây giờ). Mốc daily tự lặp qua nửa đêm.

const dailyTimeOf = (item) => {
    // Lấy giờ:phút trong ngày từ run_at (datetime-local) hoặc item.time ("HH:MM").
    if (item?.time && /^\d{1,2}:\d{2}/.test(item.time)) {
        const [h, m] = item.time.split(':').map(Number);
        return { h: h || 0, m: m || 0 };
    }
    if (item?.run_at) {
        const d = new Date(item.run_at);
        if (!isNaN(d)) return { h: d.getHours(), m: d.getMinutes() };
    }
    return null;
};

export const getCurrentPricing = (configs) => {
    const base = {
        price: parseInt(configs?.price) || 60000,
        print_price: parseInt(configs?.print_price) || 20000,
        mobile_price: parseInt(configs?.mobile_price) || 30000,
        mobile_print_price: parseInt(configs?.mobile_print_price) || 10000,
    };

    if (!configs?.price_schedule) return base;

    try {
        let schedule = configs.price_schedule;
        if (typeof schedule === 'string') schedule = JSON.parse(schedule);
        if (!Array.isArray(schedule) || schedule.length === 0) return base;

        const now = new Date();
        const DAY_MS = 24 * 60 * 60 * 1000;
        let best = null; // { firedAt: Date, item }

        for (const item of schedule) {
            if (!item || item.enabled === false) continue;

            let firedAt = null;
            if (item.repeat === 'daily') {
                const t = dailyTimeOf(item);
                if (!t) continue;
                const todayAt = new Date(now);
                todayAt.setHours(t.h, t.m, 0, 0);
                // Mốc gần nhất đã qua: hôm nay@T nếu đã tới, ngược lại hôm qua@T (giữ giá qua nửa đêm).
                firedAt = todayAt <= now ? todayAt : new Date(todayAt.getTime() - DAY_MS);
            } else if (item.run_at) {
                const d = new Date(item.run_at);
                if (isNaN(d) || d > now) continue; // một lần: chỉ tính khi đã qua
                firedAt = d;
            }

            if (!firedAt) continue;
            if (!best || firedAt > best.firedAt) best = { firedAt, item };
        }

        if (best) {
            const it = best.item;
            return {
                price: parseInt(it.price) || base.price,
                print_price: parseInt(it.print_price) || base.print_price,
                mobile_price: parseInt(it.mobile_price) || base.mobile_price,
                mobile_print_price: parseInt(it.mobile_print_price) || base.mobile_print_price,
            };
        }
    } catch (e) {
        console.error("Error parsing price schedule:", e);
    }

    return base;
};
