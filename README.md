# GVitals

GVitals is a GNOME Shell extension maintained by **NoeimDev**, based on [Vitals by Core Coding](https://github.com/corecoding/Vitals). It monitors hardware and system sensors asynchronously and displays their readings in the top bar and dropdown. The project repository is [PierreCIT/GVitals](https://github.com/PierreCIT/GVitals).

Enable panel and dropdown charts separately under Preferences → General → Appearance. Show or hide values and charts in each sensor page, and choose per-chart colors under Individual chart colors. General settings provide defaults and history length. Choose sensor colors, a fixed color, a custom gradient, or the Jet, Viridis, Plasma and Inferno palettes. Percentages use 0–100% and storage capacity charts use 0–total capacity; other charts scale to their visible history. Menu charts poll enabled sensors while the menu is closed.

The optional debug display shows GNOME Shell's resident memory, GVitals' synchronous poll dispatch time and the number of chart samples retained. Extensions run inside GNOME Shell, so the memory figure is for the whole Shell process, not GVitals alone. Dispatch time excludes asynchronous sensor I/O and is not total CPU usage.

## Installation

GVitals supports the GNOME Shell versions listed in `metadata.json`. The GNOME Extensions listing and distribution packages for Vitals are the original project; install this repository to use GVitals. You need Git, GNOME Shell, and `glib-compile-schemas` (on Ubuntu/Debian: `sudo apt install git libglib2.0-bin`). Some sensors also need `lm-sensors` or vendor-specific tools.

### Install or update from a checkout

Clone the repository once, or skip the clone if you already have a checkout. Replace `~/GVitals` with its path if needed:

```sh
git clone https://github.com/PierreCIT/GVitals.git ~/GVitals
cd ~/GVitals
mkdir -p ~/.local/share/gnome-shell/extensions/GVitals@NoeimDev
cp -a ./*.js metadata.json prefs.ui stylesheet.css helpers icons locale schemas \
  ~/.local/share/gnome-shell/extensions/GVitals@NoeimDev/
glib-compile-schemas --strict ~/.local/share/gnome-shell/extensions/GVitals@NoeimDev/schemas/
```

To update an existing install, pull your desired changes into the checkout and repeat the commands starting with `cd ~/GVitals`. GJS caches modules, so code changes need a new GNOME Shell process: on Wayland, log out and back in; on X11, restart GNOME Shell or log out. Then enable the extension in Extension Manager or run:

```sh
gnome-extensions enable GVitals@NoeimDev
```

### Migrating from Vitals or an earlier GVitals build

Disable the old UUID before enabling GVitals:

```sh
gnome-extensions disable Vitals@CoreCoding.com
```

The old files can remain installed in their original directory. The new UUID uses `GVitals@NoeimDev`, so an upstream Vitals update will not overwrite it. GVitals retains the Vitals settings schema and gettext domain, making existing preferences available. The two extensions share those settings while both are installed; run only one at a time. If the old extension is already removed, skip the disable command.

After login, configure the chart switches and global defaults under **General → Appearance**, then use each sensor page to choose which values and charts appear and to override a chart's colors. History is kept only during the current session. A hidden value or chart stays hidden in both the panel and the dropdown.

## GPU sensors

Enable **Monitor GPU** in the GPU preferences page. NVIDIA usage, temperature and memory use `nvidia-smi` with a compatible NVIDIA driver. AMD cards use the kernel's GPU load, VRAM and hwmon interfaces when exposed. For Intel and other DRM devices, GVitals reads GPU hwmon temperature and any compatible load or VRAM interfaces exposed by the driver. Intel i915/Xe generally do not expose device-wide load and memory through these sysfs files, so those readings may be unavailable; GVitals does not request elevated permissions or estimate missing values. Hybrid NVIDIA and DRM cards are discovered together.

The monitor button detects Resources and GNOME System Monitor, including supported desktop-entry installations. Set a custom monitor command in the System preferences page if you prefer another application.

## Credits
The original Vitals project was forked from [gnome-shell-extension-freon](https://github.com/UshakovVasilii/gnome-shell-extension-freon). GVitals builds on the work of the Vitals and Freon contributors.

## Icons

### Original Theme
* (voltage|fan)-symbolic.svg - inherited from Freon project.
* (system|storage)-symbolic.svg - from Pop! OS theme.
* temperature-symbolic.svg - [iconnice studio](https://www.iconfinder.com/iconnice).
* (cpu|memory)-symbolic.svg - [DinosoftLabs](https://www.iconfinder.com/dinosoftlabs).
* network\*.svg - [Yannick Lung](https://www.iconfinder.com/yanlu).
* Health icon - [Dod Cosmin](https://www.iconfinder.com/icons/458267/cross_doctor_drug_health_healthcare_hospital_icon).

### GNOME Theme
* (battery | storage)-symbolic.svg - from [Adwaita Icon Theme](https://gitlab.gnome.org/GNOME/adwaita-icon-theme).
* (memory | network* | swap | system | voltage)-symbolic.svg - from [Icon Development Kit](https://gitlab.gnome.org/Teams/Design/icon-development-kit).
* fan-symbolic.svg - inherited from [Freon](https://github.com/UshakovVasilii/gnome-shell-extension-freon) project, with mild modifications.
* (temperature | cpu)-symbolic.svg - designed by [daudix](https://github.com/daudix).

## Disclaimer
Sensor data is obtained from system interfaces including hwmon and procfs. No warranty expressed or implied.

## Testing

Run the automated checks from the repository root:

```sh
./tests/run.sh
```

The tests need `gjs` and `glib-compile-schemas`; on Ubuntu/Debian install them with `sudo apt install gjs libglib2.0-bin`. The script compiles the schemas and uses an in-memory settings backend, so it does not change saved preferences. It covers chart scales and palettes, visibility settings, value formatting, network rates, threshold colors, NVIDIA CSV parsing, AMD and Intel DRM fixtures, metadata and an asynchronous filesystem query.

GTK preferences integration tests need a display, GTK 4 and Adwaita. To run them headlessly on Ubuntu/Debian:

```sh
sudo apt install gjs libglib2.0-bin gir1.2-gtk-4.0 gir1.2-adw-1 xvfb xauth dbus-x11
dbus-run-session -- xvfb-run -a ./tests/run-ui.sh
```

To validate a release bundle, first compile translations with `msgfmt` (as in CI), then run `./tools/package.sh /tmp/gvitals.zip` and `python3 tests/check-package.py /tmp/gvitals.zip --expect-translations`. Choose a new output path if the archive already exists. GitHub Actions runs these checks, JavaScript syntax checks and translation validation on pull requests and branch pushes; the release workflow waits for them before publishing. These tests do not exercise a running GNOME Shell or real GPU drivers.

For a UI check, install the checkout and start a fresh Shell session. Enable panel and menu charts, check each sensor page's switches and palette, verify storage readings for the configured path, and test any available GPU. On Wayland with GNOME 49 or later, a separate development session can be started with `dbus-run-session -- gnome-shell --devkit --wayland` when `mutter-devkit` is installed. Earlier GNOME versions use `--nested --wayland`. The test session must have GVitals installed and enabled.

## Development Commands

| Description | Command |
| --- | --- |
| Launch preferences | `gnome-shell-extension-prefs GVitals@NoeimDev` |
| View logs | ``journalctl --since="`date '+%Y-%m-%d %H:%M'`" -f \| grep Vitals`` |
| Compile schemas | `glib-compile-schemas --strict schemas/` |
| Compile translation file | `msgfmt vitals.po -o vitals.mo` |
| Run logic and sensor tests | `./tests/run.sh` |
| Run GTK tests headlessly | `dbus-run-session -- xvfb-run -a ./tests/run-ui.sh` |
| Launch GNOME 49+ Wayland devkit | `dbus-run-session -- gnome-shell --devkit --wayland` |
| Read hot-sensors value | `dconf read /org/gnome/shell/extensions/vitals/hot-sensors` |
| Write hot-sensors value | `dconf write /org/gnome/shell/extensions/vitals/hot-sensors "['_memory_usage_', '_system_load_1m_']"`<br/>This value configures the list of sensors that show up in the panel. To specify a sensor name, click on the extension to show the drop-down menu, then take the category label and the label of the individual sensor, convert them to `snake_case`, and format them like this: `_category_sensor_`.|
