// src/extension.ts

import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

// ---- HyperX HID constants (same as your bash script) ----

const HID_ID = '000003F0:00000F98'; // from HID_ID
const HID_INPUT = 'input2';         // from HID_INPUT
const HID_OFFSET = 66;              // byte offset in response

const HID_REQUEST_BYTES = Uint8Array.of(
    0x50, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00
); // 64 bytes

const UPDATE_INTERVAL_SECONDS = 30;

// ---- Helper functions to talk to hidraw in pure GJS ----

function findHyperxHidIndex(): number | null {
    try {
        const dir = Gio.File.new_for_path('/sys/class/hidraw');
        const enumerator = dir.enumerate_children(
            'standard::name',
            Gio.FileQueryInfoFlags.NONE,
            null
        );

        let info: any;
        while ((info = enumerator.next_file(null)) !== null) {
            const name = info.get_name(); // e.g. "hidraw3"
            const ueventPath = `/sys/class/hidraw/${name}/device/uevent`;
            const ueventFile = Gio.File.new_for_path(ueventPath);

            let ok: boolean, contents: any;
            try {
                [ok, contents] = ueventFile.load_contents(null);
                if (!ok)
                    continue;
            } catch {
                continue;
            }

            const text = contents.toString();

            if (text.includes(HID_ID) && text.includes(HID_INPUT)) {
                const idx = parseInt(name.replace('hidraw', ''), 10);
                if (!Number.isNaN(idx))
                    return idx;
            }
        }
    } catch (e) {
        log(`hyperx-battery: error while scanning hidraw: ${e}`);
    }

    return null;
}

function readHyperxBatteryPercent(): number | null {
    const index = findHyperxHidIndex();
    if (index === null)
        return null;

    const path = `/dev/hidraw${index}`;

    try {
        const file = Gio.File.new_for_path(path);
        const ioStream = file.open_readwrite(null);
        const inputStream = ioStream.get_input_stream();
        const outputStream = ioStream.get_output_stream();

        // Write HID request (same as bash script)
        const reqBytes = new GLib.Bytes(HID_REQUEST_BYTES);
        outputStream.write_bytes(reqBytes, null);
        outputStream.flush(null);

        // Read up to 128 bytes of response (like `head -c 128`)
        const responseBytes = inputStream.read_bytes(128, null);
        const arr = responseBytes.toArray() as number[];

        if (arr.length === 0) {
            log('hyperx-battery: empty HID response');
            return null;
        }

        // Convert to hex string like `hexdump -v -e '1/1 "%02x"'`
        const hexStr = arr
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');

        // Bash checked: if [[ "$response" != *"$HID_RESPONSE"* ]]
        if (!hexStr.includes('5102')) {
            log(`hyperx-battery: response does not contain 5102, hex=${hexStr}`);
            return null;
        }

        // Bash: value=$(echo "$response" | cut -c $(($HID_OFFSET * 2 + 1))-$(($HID_OFFSET * 2 + $HID_LENGTH)))
        const start = HID_OFFSET * 2;
        const end = start + 2; // HID_LENGTH=2 (two hex chars)
        if (end > hexStr.length) {
            log(`hyperx-battery: response too short for offset (len=${hexStr.length}, need end=${end})`);
            return null;
        }

        const valueHex = hexStr.slice(start, end);
        const raw = parseInt(valueHex, 16);

        if (!Number.isFinite(raw)) {
            log(`hyperx-battery: failed to parse hex '${valueHex}'`);
            return null;
        }

        // Original bash only checked >0, but let’s keep 0–100 as sanity range
        if (raw <= 0 || raw > 100) {
            log(`hyperx-battery: invalid battery value ${raw} from hex '${valueHex}', hexStr=${hexStr}`);
            return null;
        }

        return raw;
    } catch (e) {
        log(`hyperx-battery: error talking to ${path}: ${e}`);
        return null;
    }
}


// ---- Indicator helper ----

class HyperxBatteryIndicator {
    private _indicator: any = null;
    private _label: any = null;
    private _timeoutId: number | null = null;

    enable() {
        this._indicator = new PanelMenu.Button(0.0, 'HyperX Battery', false);
        this._label = new St.Label({
            text: 'HyperX: ?%',
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._indicator.add_child(this._label);
        Main.panel.addToStatusArea('hyperx-battery', this._indicator);

        this._updateLabel();

        this._timeoutId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            UPDATE_INTERVAL_SECONDS,
            () => {
                this._updateLabel();
                return GLib.SOURCE_CONTINUE;
            }
        );
    }

    disable() {
        if (this._timeoutId !== null) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = null;
        }

        if (this._indicator !== null) {
            this._indicator.destroy();
            this._indicator = null;
        }

        this._label = null;
    }

    private _updateLabel() {
        if (!this._label)
            return;

        const percent = readHyperxBatteryPercent();

        if (percent === null) {
            this._label.text = 'HyperX: ?%';
        } else {
            this._label.text = `HyperX: ${percent}%`;
        }
    }
}

// ---- GNOME Shell extension class (ESM style) ----

export default class HyperxBatteryExtension extends Extension {
    private _indicator: HyperxBatteryIndicator | null = null;

    enable() {
        this._indicator = new HyperxBatteryIndicator();
        this._indicator.enable();
    }

    disable() {
        if (this._indicator) {
            this._indicator.disable();
            this._indicator = null;
        }
    }
}
