#!/usr/bin/env python3
import os
import glob
import time

HID_ID = "000003F0:00000F98"
HID_INPUT = "input2"
HID_OFFSET = 66           # bytes
HID_LENGTH = 2            # hex digits (same as bash script)
HID_RESPONSE = "5102"     # marker in hex stream

# 64-byte request, same as the bash HID_REQUEST
HID_REQUEST = bytes.fromhex(
    "50 02" + " 00" * 62
)

PIPE = "/tmp/hyperx-haste2"  # not actually used, kept for naming similarity
CACHE = os.path.expanduser("~/.cache/hyperx-haste2")


def ensure_cache():
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    if not os.path.exists(CACHE):
        with open(CACHE, "w", encoding="utf-8"):
            pass


def read_cache_or_fail():
    """Return cached value or exit with error if cache empty."""
    if not os.path.exists(CACHE) or os.path.getsize(CACHE) == 0:
        raise SystemExit(1)
    with open(CACHE, "r", encoding="utf-8") as f:
        print(f.read().strip())
    raise SystemExit(0)


def result(value_hex: str | None):
    """
    Behave like the bash 'result' function:
    - If we got a nonzero hex string, convert to int and write "NN%" to cache.
    - If no new value or zero, fall back to cache.
    """
    ensure_cache()

    if value_hex:
        try:
            value_int = int(value_hex, 16)
        except ValueError:
            value_int = 0
        if value_int > 0:
            with open(CACHE, "w", encoding="utf-8") as f:
                f.write(f"{value_int}%")

    # If cache is empty, treat as failure
    if not os.path.exists(CACHE) or os.path.getsize(CACHE) == 0:
        raise SystemExit(1)

    with open(CACHE, "r", encoding="utf-8") as f:
        print(f.read().strip())
    raise SystemExit(0)


def find_hid_index() -> int | None:
    """
    Find /dev/hidrawX index that matches HID_ID and HID_PHYS (contains HID_INPUT),
    just like the bash loop over /sys/class/hidraw.
    """
    for dev in glob.glob("/sys/class/hidraw/hidraw*"):
        uevent = os.path.join(dev, "device", "uevent")
        if not os.path.isfile(uevent):
            continue

        try:
            with open(uevent, "r", encoding="utf-8") as f:
                lines = f.read().splitlines()
        except OSError:
            continue

        id_line = next((l for l in lines if l.startswith("HID_ID=")), "")
        phys_line = next((l for l in lines if l.startswith("HID_PHYS=")), "")
        if not id_line or not phys_line:
            continue

        if HID_ID in id_line and HID_INPUT in phys_line:
            # dev looks like /sys/class/hidraw/hidraw6 → index = 6
            name = os.path.basename(dev)  # "hidraw6"
            try:
                return int(name.replace("hidraw", ""))
            except ValueError:
                continue

    return None


def read_hid_reply(hid_index: int, timeout_sec: float = 3.0, max_bytes: int = 128) -> bytes:
    """
    Send HID_REQUEST to /dev/hidrawX and read up to max_bytes bytes
    within timeout_sec. This replaces the 'timeout head | hexdump' combo.
    """
    path = f"/dev/hidraw{hid_index}"
    # open in read/write, unbuffered
    with open(path, "r+b", buffering=0) as f:
        # Send request
        f.write(HID_REQUEST)

        # Read response with simple timeout
        deadline = time.time() + timeout_sec
        chunks: list[bytes] = []
        while time.time() < deadline and sum(len(c) for c in chunks) < max_bytes:
            # Non-blocking-ish read: rely on blocking read but with timeout loop
            chunk = f.read(max_bytes - sum(len(c) for c in chunks))
            if chunk:
                chunks.append(chunk)
            else:
                time.sleep(0.01)

        return b"".join(chunks)


def main():
    hid_index = find_hid_index()
    if hid_index is None:
        # device not found → behave like result 0
        result(None)

    try:
        reply = read_hid_reply(hid_index)
    except Exception:
        result(None)

    if not reply:
        result(None)

    # Convert whole reply to lowercase hex string, like hexdump -v -e '1/1 "%02x"'
    hex_str = reply.hex()

    # Check for expected marker
    if HID_RESPONSE not in hex_str:
        result(None)

    # Extract value like bash:
    # cut -c $(($HID_OFFSET * 2 + 1))-$(($HID_OFFSET * 2 + $HID_LENGTH))
    # bash is 1-based, Python is 0-based → start = HID_OFFSET*2, length = HID_LENGTH
    start = HID_OFFSET * 2
    end = start + HID_LENGTH
    if start >= len(hex_str):
        result(None)

    value_hex = hex_str[start:end]
    if not value_hex:
        result(None)

    result(value_hex)


if __name__ == "__main__":
    main()
