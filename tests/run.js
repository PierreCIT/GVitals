import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {chartPalette, chartRange} from '../helpers/chartSettings.js';
import {Sensors} from '../sensors.js';

function equal(actual, expected, label) {
    if (JSON.stringify(actual) !== JSON.stringify(expected))
        throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const [, metadataBytes] = GLib.file_get_contents('metadata.json');
const metadata = JSON.parse(new TextDecoder().decode(metadataBytes));
equal(metadata.uuid, 'GVitals@NoeimDev', 'Extension UUID');
equal(metadata['settings-schema'], 'org.gnome.shell.extensions.vitals', 'Compatible settings schema');

const settings = new Gio.Settings({schema_id: 'org.gnome.shell.extensions.vitals'});
const cases = [
    ['CPU percentages use the full range', '_processor_usage_', 'percent', [0.3, 0.4], {}, [0, 1]],
    ['Formatted percentages use 0–100', '_storage_used_%_', 'percentage-string', [10, 20], {}, [0, 100]],
    ['Disk free space uses total capacity', '_storage_free_', 'storage', [20, 30], {'_storage_total_': 100}, [0, 100]],
    ['GPU memory uses matching card total', '_gpu#2_memory_used_', 'memory', [30], {'_gpu#2_memory_total_': 80}, [0, 80]],
    ['Unbounded sensors use visible range', '_temperature_cpu_', 'temp', [30, 50], {}, [0, 50]],
    ['Negative readings remain visible', '_temperature_cpu_', 'temp', [-10, 20], {}, [-10, 20]],
    ['Empty histories use a valid range', '_temperature_cpu_', 'temp', [], {}, [0, 1]],
];
for (const [label, key, format, samples, totals, expected] of cases)
    equal(chartRange(key, format, samples, totals), expected, label);

settings.set_value('chart-palettes', new GLib.Variant('a{ss}', {
    '_processor_usage_': JSON.stringify({mode: 3, start: '#123456', end: '#abcdef'}),
    '_storage_used_': '{invalid',
    '_memory_usage_': JSON.stringify({mode: 20}),
}));
equal(chartPalette(settings, '_processor_usage_').mode, 3, 'Per-sensor palette');
equal(chartPalette(settings, '_storage_used_'), null, 'Malformed palette');
equal(chartPalette(settings, '_memory_usage_'), null, 'Out-of-range palette');
equal(chartPalette(settings, '_other_'), null, 'Missing palette uses default');
settings.set_strv('disabled-values', ['_processor_usage_']);
settings.set_strv('disabled-charts', ['_storage_used_']);
equal(settings.get_strv('disabled-values'), ['_processor_usage_'], 'Independent value visibility');
equal(settings.get_strv('disabled-charts'), ['_storage_used_'], 'Independent chart visibility');

const sensors = new Sensors(settings, {}, s => s);
let readings = {};
const collect = (label, value, type) => { readings[`${type}:${label}`] = value; };
sensors._parseNvidiaSmiLine(collect,
    'GPU, 50, 60, N/A, 8192, 4096, 0, 4096, 25, 10, 0, 0, 1000, 500, 500, 50, 50, 4, 16', 1, false);
equal(readings['gpu#1:Utilization'], 0.25, 'NVIDIA utilization');
equal(readings['gpu#1:Memory Usage'], 0.5, 'NVIDIA memory percentage');
equal(readings['gpu#1:Temperature'], 60000, 'NVIDIA temperature in millidegrees');
const memoryUnit = settings.get_int('memory-measurement') ? 1000 : 1024;
equal(readings['gpu#1:Memory Used'], 4096 * 1024 * 1024 / memoryUnit, 'NVIDIA memory units');
sensors._nvidia_basic_query = true;
readings = {};
sensors._parseNvidiaSmiLine(collect, 'GPU, 65, 8192, 2048, 75', 2, true);
equal(readings['gpu#2:Utilization'], 0.75, 'Basic NVIDIA utilization');
equal(readings['gpu#2:Memory Usage'], 0.25, 'Basic NVIDIA memory percentage');
equal(readings['gpu#2:Temperature'], 65000, 'Basic NVIDIA temperature');

// Exercise the real async filesystem API on / without assuming a specific disk size.
const loop = new GLib.MainLoop(null, false);
const storageReadings = {};
let storageComplete = false;
const timeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 5, () => {
    loop.quit();
    return GLib.SOURCE_REMOVE;
});
sensors._queryStorage((label, value) => {
    storageReadings[label] = value;
    if (['Total', 'Used', 'Free', 'Used %', 'Free %'].every(key => key in storageReadings)) {
        storageComplete = true;
        loop.quit();
    }
}, 5);
loop.run();
if (storageComplete) GLib.Source.remove(timeout);
sensors.destroy();
if (!storageComplete || !Number.isFinite(storageReadings.Total) || storageReadings.Total <= 0 ||
    !Number.isFinite(storageReadings.Used) || storageReadings.Used < 0 ||
    !Number.isFinite(storageReadings.Free) || storageReadings.Free < 0 ||
    !Number.isFinite(storageReadings['Used %']) || !Number.isFinite(storageReadings['Free %']))
    throw new Error('Asynchronous filesystem capacity readings unavailable');
print(`Passed ${cases.length + 17} checks (charts, preferences, NVIDIA and filesystem usage)`);
