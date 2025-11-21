import hid

def main():
    devices = hid.enumerate()
    for d in devices:
        print(hex(d["vendor_id"]), hex(d["product_id"]), d["product_string"])

if __name__ == "__main__":
    main()
