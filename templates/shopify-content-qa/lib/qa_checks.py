"""Apply the content rule pack to discovered pages. Standard library only. Read only.

Usage: python3 lib/qa_checks.py --pages pages.json --rules lib/rules.json --out issues.json
       [--thin-words 30] [--restricted restricted.json]

pages.json comes from lib/discover.py. rules.json lists {id, enabled, severity, label, params}
for the fixed rule ids below; people edit it to turn rules on or off or change a severity.
--thin-words overrides thin_description min_words. A description written mostly in a script
without spaces between words (CJK, kana, Hangul, Thai, Lao, Khmer, Myanmar, Tibetan) is measured
in characters against min_chars instead. missing_alt counts images with no alt attribute; alt=""
marks a decorative image and is not counted. --restricted is a JSON list of phrases;
a non-empty list turns restricted_wording on with those phrases.

Rules: page_error, missing_description, thin_description, missing_alt, broken_image,
broken_link, placeholder_text, missing_seo_title, missing_meta_description, duplicate_title,
zero_price, compare_at_not_above, unavailable_featured, restricted_wording.

One issue per rule and page, id <rule>--<12 hex of the page URL>, so the same problem keeps the
same id across runs. Details name counts and rule terms only, never page text. Prints a compact
summary; issues.json holds {checked, issues: [{id, rule, severity, label, url, kind, detail}]}.
Exit 2 on malformed input or an unknown rule id.
"""
import argparse
import hashlib
import json
import math
import re
import sys
import unicodedata
from collections import Counter

RULE_IDS = ("page_error", "missing_description", "thin_description", "missing_alt", "broken_image",
            "broken_link", "placeholder_text", "missing_seo_title", "missing_meta_description",
            "duplicate_title", "zero_price", "compare_at_not_above", "unavailable_featured",
            "restricted_wording")
SEVERITIES = ("high", "medium", "low")


def fail(msg):
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(2)


def load(path, label):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        fail(f"cannot read {label} as JSON")


def load_rules(raw):
    if not isinstance(raw, dict) or not isinstance(raw.get("rules"), list):
        fail("rules file must hold a rules list")
    rules = {}
    for r in raw["rules"]:
        if not isinstance(r, dict) or r.get("id") not in RULE_IDS:
            fail("rules file names an unknown rule id")
        if r.get("severity") not in SEVERITIES or not isinstance(r.get("enabled"), bool):
            fail(f"rule {r['id']}: severity must be high, medium or low and enabled true or false")
        if not isinstance(r.get("params", {}), dict):
            fail(f"rule {r['id']}: params must be an object")
        rules[r["id"]] = r
    return rules


def number(v):
    """A finite price as a float, or None. Ajax prices may be integers or numeric strings."""
    if isinstance(v, bool):
        return None
    if isinstance(v, str):
        try:
            v = float(v)
        except ValueError:
            return None
    if isinstance(v, (int, float)) and math.isfinite(v):
        return float(v)
    return None


DENSE_SCRIPTS = ("CJK", "HIRAGANA", "KATAKANA", "HANGUL", "THAI", "LAO", "KHMER", "MYANMAR", "TIBETAN")


def dense_script(text):
    """True when most letters are in scripts written without spaces between words."""
    letters = [c for c in text if c.isalpha()]
    if not letters:
        return False
    dense = sum(1 for c in letters if unicodedata.name(c, "").startswith(DENSE_SCRIPTS))
    return dense * 2 > len(letters)


def issue_id(rule, url):
    return f"{rule}--{hashlib.sha256(url.encode('utf-8')).hexdigest()[:12]}"


def phrase_hits(text, phrases):
    low = text.casefold()
    return [p for p in phrases if isinstance(p, str) and p.strip() and p.casefold() in low]


def token_hits(text, tokens):
    return [t for t in tokens if isinstance(t, str) and t and re.search(rf"(?<!\w){re.escape(t)}(?!\w)", text)]


