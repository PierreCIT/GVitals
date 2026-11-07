// Chart values use the sensor's raw units. Percent sensors normally use 0–1,
// while already formatted percentages (such as storage) use 0–100.
export function chartRange(key, format, values, totals) {
    if (format === 'percent') return [0, 1];
    if (format === 'percentage-string') return [0, 100];
    if (['_storage_used_', '_storage_free_', '_storage_total_'].includes(key) && totals._storage_total_ > 0)
        return [0, totals._storage_total_];
    const gpuMemory = key.match(/^(_gpu#\d+)_memory_(?:used|free|reserved|total)_$/);
    if (gpuMemory && totals[`${gpuMemory[1]}_memory_total_`] > 0)
        return [0, totals[`${gpuMemory[1]}_memory_total_`]];
    const finite = values.filter(Number.isFinite);
    if (!finite.length) return [0, 1];
    const min = Math.min(0, ...finite), max = Math.max(...finite);
    return [min, max > min ? max : min + 1];
}

export function chartPalette(settings, key) {
    const saved = settings.get_value('chart-palettes').deep_unpack()[key];
    if (!saved) return null;
    try {
        const config = JSON.parse(saved);
        if (!Number.isInteger(config.mode) || config.mode < 0 || config.mode > 6) return null;
        return config;
    } catch (_) {
        return null;
    }
}
