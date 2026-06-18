export const getCurrentPricing = (configs) => {
    // Default prices from configs
    let currentPricing = {
        price: parseInt(configs?.price) || 60000,
        print_price: parseInt(configs?.print_price) || 20000,
        mobile_price: parseInt(configs?.mobile_price) || 30000,
        mobile_print_price: parseInt(configs?.mobile_print_price) || 10000,
    };

    if (!configs?.price_schedule) return currentPricing;

    try {
        let schedule = configs.price_schedule;
        if (typeof schedule === 'string') {
            schedule = JSON.parse(schedule);
        }
        
        if (!Array.isArray(schedule) || schedule.length === 0) return currentPricing;

        const now = new Date();
        const currentHours = now.getHours();
        const currentMinutes = now.getMinutes();
        const currentTotalMinutes = currentHours * 60 + currentMinutes;

        for (const item of schedule) {
            if (item.enabled === false || !item.start_time || !item.end_time) continue;

            const [startH, startM] = item.start_time.split(':').map(Number);
            const [endH, endM] = item.end_time.split(':').map(Number);

            const startTotal = startH * 60 + (startM || 0);
            const endTotal = endH * 60 + (endM || 0);

            let isMatch = false;

            if (startTotal <= endTotal) {
                // Same day: e.g. 09:00 to 17:00
                isMatch = currentTotalMinutes >= startTotal && currentTotalMinutes < endTotal;
            } else {
                // Crosses midnight: e.g. 17:00 to 08:00
                isMatch = currentTotalMinutes >= startTotal || currentTotalMinutes < endTotal;
            }

            if (isMatch) {
                currentPricing = {
                    price: parseInt(item.price) || currentPricing.price,
                    print_price: parseInt(item.print_price) || currentPricing.print_price,
                    mobile_price: parseInt(item.mobile_price) || currentPricing.mobile_price,
                    mobile_print_price: parseInt(item.mobile_print_price) || currentPricing.mobile_print_price,
                };
                break; // Use the first matching schedule
            }
        }
    } catch (e) {
        console.error("Error parsing price schedule:", e);
    }

    return currentPricing;
};
