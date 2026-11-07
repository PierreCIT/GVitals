import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {Sensors} from '../sensors.js';

const settings = new Gio.Settings({schema_id: 'org.gnome.shell.extensions.vitals'});
settings.set_boolean('show-gpu', true);
const sensors = new Sensors(settings, {}, s => s);
sensors._gpu_drm_root = `${GLib.get_current_dir()}/tests/fixtures/drm`;
sensors._discoverGpuDrm();
const loop = new GLib.MainLoop(null, false);
const seen = {};
let requested = false;
let success = false;
let ticks = 0;
const pollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
    if (!requested && sensors._gpu_drm_indices?.length === 2) {
        requested = true;
        sensors._readGpuDrm((label, value, type) => {
            seen[`${type}:${label}`] = value;
            if (seen['gpu#1:Utilization'] === 0.42 && seen['gpu#1:Memory Usage'] === 0.25 &&
                seen['gpu#1:Temperature'] === 53000 && seen['gpu#2:Temperature'] === 49000) {
                success = true;
                loop.quit();
            }
        });
    }
    if (++ticks >= 100) {
        loop.quit();
        return GLib.SOURCE_REMOVE;
    }
    return GLib.SOURCE_CONTINUE;
});
loop.run();
if (success) GLib.Source.remove(pollId);
sensors.destroy();
if (!success) throw new Error(`GPU discovery and sysfs readings failed: ${JSON.stringify(seen)}`);
if ('gpu#2:Utilization' in seen || 'gpu#2:Memory Usage' in seen)
    throw new Error('Unsupported Intel readings must not be fabricated');
print('AMD and Intel DRM discovery and sensor checks passed');
