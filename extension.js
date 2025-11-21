import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

export default class HyperxBatteryIndicator extends Extension {

    constructor(metadata) {
        super(metadata);
        this._indicator = null;
        this._icon = null;
        this._label = null;
        this._timeoutId = 0;
    }

    enable() {
        const iconFile = `${this.path}/icons/mouse_icon-symbolic.svg`;
        const gicon = Gio.icon_new_for_string(iconFile);

        this._icon = new St.Icon({
            gicon,
            icon_size: 12,
            style_class: 'system-status-icon panel-icon',
   
        });

        this._label = new St.Label({
            text: '…',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'panel-label',
        });

        const box = new St.BoxLayout({ vertical: false });
        box.add_child(this._icon);
        box.add_child(this._label);

        this._indicator = new PanelMenu.Button(0.0, 'HyperXBattery', false);
        this._indicator.add_child(box);

        Main.panel.addToStatusArea('HyperXBattery', this._indicator);

        // First update
        this._updateBattery();

        // Then keep updating every 30 seconds
        this._startUpdateLoop(30);
    }

    disable() {
        this._stopUpdateLoop();

        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }

        this._icon = null;
        this._label = null;
    }

    _startUpdateLoop(intervalSeconds = 30) {
        if (this._timeoutId !== 0) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }

        this._timeoutId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            intervalSeconds,
            () => {
                if (!this._indicator) {
                    this._timeoutId = 0;
                    return GLib.SOURCE_REMOVE;
                }

                this._updateBattery();
                return GLib.SOURCE_CONTINUE;
            }
        );
    }

    _stopUpdateLoop() {
        if (this._timeoutId !== 0) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
    }

    async _getBatteryPercent(scriptPath) {
        try {
            const proc = new Gio.Subprocess({
                argv: ['/bin/bash', scriptPath],
                flags: Gio.SubprocessFlags.STDOUT_PIPE |
                       Gio.SubprocessFlags.STDERR_PIPE,
            });

            proc.init(null);

            // Wrap the callback-style API in a Promise
            const [ok, stdout, stderr] = await new Promise((resolve, reject) => {
                proc.communicate_utf8_async(null, null, (proc, res) => {
                    try {
                        const result = proc.communicate_utf8_finish(res);
                        resolve(result); // [ok, stdout, stderr]
                    } catch (e) {
                        reject(e);
                    }
                });
            });

            const out = (stdout ?? '').trim();

            if (!out) {
                if (stderr && stderr.trim())
                    log(`HyperXBattery script stderr: ${stderr.trim()}`);
                else
                    log(`HyperXBattery: script returned empty output; ok=${ok}`);
                return null;
            }

            return out;
        } catch (e) {
            logError(e, 'HyperXBattery: failed to run script');
            return null;
        }
    }

    async _updateBattery() {
        const script = `${this.path}/scripts/hyperx-haste2-battery.sh`;
        const percent = await this._getBatteryPercent(script);

        log(`HyperXBattery: ran ${script}, got: ${percent}`);

        if (!this._label)
            return;

        if (!percent) {
            this._label.set_text('ERR');
            return;
        }

        this._label.set_text(
            percent.endsWith('%') ? percent : `${percent}%`
        );
    }
}
