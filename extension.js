import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St'
import Shell from 'gi://Shell';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';

import * as Sensors from './sensors.js';
import * as Chart from './chart.js';
import {chartRange} from './helpers/chartSettings.js';
import {valueStyle} from './helpers/valueStyle.js';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import * as Values from './values.js';
import * as MenuItem from './menuItem.js';
import * as SensorCatalog from './helpers/catalog.js';

let vitalsMenu;

var VitalsMenuButton = GObject.registerClass({
    GTypeName: 'VitalsMenuButton',
}, class VitalsMenuButton extends PanelMenu.Button {
    _init(extensionObject) {
        super._init(Clutter.ActorAlign.FILL);

        this._extensionObject = extensionObject;
        this._settings = extensionObject.getSettings();

        this._sensorIcons = SensorCatalog.sensorCatalog;

        // list with the prefixes for the according themes, the index of each
        // item must match the index on the combo box
        this._sensorsIconPathPrefix = ['/icons/original/', '/icons/gnome/'];

        this._sensorMenuItems = {};
        this._hotLabels = {};
        this._hotValueStyles = {};
        this._valueFontSize = this._settings.get_int('value-font-size');
        this._disabledCharts = new Set(this._settings.get_strv('disabled-charts'));
        this._hotItems = {};
        this._chartHistory = {};
        this._chartFormats = {};
        this._chartTotals = {};
        this._panelCharts = {};
        this._menuCharts = {};
        this._groups = {};
        this._widths = {};
        this._numGpus = 1;
        this._newGpuDetected = false;
        this._newGpuDetectedCount = 0;
        this._last_query = new Date().getTime();

        this._sensors = new Sensors.Sensors(this._settings, this._sensorIcons, _);
        this._values = new Values.Values(this._settings, this._sensorIcons);
        this._menuLayout = new St.BoxLayout({
            clip_to_allocation: true,
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.CENTER,
            reactive: true,
            x_expand: true,
            style_class: 'vitals-panel-menu'
        });

        this._drawMenu();
        this.add_child(this._menuLayout);
        this._refreshTimeoutId = null;

        this._connectSettingsSignals();

        this._initializeMenu();

        // start off with fresh sensors
        this._querySensors();

        // start monitoring sensors
        this._initializeTimer();
    }

    _connectSettingsSignals() {
        this._settings.connectObject(
            'changed::update-time', this._initializeTimer.bind(this),
            'changed::position-in-panel', this._positionInPanelChanged.bind(this),
            'changed::menu-centered', this._positionInPanelChanged.bind(this),
            this);

        let settings = [ 'use-higher-precision', 'alphabetize', 'hide-zeros',
                         'fixed-widths', 'hide-icons', 'unit', 'icon-style',
                         'memory-measurement', 'include-public-ip', 'network-public-ip-interval',
                         'network-public-ip-show-flag', 'network-public-ip-provider', 'network-speed-format', 'network-speed-unit', 'storage-measurement',
                         'include-static-info', 'include-processor-cores', 'include-static-gpu-info',
                         'panel-charts', 'menu-charts', 'chart-history-length' ];

        for (let setting of settings)
            this._settings.connectObject('changed::' + setting, this._redrawMenu.bind(this), this);

        this._settings.connectObject('changed::show-debug-stats', () => {
            this._debugItem.visible = this._settings.get_boolean('show-debug-stats');
            if (this._debugItem.visible && this.menu.isOpen) this._updateDebugStats(0);
        }, this);

        this._settings.connectObject('changed::storage-path', () => {
            delete this._chartTotals._storage_total_;
            for (const key of Object.keys(this._chartHistory)) {
                if (key.startsWith('_storage_')) delete this._chartHistory[key];
            }
            this._redrawMenu();
        }, this);

        this._settings.connectObject('changed::value-font-size', () => {
            this._valueFontSize = this._settings.get_int('value-font-size');
            for (const [key, label] of Object.entries(this._hotLabels)) {
                label.style = valueStyle(this._hotValueStyles[key], this._valueFontSize) || null;
                label.set_width(-1);
                this._widths[key] = 0;
            }
            for (const row of Object.values(this._sensorMenuItems)) {
                if (row instanceof MenuItem.MenuItem) row.valueFontSize = this._valueFontSize;
            }
            for (const group of Object.values(this._groups)) {
                if (group._statusLabel)
                    group._statusLabel.style = valueStyle(group._valueStyle, this._valueFontSize) || null;
            }
        }, this);

        this._settings.connectObject('changed::disabled-values', () => {
            const hidden = new Set(this._settings.get_strv('disabled-values'));
            for (const [key, label] of Object.entries(this._hotLabels))
                label.visible = !hidden.has(key);
            for (const [key, row] of Object.entries(this._sensorMenuItems)) {
                if (row instanceof MenuItem.MenuItem)
                    row.valueVisible = !hidden.has(key);
            }
        }, this);

        this._settings.connectObject('changed::disabled-charts', () => {
            this._disabledCharts = new Set(this._settings.get_strv('disabled-charts'));
            for (const key of this._disabledCharts)
                delete this._chartHistory[key];
            this._redrawMenu();
        }, this);

        for (let setting of ['chart-color-mode', 'chart-color-start', 'chart-color-end', 'chart-palettes'])
            this._settings.connectObject('changed::' + setting, () => {
                for (const chart of [...Object.values(this._panelCharts), ...Object.values(this._menuCharts)])
                    chart.refreshPalette();
            }, this);

        for (let setting of SensorCatalog.colorSettingsKeys())
            this._settings.connectObject('changed::' + setting, this._thresholdColorsChanged.bind(this), this);

        for (let sensor in this._sensorIcons)
            this._settings.connectObject('changed::show-' + sensor, this._showHideSensorsChanged.bind(this), this);
    }

    _thresholdColorsChanged() {
        this._values.resetHistory(this._numGpus);
        this._querySensors();
    }

    _initializeMenu() {
        // display sensor categories
        for (let sensor in this._sensorIcons) {
            // groups associated sensors under accordion menu
            if (sensor in this._groups) continue;

            //handle gpus separately.
            if (sensor === 'gpu') continue;

            this._initializeMenuGroup(sensor, sensor);
        }

        for (let i = 1; i <= this._numGpus; i++)
            this._initializeMenuGroup('gpu#' + i, 'gpu', (this._numGpus > 1 ? ' ' + i : ''));

        this._debugItem = new PopupMenu.PopupMenuItem('', {reactive: false});
        this._debugItem.label.clutter_text.line_wrap = true;
        this._debugItem.visible = this._settings.get_boolean('show-debug-stats');
        this.menu.addMenuItem(this._debugItem);

        // add separator
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        let item = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            style_class: 'vitals-menu-button-container'
        });

        let customButtonBox = new St.BoxLayout({
            style_class: 'vitals-button-box',
            clip_to_allocation: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            reactive: true,
            x_expand: true
        });

        // custom round refresh button
        let refreshButton = this._createRoundButton('view-refresh-symbolic', _('Refresh'));
        refreshButton.connect('clicked', (self) => {
            // soft reset: clear history without rediscovering hardware (rediscover races
            // _queryGpu when DRM indices are briefly empty and disables the group header)
            this._sensors.resetHistory(false);
            this._values.resetHistory(this._numGpus);

            // make sure timer fires at next full interval
            this._initializeTimer();

            // refresh sensors now
            this._querySensors();
        });
        customButtonBox.add_child(refreshButton);

        // custom round monitor button
        let monitorButton = this._createRoundButton('org.gnome.SystemMonitor-symbolic', _('System Monitor'));
        monitorButton.connect('clicked', (self) => {
            this.menu._getTopMenu().close();
            this._launchSystemMonitor();
        });
        customButtonBox.add_child(monitorButton);

        // custom round preferences button
        let prefsButton = this._createRoundButton('preferences-system-symbolic', _('Preferences'));
        prefsButton.connect('clicked', (self) => {
            this.menu._getTopMenu().close();
            this._extensionObject.openPreferences();
        });
        customButtonBox.add_child(prefsButton);

        // now add the buttons to the top bar
        item.actor.add_child(customButtonBox);

        // add buttons
        this.menu.addMenuItem(item);

        // query sensors on menu open
        this.menu.connectObject('open-state-changed', (menu, isMenuOpen) => {
            if (isMenuOpen) {
                for (const chart of Object.values(this._menuCharts)) chart.queue_repaint();
                // make sure timer fires at next full interval
                this._initializeTimer();

                // refresh sensors now
                this._querySensors();
            } else {
                this._sensors.setFrameMonitoring(this._settings.get_boolean('menu-charts') ||
                    !!this._hotLabels['_gpu#1_refresh_rate_']);
            }
        }, this);
    }

    _launchSystemMonitor() {
        const command = this._settings.get_string('monitor-cmd').trim();
        if (command && command !== 'gnome-system-monitor') {
            try {
                const [, argv] = GLib.shell_parse_argv(command);
                Util.spawn(argv);
            } catch (error) {
                console.error(`GVitals: invalid monitor command: ${error.message}`);
            }
            return;
        }
        // Desktop entries also work for sandboxed installations such as Flatpak.
        for (const id of ['net.nokyan.Resources.desktop', 'org.gnome.Resources.desktop',
            'org.gnome.SystemMonitor.desktop', 'gnome-system-monitor.desktop']) {
            const app = Shell.AppSystem.get_default().lookup_app(id);
            if (!app) continue;
            try {
                app.open_new_window(-1);
                return;
            } catch (error) {
                console.warn(`GVitals: could not launch ${id}: ${error.message}`);
            }
        }
        const executable = GLib.find_program_in_path('resources') || GLib.find_program_in_path('gnome-system-monitor');
        if (executable) Util.spawn([executable]);
        else console.warn('GVitals: no system monitor found; configure Monitor command in preferences');
    }

    _updateDebugStats(dispatchMs) {
        if (!this._settings.get_boolean('show-debug-stats') || !this.menu.isOpen) return;
        const samples = Object.values(this._chartHistory).reduce((sum, history) => sum + history.length, 0);
        const file = Gio.File.new_for_path('/proc/self/status');
        file.load_contents_async(null, (source, result) => {
            if (this._destroyed || !this._settings.get_boolean('show-debug-stats')) return;
            try {
                const [, contents] = source.load_contents_finish(result);
                const match = new TextDecoder().decode(contents).match(/^VmRSS:\s+(\d+)\s+kB/m);
                const memory = match ? `${(Number(match[1]) / 1024).toFixed(1)} MiB` : _('unavailable');
                this._debugItem.label.text = _('GNOME Shell memory: %s\nGVitals poll dispatch: %s ms · Chart samples: %d')
                    .format(memory, dispatchMs.toFixed(2), samples);
            } catch (error) {
                console.warn(`GVitals: cannot read Shell memory: ${error.message}`);
            }
        });
    }

    _initializeMenuGroup(groupName, optionName, menuSuffix = '', position = -1) {
        this._groups[groupName] = new PopupMenu.PopupSubMenuMenuItem(_(this._ucFirst(groupName) + menuSuffix), true);
        this._groups[groupName].icon.gicon = Gio.icon_new_for_string(this._sensorIconPath(groupName));

        // hide menu items that user has requested to not include
        if (!this._settings.get_boolean('show-' + optionName))
            this._groups[groupName].actor.hide();

        if (!this._groups[groupName]._statusLabel) {
            this._groups[groupName]._statusLabel = this._defaultLabel();
            this._groups[groupName].actor.insert_child_at_index(this._groups[groupName]._statusLabel, 4);
            this._groups[groupName]._statusLabel.text = _('No Data');
            this._groups[groupName]._statusLabel.style = valueStyle('', this._valueFontSize) || null;
        }

        if(position == -1) this.menu.addMenuItem(this._groups[groupName]);
        else this.menu.addMenuItem(this._groups[groupName], position);
    }

    _createRoundButton(iconName) {
        let button = new St.Button({
            style_class: 'button vitals-button-action'
        });

        button.child = new St.Icon({
            icon_name: iconName
        });

        return button;
    }

    _removeMissingHotSensors(hotSensors) {
        for (let i = hotSensors.length - 1; i >= 0; i--) {
            let sensor = hotSensors[i];

            // make sure default icon (if any) stays visible
            if (sensor == '_default_icon_') continue;

            // removes sensors that are no longer available
            if (!this._sensorMenuItems[sensor]) {
                hotSensors.splice(i, 1);
                this._removeHotItem(sensor);
            }
        }

        return hotSensors;
    }

    _saveHotSensors(hotSensors) {
        // removes any sensors that may not currently be available
        hotSensors = this._removeMissingHotSensors(hotSensors);

        this._settings.set_strv('hot-sensors', hotSensors.filter(
            function(item, pos) {
                return hotSensors.indexOf(item) == pos;
            }
        ));
    }

    _initializeTimer() {
        this._destroyTimer();

        // used to query sensors and update display
        let update_time = this._settings.get_int('update-time');
        this._refreshTimeoutId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            update_time,
            (self) => {
                // always query sensors (for panel display when hot)
                this._querySensors();
                return GLib.SOURCE_CONTINUE;
            }
        );
    }

    _createHotItem(key, value, gicon, style) {
        let item = new St.BoxLayout({
            style_class: 'vitals-panel-item',
        });
        this._hotItems[key] = item;
        this._menuLayout.add_child(item);

        if (!this._settings.get_boolean('hide-icons') || key == '_default_icon_') {
            let icon = this._defaultIcon(key);
            if (gicon) icon.gicon = gicon;
            item.add_child(icon);
        }

        // don't add a label when no sensors are in the panel
        if (key == '_default_icon_') return;

        let label = new St.Label({
            style_class: 'vitals-panel-label',
            text: (value)?value:'\u2026', // ...
            style: valueStyle(style, this._valueFontSize) || null,
            y_expand: true,
            y_align: Clutter.ActorAlign.CENTER
        });
        // attempt to prevent ellipsizes
        label.get_clutter_text().ellipsize = 0;
        // keep track of label for removal later
        this._hotLabels[key] = label;
        this._hotValueStyles[key] = style || '';
        // prevent "called on the widget"  "which is not in the stage" errors by adding before width below
        item.add_child(label);
        label.visible = !this._settings.get_strv('disabled-values').includes(key);

        // support for fixed widths #55, save label (text) width
        this._widths[key] = label.get_clutter_text().width;
        if (this._settings.get_boolean('panel-charts') && this._chartEnabled(key) && this._chartHistory[key]) {
            this._panelCharts[key] = this._makeChart(key, true);
            item.add_child(this._panelCharts[key]);
        }
    }

    _showHideSensorsChanged(self, sensor) {
        const sensorName = sensor.substr(5);
        if(sensorName === 'gpu') {
            for(let i = 1; i <= this._numGpus; i++)
                this._groups[sensorName + '#' + i].visible = this._settings.get_boolean(sensor);
        } else
            this._groups[sensorName].visible = this._settings.get_boolean(sensor);

        // prefs may have removed this group's sensors from hot-sensors; rebuild panel/menu
        this._redrawMenu();
    }

    _positionInPanelChanged() {
        this.container.get_parent().remove_child(this.container);
        let position = this._positionInPanel();

        // allows easily addressable boxes
        let boxes = {
            left: Main.panel._leftBox,
            center: Main.panel._centerBox,
            right: Main.panel._rightBox
        };

        // update position when changed from preferences
        boxes[position[0]].insert_child_at_index(this.container, position[1]);
    }

    _removeHotItems(){
        for (let key in this._hotItems) {
            this._removeHotItem(key);
        }
    }

    _removeHotItem(key) {
        if (key in this._hotItems) {
            delete this._panelCharts[key];
            delete this._hotLabels[key];
            delete this._hotValueStyles[key];
            delete this._widths[key];
            this._hotItems[key].destroy();
            delete this._hotItems[key];
        }
    }

    _redrawHotSensors() {
        this._removeHotItems();
        this._drawMenu();
        this._values.resetHistory(this._numGpus);
        this._querySensors();
    }

    _redrawMenu() {
        for (let key in this._sensorMenuItems) {
            if (key.includes('-group')) continue;
            let item = this._sensorMenuItems[key];
            delete this._sensorMenuItems[key];
            delete this._menuCharts[key];
            item.destroy();
        }

        // group headers persist across row rebuilds; refresh pack (original vs gnome)
        for (let groupName in this._groups)
            this._groups[groupName].icon.gicon = Gio.icon_new_for_string(this._sensorIconPath(groupName));

        this._sensors.resetHistory(false);
        this._redrawHotSensors();
    }

    _drawMenu() {
        // grab list of selected menubar icons
        let hotSensors = this._settings.get_strv('hot-sensors');
        for (let key of Object.values(hotSensors)) {
            // fixes issue #225 which started when _max_ was moved to the end
            if (key == '__max_network-download__') key = '__network-rx_max__';
            if (key == '__max_network-upload__') key = '__network-tx_max__';

            // reuse dropdown value/icon/style so pin doesn't flash "…" or uncolored text
            let menuItem = this._sensorMenuItems[key];
            this._createHotItem(key, menuItem?.value, menuItem?.gicon, menuItem?.valueStyle);
        }
    }

    _destroyTimer() {
        if (this._refreshTimeoutId != null) {
            GLib.Source.remove(this._refreshTimeoutId);
            this._refreshTimeoutId = null;
        }
    }

    _makeChart(key, panel) {
        return Chart.createChart(this._chartHistory[key], () => this._settings.get_int('chart-history-length'),
            this._settings, key, values => chartRange(key, this._chartFormats[key], values, this._chartTotals), panel);
    }

    _chartEnabled(key) {
        return !this._disabledCharts.has(key);
    }

    _recordChart(key, value, format = null) {
        if (!this._chartEnabled(key)) return;
        let number = typeof value === 'number' ? value :
            (typeof value === 'string' && /^-?\d+(?:\.\d+)?%$/.test(value) ? parseFloat(value) : NaN);
        if (!Number.isFinite(number)) return;
        if (format) this._chartFormats[key] = format === 'string' && typeof value === 'string' && value.endsWith('%')
            ? 'percentage-string' : format;
        const samples = this._chartHistory[key] ??= [];
        samples.push(number);
        const length = this._settings.get_int('chart-history-length');
        if (samples.length > length) samples.splice(0, samples.length - length);
        if (this._settings.get_boolean('panel-charts') && this._hotItems[key] && !this._panelCharts[key]) {
            this._panelCharts[key] = this._makeChart(key, true);
            this._hotItems[key].add_child(this._panelCharts[key]);
        }
        const row = this._sensorMenuItems[key];
        if (this._settings.get_boolean('menu-charts') && row && !this._menuCharts[key]) {
            this._menuCharts[key] = this._makeChart(key, false);
            row.add_child(this._menuCharts[key]);
        }
        this._panelCharts[key]?.queue_repaint();
        if (this.menu.isOpen) this._menuCharts[key]?.queue_repaint();
    }

    _updateDisplay(label, value, type, key, style) {
        // update sensor value in menubar
        let hotLabel = this._hotLabels[key];
        if (hotLabel) {
            hotLabel.set_text(value);
            this._hotValueStyles[key] = style || '';
            hotLabel.style = valueStyle(style, this._valueFontSize) || null;

            // support for fixed widths #55
            if (this._settings.get_boolean('fixed-widths')) {
                // grab text box width and see if new text is wider than old text
                let width2 = hotLabel.get_clutter_text().width;
                if (width2 > this._widths[key]) {
                    hotLabel.set_width(width2);
                    this._widths[key] = width2;
                }
            }
        }

        // have we added this sensor before?
        let item = this._sensorMenuItems[key];
        if (item) {
            // update sensor value in the group
            item.value = value;
            item.valueStyle = style;
        } else if (type.includes('-group')) {
            // update text next to group header
            let group = type.split('-')[0];
            let statusLabel = this._groups[group]?._statusLabel;
            if (statusLabel) {
                statusLabel.text = value;
                this._groups[group]._valueStyle = style || '';
                statusLabel.style = valueStyle(style, this._valueFontSize) || null;
                this._sensorMenuItems[type] = this._groups[group];
            }
        } else {
            // add item to group for the first time
            let sensor = { 'label': label, 'value': value, 'type': type }
            this._appendMenuItem(sensor, key);
            this._sensorMenuItems[key].valueStyle = style;
        }
    }

    _appendMenuItem(sensor, key) {
        let split = sensor.type.split('-');
        let type = split[0];
        let icon = (split.length == 2)?'icon-' + split[1]:'icon';
        let gicon = Gio.icon_new_for_string(this._sensorIconPath(type, icon, key));

        let item = new MenuItem.MenuItem(gicon, key, sensor.label, sensor.value, this._hotLabels[key]);
        item.valueVisible = !this._settings.get_strv('disabled-values').includes(key);
        item.valueFontSize = this._valueFontSize;
        item.connect('toggle', (self) => {
            let hotSensors = this._settings.get_strv('hot-sensors');

            if (self.checked) {
                // add selected sensor to panel
                hotSensors.push(self.key);
            } else {
                // remove selected sensor from panel
                hotSensors.splice(hotSensors.indexOf(self.key), 1);
            }

            if (hotSensors.length <= 0) {
                // add generic icon to panel when no sensors are selected
                hotSensors.push('_default_icon_');
            } else {
                let defIconPos = hotSensors.indexOf('_default_icon_');
                if (defIconPos >= 0)
                    hotSensors.splice(defIconPos, 1);
            }

            // this code is called asynchronously - make sure to save it for next round
            this._saveHotSensors(hotSensors);
            this._redrawHotSensors();
        });

        this._sensorMenuItems[key] = item;
        let i = Object.keys(this._sensorMenuItems[key]).length;

        // alphabetize the sensors for these categories
        if (this._settings.get_boolean('alphabetize')) {
            let menuItems = this._groups[type].menu._getMenuItems();
            for (i = 0; i < menuItems.length; i++)
                // use natural sort order for system load, etc
                if (menuItems[i].label.localeCompare(item.label, undefined, { numeric: true, sensitivity: 'base' }) > 0)
                    break;
        }

        this._groups[type].menu.addMenuItem(item, i);
    }

    _defaultLabel() {
        return new St.Label({
               y_expand: true,
                y_align: Clutter.ActorAlign.CENTER
        });
    }

    _defaultIcon(key) {
        let split = key.replaceAll('_', ' ').trim().split(' ')[0].split('-');
        let type = split[0];
        let panelType = type.startsWith('gpu') ? 'gpu' : type;
        if (type === 'network' && (split[1] === 'rx' || split[1] === 'tx'))
            panelType += '-' + split[1];
        let iconStyle = this._settings.get_int('icon-style') === 1 ? 'gnome' : 'original';

        let icon = new St.Icon({
          style_class: `system-status-icon vitals-panel-icon vitals-panel-icon-${panelType} vitals-panel-icon-${iconStyle}`,
            reactive: true
        });

        // second condition prevents crash due to issue #225, which started when _max_ was moved to the end
        // don't use the default system icon if the type is a gpu; use the universal gpu icon instead
        if (type == 'default' || (!(type in this._sensorIcons) && !type.startsWith('gpu'))) {
            icon.gicon = Gio.icon_new_for_string(this._sensorIconPath('system'));
        } else { // support for hide icons #80
            let iconObj = (split.length == 2)?'icon-' + split[1]:'icon';
            icon.gicon = Gio.icon_new_for_string(this._sensorIconPath(type, iconObj, key));
        }

        return icon;
    }

    _sensorIconPath(sensor, icon = 'icon', key = '') {
        let sensorKey = sensor;

        // If the sensor is a numbered gpu, use the gpu icon. Otherwise use whatever icon associated with the sensor name.
        if (sensor.startsWith('gpu')) sensorKey = 'gpu';

        // allows country flags to show
        const icons = this._sensorIcons[sensorKey];
        if (sensorKey === 'network' && icon.startsWith('icon-') && !(icons && icons[icon])) {
            let cc = icon.slice('icon-'.length);
            if (/^[a-z]{2}$/.test(cc))
                return this._extensionObject.path + '/icons/flags/1x1/' + cc + '.svg';
        }

        const iconPathPrefixIndex = this._settings.get_int('icon-style');
        if (sensorKey === 'memory' && iconPathPrefixIndex === 1 && key.startsWith('_memory_swap_'))
            icon = 'icon-swap';
        return this._extensionObject.path + this._sensorsIconPathPrefix[iconPathPrefixIndex] + icons[icon];
    }

    _ucFirst(string) {
        if(string.startsWith('gpu')) return 'Graphics';
        return string.charAt(0).toUpperCase() + string.slice(1);
    }

    _positionInPanel() {
        let alignment = '';
        let gravity = 0;
        let arrow_pos = 0;

        switch (this._settings.get_int('position-in-panel')) {
            case 0: // left
                alignment = 'left';
                gravity = -1;
                arrow_pos = 1;
                break;
            case 1: // center
                alignment = 'center';
                gravity = -1;
                arrow_pos = 0.5;
                break;
            case 2: // right
                alignment = 'right';
                gravity = 0;
                arrow_pos = 0;
                break;
            case 3: // far left
                alignment = 'left';
                gravity = 0;
                arrow_pos = 1;
                break;
            case 4: // far right
                alignment = 'right';
                gravity = -1;
                arrow_pos = 0;
                break;
        }

        let centered = this._settings.get_boolean('menu-centered')
        if (centered) arrow_pos = 0.5;

        // set arrow position when initializing and moving vitals
        this.menu._arrowAlignment = arrow_pos;

        return [alignment, gravity];
    }

    _querySensors() {
        const dispatchStart = GLib.get_monotonic_time();
        // figure out last run time
        let now = new Date().getTime();
        let dwell = (now - this._last_query) / 1000;
        this._last_query = now;

        // panel labels only when closed — `_default_icon_` is in _hotItems, not _hotLabels
        // empty set still queries so dwell-based sensors keep warm baselines
        let wantedKeys = this.menu.isOpen || this._settings.get_boolean('menu-charts') ? null : new Set(Object.keys(this._hotLabels));

        this._sensors.query((label, value, type, format) => {
            // async reads can resolve after disable(); the panel widgets are gone by then
            if (this._destroyed) return;

            let typeKey = type.replace('-group', '');
            if (/^network-(?!rx$|tx$)/.test(typeKey)) typeKey = 'network';
            let key = '_' + typeKey + '_' + label.replaceAll(' ', '_').toLowerCase() + '_';

            // issue #557 - interface is gone, drop it rather than show its last reading
            if (value == 'destroy') {
                this._values.removeNetworkSensor(key, label, type.replace('network-', ''));
                if (key in this._sensorMenuItems) {
                    this._sensorMenuItems[key].destroy();
                    delete this._sensorMenuItems[key];
                }
                this._removeHotItem(key);
                delete this._menuCharts[key];
                delete this._chartHistory[key];

                // an empty panel box leaves no way to open the menu
                if (Object.keys(this._hotItems).length == 0)
                    this._createHotItem('_default_icon_');
                return;
            }

            // if a sensor is disabled, gray it out
            if (key in this._sensorMenuItems) {
                this._sensorMenuItems[key].setSensitive((value!='disabled'));

                // don't continue below, last known value is shown
                if (value == 'disabled') return;
            } else if (value == 'disabled' && type.includes('-group')) {
                // group headers are not menu rows; formatting 'disabled' yields NaN
                return;
            }

            // add/initialize any gpu groups that we haven't added yet
            if (typeKey.startsWith('gpu') && typeKey !== 'gpu#1') {
                const split = typeKey.split('#');
                if(split.length == 2 && this._numGpus < parseInt(split[1])) {
                    this._numGpus = parseInt(split[1]);
                    this._newGpuDetectedCount = 0;
                    this._newGpuDetected = false;
                    // change label for gpu 1 from "Graphics" to "Graphics 1" since we have multiple gpus now
                    this._groups['gpu#1'].label.text = this._ucFirst('gpu#1') + ' 1';
                    for(let i = 2; i <= this._numGpus; i++)
                        if(!('gpu#' + i in this._groups))
                            this._initializeMenuGroup('gpu#' + i, 'gpu', ' ' + i, Object.keys(this._groups).length);
                }
            }

            if (key === '_storage_total_' || /^_gpu#\d+_memory_total_$/.test(key))
                this._chartTotals[key] = Number(value);
            if (!type.includes('-group') && type !== 'network-rx' && type !== 'network-tx' &&
                (this._settings.get_boolean('menu-charts') || this._settings.get_boolean('panel-charts') && this._hotItems[key]))
                this._recordChart(key, format !== 'string' && typeof value === 'string' ? Number(value) : value, format);
            let items = this._values.returnIfDifferent(dwell, label, value, type, format, key);
            for (let item of items) {
                if (item.type.startsWith('network-') && item.type.length == 10 && item.type != 'network-rx' && item.type != 'network-tx') {
                    // Geo / flags: stable key (no country in key); type stays network-<cc> for icon-us etc.
                    const stem = item.type.slice('network-'.length);
                    let flagGIcon = Gio.icon_new_for_string(this._sensorIconPath('network', 'icon-' + stem));
                    if (this._hotItems[item.key] && !this._settings.get_boolean('hide-icons')) {
                        // change icon in menu bar
                        let icon = this._hotItems[item.key].get_first_child();
                        if (icon instanceof St.Icon)
                        icon.gicon = flagGIcon;
                    }
                    // change icon in dropdown
                    let menuRow = this._sensorMenuItems[item.key];
                    if (menuRow) menuRow.gicon = flagGIcon;
                }

                this._updateDisplay(_(item.label), item.value, item.type, item.key, item.style);
                if (item.numeric !== undefined && (this._settings.get_boolean('menu-charts') ||
                    this._settings.get_boolean('panel-charts') && this._hotItems[item.key]))
                    this._recordChart(item.key, item.numeric);
                else if (this._chartHistory[item.key] && this._chartEnabled(item.key) && this._settings.get_boolean('menu-charts') && !this._menuCharts[item.key]) {
                    const row = this._sensorMenuItems[item.key];
                    if (row && !item.type.includes('-group')) {
                        this._menuCharts[item.key] = this._makeChart(item.key, false);
                        row.add_child(this._menuCharts[item.key]);
                    }
                }
            }
        }, dwell, wantedKeys);

        this._updateDebugStats((GLib.get_monotonic_time() - dispatchStart) / 1000);

        //if a new gpu has been detected during the last query, then increment the amount of times we've detected a new gpu
        if(this._newGpuDetected) this._newGpuDetectedCount++;
        else this._newGpuDetectedCount = 0;
        this._newGpuDetected = false;
    }

    destroy() {
        this._destroyed = true;
        this._destroyTimer();
        this._sensors.destroy();

        this._settings.disconnectObject(this);
        this.menu.disconnectObject(this);

        this._hotLabels = {};
        this._hotItems = {};
        this._sensorMenuItems = {};

        super.destroy();
    }
});

export default class VitalsExtension extends Extension {
    enable() {
        vitalsMenu = new VitalsMenuButton(this);
        let position = vitalsMenu._positionInPanel();
        Main.panel.addToStatusArea('vitalsMenu', vitalsMenu, position[1], position[0]);
    }

    disable() {
        vitalsMenu.destroy();
        vitalsMenu = null;
    }
}