def check(data, rules):
    pages = data.get("pages")
    if not isinstance(pages, list) or not all(isinstance(p, dict) and isinstance(p.get("url"), str) for p in pages):
        fail("pages file must hold a pages list with a url on each")
    status = data.get("link_status") or {}
    on = {rid: r for rid, r in rules.items() if r["enabled"]}
    issues = []

    def add(rid, page, detail):
        if rid in on:
            r = on[rid]
            issues.append({"id": issue_id(rid, page["url"]), "rule": rid, "severity": r["severity"],
                           "label": r.get("label", rid), "url": page["url"], "kind": page.get("kind"),
                           "detail": detail})

    titles = Counter((p.get("title") or "").casefold() for p in pages if p.get("status") == 200 and p.get("title"))
    home = next((p for p in pages if p.get("kind") == "home"), None)
    featured = set(home.get("links", [])) if home else set()
    for page in pages:
        if page.get("status") != 200:
            add("page_error", page, f"status {page.get('status')}" + (f" ({page['error']})" if page.get("error") else ""))
            continue
        text = page.get("text") or ""
        if not page.get("title"):
            add("missing_seo_title", page, "no title tag text")
        elif titles[page["title"].casefold()] > 1:
            add("duplicate_title", page, f"same title on {titles[page['title'].casefold()]} pages")
        if not page.get("meta_description"):
            add("missing_meta_description", page, "no meta description")
        images = page.get("images") or []
        no_alt = sum(1 for i in images if i.get("alt") is None)
        if no_alt:
            add("missing_alt", page, f"{no_alt} of {len(images)} images have no alt attribute")
        bad_img = sum(1 for i in images if not i.get("src")
                      or (i["src"] in status and (status[i["src"]] == 0 or status[i["src"]] >= 400)))
        if bad_img:
            add("broken_image", page, f"{bad_img} image(s) empty or not loading")
        bad_links = sum(1 for l in page.get("links") or [] if l in status and (status[l] == 0 or status[l] >= 400))
        if bad_links:
            add("broken_link", page, f"{bad_links} link(s) to this store fail")
        product = page.get("product") or {}
        body = text + " " + (product.get("description_text") or "")
        params = on.get("placeholder_text", {}).get("params", {})
        hits = phrase_hits(body, params.get("phrases", [])) + token_hits(body, params.get("tokens", []))
        if hits:
            add("placeholder_text", page, "found: " + ", ".join(hits[:5]))
        rparams = on.get("restricted_wording", {}).get("params", {})
        rhits = phrase_hits(body, rparams.get("phrases", []))
        if rhits:
            add("restricted_wording", page, "found: " + ", ".join(rhits[:5]))
        if page.get("kind") != "product":
            continue
        if product.get("status") != 200:
            add("page_error", page, f"product JSON status {product.get('status')}")
            continue
        words = product.get("description_words") or 0
        desc = product.get("description_text") or ""
        tparams = on.get("thin_description", {}).get("params", {})
        if words == 0:
            add("missing_description", page, "description is empty")
        elif dense_script(desc):
            chars, minimum = sum(1 for c in desc if not c.isspace()), tparams.get("min_chars", 60)
            if chars < minimum:
                add("thin_description", page, f"{chars} characters, under {minimum}")
        else:
            minimum = tparams.get("min_words", 30)
            if words < minimum:
                add("thin_description", page, f"{words} words, under {minimum}")
        variants = product.get("variants") or []
        zero = sum(1 for v in variants if number(v.get("price")) == 0)
        if zero:
            add("zero_price", page, f"{zero} of {len(variants)} variants at zero")
        flat = 0
        for v in variants:
            price, cap = number(v.get("price")), number(v.get("compare_at_price"))
            if price is not None and cap is not None and cap > 0 and cap <= price:
                flat += 1
        if flat:
            add("compare_at_not_above", page, f"{flat} variant(s) with compare-at not above price")
        if product.get("available") is False and page["url"] in featured:
            add("unavailable_featured", page, "sold out and linked from the home page")
    order = {s: i for i, s in enumerate(SEVERITIES)}
    issues.sort(key=lambda i: (order[i["severity"]], i["rule"], i["url"]))
    return {"checked": len(pages), "issues": issues}


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--pages", required=True)
    ap.add_argument("--rules", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--thin-words", type=int)
    ap.add_argument("--restricted")
    args = ap.parse_args()
    rules = load_rules(load(args.rules, "rules"))
    if args.thin_words is not None:
        if not 1 <= args.thin_words <= 1000:
            fail("--thin-words must be between 1 and 1000")
        if "thin_description" in rules:
            rules["thin_description"].setdefault("params", {})["min_words"] = args.thin_words
    if args.restricted:
        phrases = load(args.restricted, "restricted phrases")
        if not isinstance(phrases, list) or not all(isinstance(p, str) for p in phrases):
            fail("restricted phrases must be a JSON list of text")
        if phrases and "restricted_wording" in rules:
            rules["restricted_wording"]["enabled"] = True
            rules["restricted_wording"].setdefault("params", {})["phrases"] = phrases
    data = load(args.pages, "pages")
    if not isinstance(data, dict):
        fail("pages file must be an object")
    result = check(data, rules)
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(result, fh, indent=2)
    print(json.dumps({"checked": result["checked"], "issues": len(result["issues"]),
                      "by_severity": dict(Counter(i["severity"] for i in result["issues"])),
                      "by_rule": dict(Counter(i["rule"] for i in result["issues"]))}, indent=2))


if __name__ == "__main__":
    main()
