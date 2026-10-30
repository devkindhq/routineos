"""Flag invoices a person should check before anyone pays them. Standard library only. It never pays.

Usage: python3 lib/invoice_checks.py --invoices invoices.json --vendors vendors.json --threshold 1000

invoices.json is a list of {ref, vendor_domain, number, amount, issued}; vendors.json is a list of
known vendor domains. Flags, in this order:
  duplicate       another invoice has the same vendor_domain and number, or the same
                  vendor_domain, amount and issued date
  over_threshold  amount is greater than the threshold
  new_vendor      vendor_domain is not in the known list
Domains compare case-insensitively. Prints {checked, flagged: [{ref, flags}]} in input order.
Exit 2 on malformed input; values are never echoed.
"""
import argparse
import json
import math
import sys
from collections import Counter

KEYS = ("ref", "vendor_domain", "number", "amount", "issued")


def fail(msg):
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(2)


def load(path, label):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        fail(f"cannot read {label} as JSON")


def valid_invoice(inv):
    if not isinstance(inv, dict) or any(k not in inv for k in KEYS):
        return False
    amount = inv["amount"]
    return (all(isinstance(inv[k], str) for k in ("ref", "vendor_domain", "number", "issued"))
            and isinstance(amount, (int, float)) and not isinstance(amount, bool) and math.isfinite(amount))


def check(invoices, vendors, threshold):
    known = {v.casefold() for v in vendors}
    by_number = Counter((i["vendor_domain"].casefold(), i["number"]) for i in invoices)
    by_amount = Counter((i["vendor_domain"].casefold(), i["amount"], i["issued"]) for i in invoices)
    flagged = []
    for inv in invoices:
        domain = inv["vendor_domain"].casefold()
        flags = []
        if by_number[(domain, inv["number"])] > 1 or by_amount[(domain, inv["amount"], inv["issued"])] > 1:
            flags.append("duplicate")
        if inv["amount"] > threshold:
            flags.append("over_threshold")
        if domain not in known:
            flags.append("new_vendor")
        if flags:
            flagged.append({"ref": inv["ref"], "flags": flags})
    return {"checked": len(invoices), "flagged": flagged}


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--invoices", required=True)
    ap.add_argument("--vendors", required=True)
    ap.add_argument("--threshold", required=True, help="amount above which an invoice is flagged")
    args = ap.parse_args()
    try:
        threshold = float(args.threshold)
    except ValueError:
        fail("--threshold must be a number")
    if not math.isfinite(threshold):
        fail("--threshold must be a number")
    invoices = load(args.invoices, "--invoices")
    vendors = load(args.vendors, "--vendors")
    if not isinstance(invoices, list) or not all(valid_invoice(i) for i in invoices):
        fail("--invoices must be a list of {ref, vendor_domain, number, amount, issued} with a numeric amount")
    if not isinstance(vendors, list) or not all(isinstance(v, str) for v in vendors):
        fail("--vendors must be a list of domains")
    print(json.dumps(check(invoices, vendors, threshold), indent=2))


if __name__ == "__main__":
    main()
