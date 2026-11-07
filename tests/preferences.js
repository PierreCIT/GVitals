import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';

// Supply the Shell-only extension base and gettext; test the real prefs module and GTK UI.
const resourcePath = GLib.getenv('GVITALS_TEST_PREFS_RESOURCE');
if (!resourcePath) throw new Error('Run this test through tests/run-ui.sh');
Gio.resources_register(Gio.Resource.load(resourcePath));
const {Settings} = await import('../prefs.js');
Gtk.init();
Adw.init();

function assert(condition, message) {
    if (!condition) throw new Error(message);
}
function descendants(widget, type) {
    let found = widget instanceof type ? [widget] : [];
    for (let child = widget.get_first_child(); child; child = child.get_next_sibling())
        found.push(...descendants(child, type));
    return found;
}

const settings = new Gio.Settings({schema_id: 'org.gnome.shell.extensions.vitals'});
const view = new Settings({getSettings: () => settings, path: GLib.get_current_dir(), metadata: {'gettext-domain': 'vitals'}});
try {
    const fontSize = view.builder.get_object('value-font-size');
    assert(fontSize.value === 0, 'Default value font size must follow the theme');
    fontSize.value = 15;
    assert(settings.get_int('value-font-size') === 15, 'Value font size did not persist');
    settings.set_int('value-font-size', 0);
    assert(fontSize.value === 0, 'Font size did not restore theme default');
    view._add_chart_sensor('_processor_usage_', 'Usage', 'processor', true);
    view._add_chart_sensor('_storage_used_', 'Used', 'storage', true);
    view._add_chart_sensor('_system_kernel_', 'Kernel', 'system', false);
    const cpu = view._chartSensorRows['_processor_usage_'];
    const disk = view._chartSensorRows['_storage_used_'];
    const text = view._chartSensorRows['_system_kernel_'];
    assert(cpu?.paletteRow && disk?.paletteRow, 'Numeric sensors must have palette controls');
    assert(!text.chartToggle.sensitive && !text.paletteRow, 'Text sensors must not have chart controls');
    assert(cpu.row.get_ancestor(Adw.PreferencesPage) === view.builder.get_object('processor-page'), 'CPU row is on the wrong page');
    assert(disk.row.get_ancestor(Adw.PreferencesPage) === view.builder.get_object('storage-page'), 'Disk row is on the wrong page');

    const switches = descendants(cpu.row, Gtk.Switch);
    assert(switches.length === 2, 'Expected independent value and chart switches');
    switches[0].active = false;
    assert(settings.get_strv('disabled-values').includes('_processor_usage_'), 'Value switch did not persist');
    assert(!settings.get_strv('disabled-charts').includes('_processor_usage_'), 'Value switch changed chart visibility');
    switches[1].active = false;
    assert(settings.get_strv('disabled-charts').includes('_processor_usage_'), 'Chart switch did not persist');
    switches[0].active = true;
    assert(!settings.get_strv('disabled-values').includes('_processor_usage_'), 'Value switch did not restore value');

    const combo = descendants(cpu.paletteRow, Gtk.ComboBoxText)[0];
    combo.active = 4; // Jet; index 0 means inherit the global default.
    let palettes = settings.get_value('chart-palettes').deep_unpack();
    assert(JSON.parse(palettes['_processor_usage_']).mode === 3, 'Palette override was not persisted');
    assert(!palettes['_storage_used_'], 'Palette override affected another sensor');
    combo.active = 0;
    palettes = settings.get_value('chart-palettes').deep_unpack();
    assert(!palettes['_processor_usage_'], 'Default palette did not remove override');

    view._add_chart_sensor('_system_kernel_', 'Kernel', 'system', true);
    assert(text.chartToggle.sensitive && text.paletteRow, 'Newly discovered numeric sensor did not get chart controls');
} finally {
    view.destroy();
}
assert(view._sensorDiscoverySecondPassId === 0 && view._sensorDiscoveryTimeoutId === 0, 'Discovery timeouts remain after destroy');
print('Preferences integration checks passed');
