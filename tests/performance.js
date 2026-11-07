import Gio from 'gi://Gio';
import {Sensors} from '../sensors.js';
import {sensorCatalog} from '../helpers/catalog.js';
import {valueStyle} from '../helpers/valueStyle.js';

function assert(condition, message) { if (!condition) throw new Error(message); }
const settings = new Gio.Settings({schema_id: 'org.gnome.shell.extensions.vitals'});
settings.set_boolean('show-gpu', true);
settings.set_boolean('show-battery', true);
const sensors = new Sensors(settings, sensorCatalog, s => s);
sensors._hardware_detected = true;
const calls = [];
sensors._queryTempVoltFan = (_callback, type) => calls.push(type);
for (const name of ['Memory', 'Processor', 'System', 'Storage', 'Network', 'Battery', 'Gpu'])
    sensors['_query' + name] = () => calls.push(name.toLowerCase());
sensors._lastRead = 123;
sensors._lastWrite = 456;
sensors.query(() => {}, 5, new Set(['_memory_usage_']));
assert(calls.join(',') === 'memory,processor,network', `Unneeded groups polled: ${calls}`);
assert(sensors._lastRead === 0 && sensors._lastWrite === 0, 'Skipped storage must reset its rate baselines');
calls.length = 0;
sensors._nvidia_smi_process = {};
sensors.query(() => {}, 5, new Set(['_memory_usage_']));
assert(calls.includes('gpu'), 'Running NVIDIA streams must be drained even when GPU values are hidden');
sensors._nvidia_smi_process = null;
calls.length = 0;
sensors.query(() => {}, 5, new Set(['_processor_process_time_']));
assert(calls.includes('system') && !calls.includes('storage'), 'Process time still needs system data');
calls.length = 0;
sensors.query(() => {}, 5, null);
assert(['temperature', 'voltage', 'fan', 'memory', 'processor', 'system', 'storage', 'network', 'battery', 'gpu']
    .every(name => calls.includes(name)), `Open menu must poll every enabled group: ${calls}`);

// Test signal lifecycle without a live Shell or physical GPU.
let connects = 0, disconnects = 0;
globalThis.global = {stage: {connect: () => { connects++; return 123; }, disconnect: () => { disconnects++; }}};
sensors._reconfigureNvidiaSmiProcess = () => {};
sensors._discoverGpuDrm = () => {};
sensors._initFrameMonitor();
sensors._initFrameMonitor();
assert(connects === 1, 'Frame monitoring must connect only once');
settings.set_boolean('show-gpu', false);
assert(disconnects === 1, 'Disabling GPU must disconnect frame monitoring');
sensors._initFrameMonitor();
assert(connects === 1, 'Disabled GPU must not connect a frame callback');
settings.set_boolean('show-gpu', true);
assert(connects === 1, 'GPU toggle alone must not start frame monitoring');
sensors.setFrameMonitoring(true);
assert(connects === 2, 'A visible refresh-rate reading must start frame monitoring');
sensors.setFrameMonitoring(false);
assert(disconnects === 2, 'Hidden refresh-rate readings must stop frame monitoring');
sensors.setFrameMonitoring(true);
sensors.destroy();
assert(disconnects === 3, 'Destroy must disconnect frame monitoring');
delete globalThis.global;
assert(valueStyle('color: rgb(255, 0, 0);', 14) === 'color: rgb(255, 0, 0); font-size: 14px;', 'Size preserves color');
assert(valueStyle('color: red;', 0) === 'color: red;', 'Zero uses theme font size');
assert(valueStyle('', 12) === 'font-size: 12px;', 'Size works without threshold colors');
print('Selective polling, GPU frame lifecycle and value font styles passed');
