import Gio from 'gi://Gio';
import {Values} from '../values.js';
import {sensorCatalog} from '../helpers/catalog.js';
import {getUsageColor, parseColorEntry, sanitizeAndSortColorEntries, sensorKeyFromTypeLabel} from '../helpers/colors.js';

// GNOME Shell installs this formatter before loading extension modules.
String.prototype.format = imports.format.format;
function assert(condition, message) {
    if (!condition) throw new Error(message);
}
function same(actual, expected, message) {
    assert(JSON.stringify(actual) === JSON.stringify(expected), `${message}: ${JSON.stringify(actual)}`);
}
const settings = new Gio.Settings({schema_id: 'org.gnome.shell.extensions.vitals'});
const values = new Values(settings, sensorCatalog);
const first = values.returnIfDifferent(5, 'Usage', 0.5, 'processor', 'percent', '_processor_usage_');
assert(first.some(item => item.value === '50%'), 'CPU percentage formatting');
same(values.returnIfDifferent(5, 'Usage', 0.5, 'processor', 'percent', '_processor_usage_'), [], 'Unchanged readings');
assert(values.returnIfDifferent(5, 'Usage', 0.75, 'processor', 'percent', '_processor_usage_')
    .some(item => item.value === '75%'), 'Changed CPU reading');
settings.set_boolean('use-higher-precision', true);
values.resetHistory();
assert(values.returnIfDifferent(5, 'Usage', 0.555, 'processor', 'percent', '_processor_usage_')
    .some(item => item.value === '55.5%'), 'Higher precision');

const rxKey = '_network-rx_eth0_';
values.returnIfDifferent(2, 'eth0', 1000, 'network-rx', 'storage', rxKey);
const network = values.returnIfDifferent(2, 'eth0', 3000, 'network-rx', 'storage', rxKey);
assert(network.some(item => item.key === rxKey && item.numeric === 1000), 'Network interface byte rate');
assert(network.some(item => item.key === '__network-rx_max__' && item.numeric === 1000), 'Aggregate network byte rate');
const reset = values.returnIfDifferent(2, 'eth0', 100, 'network-rx', 'storage', rxKey);
assert(reset.some(item => item.key === rxKey && item.numeric === 0), 'Network counter reset');

same(parseColorEntry('10 1 0 0 sensor:_processor_usage_'),
    {threshold: 10, red: 1, green: 0, blue: 0, sensorKey: '_processor_usage_'}, 'Color parsing');
assert(parseColorEntry('bad') === null, 'Malformed threshold');
same(sanitizeAndSortColorEntries(['20 0 1 0', 'bad', '10 1 0 0']).map(item => item.threshold), [10, 20], 'Threshold sorting');
const colors = ['0 0 0 1', '50 1 0 0', '20 0 1 0 sensor:_processor_usage_'];
assert(getUsageColor(60, colors, '_other_') === 'color: rgb(255, 0, 0);', 'Group threshold color');
assert(getUsageColor(60, colors, '_processor_usage_') === 'color: rgb(0, 255, 0);', 'Sensor threshold color');
settings.set_strv('storage-colors', ['80 1 0 0 sensor:_storage_used_%_', '20 0 1 0 sensor:_storage_free_%_']);
const used = values.returnIfDifferent(5, 'Used %', 0.85, 'storage', 'percent', '_storage_used_%_');
assert(used.some(item => item.value === '85.0%' && item.style === 'color: rgb(255, 0, 0);'), 'Storage used threshold');
const free = values.returnIfDifferent(5, 'Free %', 0.1, 'storage', 'percent', '_storage_free_%_');
assert(free.some(item => item.value === '10.0%' && item.style === ''), 'Storage free threshold below breakpoint');
const diskBytes = values.returnIfDifferent(5, 'Used', 85, 'storage', 'storage', '_storage_used_');
assert(diskBytes.every(item => item.style === ''), 'Percentage thresholds do not affect byte values');
same(sensorKeyFromTypeLabel('network-us', 'Public IP'), '_network_public_ip_', 'Geolocation key');
same(sensorKeyFromTypeLabel('gpu#2', 'Memory Usage'), '_gpu#2_memory_usage_', 'GPU key');
print('Formatting, network rates and color threshold checks passed');
