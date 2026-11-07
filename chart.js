import Cairo from 'cairo';
import Clutter from 'gi://Clutter';
import St from 'gi://St';
import {chartPalette} from './helpers/chartSettings.js';

const SENSOR_COLORS = {
    temperature: '#ff7800', voltage: '#e5a50a', fan: '#33d17a',
    memory: '#9141ac', processor: '#3584e4', system: '#2ec27e',
    storage: '#c061cb', network: '#00b3d6', battery: '#8ccf4d', gpu: '#e661a4',
};

// Presets are ordered from the low end to the high end of the visible range.
const PALETTES = {
    3: ['#000080', '#0000ff', '#00ffff', '#ffff00', '#ff0000', '#800000'], // Jet
    4: ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'], // Viridis
    5: ['#0d0887', '#7e03a8', '#cc4778', '#f89540', '#f0f921'], // Plasma
    6: ['#000004', '#57106e', '#bc3754', '#f98e09', '#fcffa4'], // Inferno
};

function colorFromHex(value, fallback) {
    if (!/^#[0-9a-f]{6}$/i.test(value)) value = fallback;
    return [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16) / 255);
}

export function createChart(samples, length, settings, key, range, panel = false) {
    const area = new St.DrawingArea({
        width: panel ? 48 : 80,
        height: panel ? 16 : 24,
        y_align: Clutter.ActorAlign.CENTER,
        style_class: 'vitals-chart',
    });
    const getPalette = () => {
        const group = key.replace(/^_+/, '').split(/[_#-]/)[0];
        const override = chartPalette(settings, key);
        const mode = override?.mode ?? settings.get_int('chart-color-mode');
        const fallback = SENSOR_COLORS[group] || '#3584e4';
        const low = colorFromHex(mode === 0 ? fallback : (override?.start || settings.get_string('chart-color-start')), fallback);
        const high = mode === 2 ? colorFromHex((override?.end || settings.get_string('chart-color-end')), '#e01b24') : low;
        return PALETTES[mode]?.map(color => colorFromHex(color, fallback)) || [low, high];
    };
    let palette = getPalette();
    area.refreshPalette = () => {
        palette = getPalette();
        area.queue_repaint();
    };
    area.connect('repaint', () => {
        const cr = area.get_context();
        const [width, height] = area.get_surface_size();
        const values = samples.slice(-length());
        if (values.length) {
            const [min, max] = range(values);
            const span = max - min || 1;
            const points = values.map((value, i) => [
                width - 1 - (values.length - 1 - i) * (width - 2) / (length() - 1),
                height - 2 - Math.max(0, Math.min(1, (value - min) / span)) * (height - 4),
            ]);
            if (points.length === 1) points.unshift([Math.max(0, points[0][0] - 1), points[0][1]]);

            // A translucent fill anchors the line while keeping the panel readable.
            const fill = new Cairo.LinearGradient(0, 2, 0, height - 2);
            palette.forEach((color, index) => {
                const position = 1 - index / (palette.length - 1);
                fill.addColorStopRGBA(position, ...color, 0.04 + 0.32 * (1 - position));
            });
            cr.moveTo(points[0][0], height - 1);
            for (const [x, y] of points) cr.lineTo(x, y);
            cr.lineTo(points[points.length - 1][0], height - 1);
            cr.closePath();
            cr.setSource(fill);
            cr.fill();

            const line = new Cairo.LinearGradient(0, 2, 0, height - 2);
            palette.forEach((color, index) =>
                line.addColorStopRGBA(1 - index / (palette.length - 1), ...color, 1));
            cr.setSource(line);
            cr.setLineWidth(1.5);
            cr.setLineJoin(Cairo.LineJoin.ROUND);
            cr.setLineCap(Cairo.LineCap.ROUND);
            cr.moveTo(...points[0]);
            for (const point of points.slice(1)) cr.lineTo(...point);
            cr.stroke();
        }
        cr.$dispose();
    });
    return area;
}
