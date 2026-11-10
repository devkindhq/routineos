"""Apply the rule pack to captured page text and place a box for each flag. Standard library only.

Usage: python3 lib/apply_rules.py --results results.json --rules lib/rules.json --out flags.json
       [--include-draft]

results.json comes from lib/fetch_results.py. The rule pack holds
{version, rules: [{id, enabled, status, severity, kind, label, phrases?, pattern?, disclosures?, question?}]}:
  phrases           any listed phrase found (whole words, any case)
  pattern           a regular expression found (any case), at most 200 characters
  needs_disclosure  a listed phrase found and none of `disclosures` anywhere on the page
A draft rule is hidden unless --include-draft: it is still checked and keeps its Clef row (hidden),
but never becomes a flag. One flag per rule per page, with the first match, a short context, the
number of matches and, when the match can be placed on the captured page, a box [x, y, w, h] in
fractions of the full-page screenshot: the smallest text element whose text holds the match. A match
that cannot be placed keeps its flag with no box. Only captures that loaded (ok) are checked; a failed
capture is listed with no flags.

Clef is the main verdict model. When the capture holds Clef scores (from the Worker), per rule:
  rule fired, Clef at or above flagAt      flag, origin both
  rule fired, Clef below flagAt            flag kept, origin regex, needs_review true
  rule did not fire, Clef at or above      flag, origin clef: no quote (match "page-level"), no box, count 0
  rule did not fire, Clef below            clear
When Clef was off, failed or returned nothing, the rule flags stay as they are (origin regex) and the
page's clef_card says off or error, never clear. Each page gets clef_card {state, model, flagAt,
inputTokens, outputTokens, rows: [{rule, label, score (percent), fired, hidden, outcome}], unscored?,
omitted?}, outcome agree, needs-review, clef-flag or clear; at most 20 rows, flags and needs-review first.

Writes {pages, flags, rules, rules_asked, clefFlagList, needsReviewList, summary}; prints the summary. Exit 2 on malformed input, an unknown
kind or severity, a duplicate id or a pattern that does not compile.
"""
import argparse
import hashlib
import json
import re
import sys
from collections import Counter

KINDS = ("phrases", "pattern", "needs_disclosure")
SEVERITIES = ("high", "medium", "low")
RULE_ID = re.compile(r"^[a-z][a-z0-9_]{1,40}$")
CONTEXT = 80
CARD_ROWS = 20
LIST_CAP = 50
DEFAULT_FLAG_AT = 0.7
VIEWPORT_WIDTH = 1280  # the Worker's capture viewport, in CSS px
CLEF_QUOTE = ("Clef read the whole page and judged that this rule applies. "
              "There is no single phrase to quote.")


def fail(msg):
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(2)


def load(path, label):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        fail(f"cannot read {label} as JSON")


def hash12(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:12]


def page_id(url):
    return "page--" + hash12(url)


def phrase_re(phrases):
    words = [re.escape(p.strip()) for p in phrases if p.strip()]
    return re.compile(r"(?<!\w)(?:" + "|".join(words) + r")(?!\w)", re.IGNORECASE) if words else None


def compile_rules(pack, include_draft):
    """[(rule, regex, disclosure regex or None, hidden)] for the enabled rules; hidden is a draft rule
    without --include-draft."""
    rules = pack.get("rules") if isinstance(pack, dict) else None
    if not isinstance(rules, list):
        fail("the rule pack must hold a rules list")
    seen, out = set(), []
    for r in rules:
        if not isinstance(r, dict) or not isinstance(r.get("id"), str) or not RULE_ID.match(r["id"]):
            fail("each rule needs an id of lowercase letters, digits and underscores")
        rid = r["id"]
        if rid in seen:
            fail(f"rule {rid} is listed twice")
        seen.add(rid)
        if r.get("kind") not in KINDS:
            fail(f"rule {rid}: kind must be one of {', '.join(KINDS)}")
        if r.get("severity") not in SEVERITIES:
            fail(f"rule {rid}: severity must be high, medium or low")
        if r.get("status", "confirmed") not in ("confirmed", "draft"):
            fail(f"rule {rid}: status must be confirmed or draft")
        if not isinstance(r.get("label"), str) or not r["label"].strip():
            fail(f"rule {rid}: label is required")
        for key in ("phrases", "disclosures"):
            if key in r and not (isinstance(r[key], list) and all(isinstance(p, str) for p in r[key])):
                fail(f"rule {rid}: {key} must be a list of text")
        if r["kind"] == "pattern":
            pat = r.get("pattern")
            if not isinstance(pat, str) or not pat or len(pat) > 200:
                fail(f"rule {rid}: pattern must be text of at most 200 characters")
            try:
                rx = re.compile(pat, re.IGNORECASE)
            except re.error:
                fail(f"rule {rid}: pattern does not compile")
        else:
            rx = phrase_re(r.get("phrases") or [])
            if rx is None:
                fail(f"rule {rid}: phrases must list at least one phrase")
        disc = phrase_re(r.get("disclosures") or []) if r["kind"] == "needs_disclosure" else None
        if r["kind"] == "needs_disclosure" and disc is None:
            fail(f"rule {rid}: needs_disclosure needs at least one disclosure")
        if r.get("enabled") is True:
            out.append((r, rx, disc, r.get("status", "confirmed") == "draft" and not include_draft))
    return out


def norm(text):
    return re.sub(r"\s+", " ", re.sub(r"[*_`#>\[\]\\]", " ", text)).strip().casefold()


def to_box(rect, page):
    """[x, y, w, h] in fractions of the page, clipped to it, or None when it falls outside."""
    pw, ph = page["width"], page["height"]
    if not (rect["width"] > 0 and rect["height"] > 0):
        return None
    x0, y0 = rect["left"] / pw, rect["top"] / ph
    x1, y1 = x0 + rect["width"] / pw, y0 + rect["height"] / ph
    x0, y0, x1, y1 = (min(1.0, max(0.0, v)) for v in (x0, y0, x1, y1))
    if x1 <= x0 or y1 <= y0:
        return None
    return [round(x0, 4), round(y0, 4), round(x1 - x0, 4), round(y1 - y0, 4)]


def locate(match, rects, page):
    """A box for the smallest element holding `match`, or None. Rects are CSS px at the 1280 viewport.
    A screenshot whose width is not a whole multiple of 1280 was widened by sideways overflow, so the
    rects no longer line up with it and no box is drawn; a whole multiple scales the rects to pixels."""
    if not page or not rects:
        return None
    width = page.get("width")
    if not isinstance(width, (int, float)) or width < VIEWPORT_WIDTH or width % VIEWPORT_WIDTH:
        return None
    scale = width / VIEWPORT_WIDTH
    needle = norm(match)
    if not needle:
        return None
    for r in sorted(rects, key=lambda r: r["width"] * r["height"]):
        if r["width"] * r["height"] > 0 and needle in norm(r["text"]):
            return to_box({k: r[k] * scale for k in ("left", "top", "width", "height")}, page)
    return None


def check_page(cap, compiled):
    """{rule id: flag} for every enabled rule that fires on the page, hidden rules included."""
    text = re.sub(r"\s+", " ", cap.get("text") or "")
    fired = {}
    for rule, rx, disc, _hidden in compiled:
        hits = list(rx.finditer(text))
        if not hits or (disc is not None and disc.search(text)):
            continue
        m = hits[0]
        start, end = max(0, m.start() - CONTEXT), min(len(text), m.end() + CONTEXT)
        flag = base_flag(rule, cap)
        flag.update({"match": m.group(0)[:200], "context": text[start:end].strip()[:400], "count": len(hits)})
        box = locate(m.group(0), cap.get("rects") or [], cap.get("page"))
        if box:
            flag["box"] = box
        fired[rule["id"]] = flag
    return fired


def base_flag(rule, cap):
    return {"id": f"{rule['id']}--{hash12(cap['url'])}", "rule": rule["id"], "severity": rule["severity"],
            "label": rule["label"][:200], "url": cap["url"], "page_id": page_id(cap["url"])}


def clef_scores(cap):
    """(scores, flagAt) when Clef scored the capture, else ({}, flagAt)."""
    clef = cap.get("clef") if isinstance(cap.get("clef"), dict) else None
    flag_at = clef.get("flagAt") if clef and isinstance(clef.get("flagAt"), (int, float)) else DEFAULT_FLAG_AT
    if not clef or clef.get("error") or not isinstance(clef.get("scores"), dict):
        return {}, flag_at
    return clef["scores"], flag_at


def merge(cap, fired, compiled):
    """The page's flags after the Clef verdict, hidden rules included (each marked hidden)."""
    scores, flag_at = clef_scores(cap)
    out = []
    for rule, _rx, _disc, hidden in compiled:
        rid = rule["id"]
        score = scores.get(rid)
        flag = fired.get(rid)
        if flag is not None:
            flag = dict(flag, origin="both" if score is not None and score >= flag_at else "regex",
                        clef_score=score, needs_review=score is not None and score < flag_at)
        elif score is not None and score >= flag_at:
            flag = dict(base_flag(rule, cap), match="page-level", context=CLEF_QUOTE, count=0,
                        origin="clef", clef_score=score, needs_review=False)
        else:
            continue
        out.append((flag, hidden))
    return out


def pct(score):
    return int(float(score) * 100 + 0.5)


def clef_card(cap, fired, compiled):
    """The Clef scorecard of one page; off and error are states of their own, never clear."""
    clef = cap.get("clef") if isinstance(cap.get("clef"), dict) else None
    if not clef:
        return {"state": "off", "rows": []}
    base = {"model": clef.get("model"), "flagAt": clef.get("flagAt"),
            "inputTokens": clef.get("inputTokens"), "outputTokens": clef.get("outputTokens")}
    scores, flag_at = clef_scores(cap)
    if clef.get("error") or not scores:
        return {"state": "error", "error": str(clef.get("error") or "clef returned no scores")[:300], "rows": [], **base}
    rows = []
    for rule, _rx, _disc, hidden in compiled:
        rid = rule["id"]
        if rid not in scores:
            continue
        up = scores[rid] >= flag_at
        outcome = ("agree" if up else "needs-review") if rid in fired else ("clef-flag" if up else "clear")
        rows.append({"rule": rid, "label": rule["label"][:200], "score": pct(scores[rid]), "fired": rid in fired,
                     "hidden": hidden, "outcome": outcome})
    rows.sort(key=lambda r: (r["outcome"] == "clear", -r["score"], r["rule"]))
    kept = sorted(rows[:CARD_ROWS], key=lambda r: (-r["score"], r["rule"]))
    card = {"state": "ok", **base, "rows": kept}
    unscored = sorted(set(fired) - set(scores))
    if unscored:
        card["unscored"] = unscored
    if len(rows) > CARD_ROWS:
        card["omitted"] = len(rows) - CARD_ROWS
    return card


def clef_summary(cards):
    """Counts per outcome, the score range and the tokens used, over the pages' scorecards."""
    ok = [c for c in cards if c.get("state") == "ok"]
    rows = [r for c in ok for r in c["rows"]]
    scores = [r["score"] for r in rows]

    def n(o):
        return sum(1 for r in rows if r["outcome"] == o)
    return {"pages": len(ok), "off": sum(1 for c in cards if c.get("state") == "off"),
            "errors": sum(1 for c in cards if c.get("state") == "error"),
            "agree": n("agree"), "needsReview": n("needs-review"), "clefFlag": n("clef-flag"), "clear": n("clear"),
            "minScore": min(scores) if scores else None, "maxScore": max(scores) if scores else None,
            "inputTokens": sum(c.get("inputTokens") or 0 for c in ok),
            "outputTokens": sum(c.get("outputTokens") or 0 for c in ok)}


def apply(results, compiled):
    caps = results.get("results")
    if not isinstance(caps, list):
        fail("results must hold a results list")
    pages, flags, cards, clef_flags, needs_review = [], [], [], [], []
    for cap in caps:
        if not isinstance(cap, dict) or not isinstance(cap.get("url"), str) or not isinstance(cap.get("seq"), int):
            fail("each capture needs a url and a seq")
        page = {"id": page_id(cap["url"]), "url": cap["url"], "seq": cap["seq"], "ok": cap.get("ok") is True,
                "status": cap.get("status"), "title": str(cap.get("title") or "")[:200],
                "capturedAt": str(cap.get("capturedAt") or ""), "error": str(cap.get("error") or "")[:200],
                "width": (cap.get("page") or {}).get("width"), "shot": cap.get("shot") or "",
                "hash": hash12(cap.get("text") or ""), "flag_count": 0}
        if cap.get("ok"):
            fired = check_page(cap, compiled)
            found = [f for f, hidden in merge(cap, fired, compiled) if not hidden]
            card = clef_card(cap, fired, compiled)
            cards.append(card)
            for row in card["rows"]:
                item = {"page_id": page["id"], "url": cap["url"], "rule": row["rule"], "label": row["label"],
                        "score": row["score"]}
                if row["outcome"] == "clef-flag" and not row["hidden"]:
                    clef_flags.append(item)
                elif row["outcome"] == "needs-review":
                    needs_review.append({**item, "hidden": row["hidden"]})
            flags += found
            page.update({"flag_count": len(found), "clef_card": card})
        pages.append(page)
    rules = {r["id"]: {"label": r["label"], "severity": r["severity"], "question": str(r.get("question") or "")[:500]}
             for r, _, _, hidden in compiled if not hidden}
    summary = {"pages": len(pages), "checked": sum(1 for p in pages if p["ok"]), "flags": len(flags),
               "by_rule": dict(Counter(f["rule"] for f in flags)),
               "boxed": sum(1 for f in flags if "box" in f), "rules_run": sorted(rules),
               "hidden_rules": sorted(r["id"] for r, _, _, hidden in compiled if hidden),
               "clef": clef_summary(cards), "clef_flags": len(clef_flags), "needs_review": len(needs_review)}
    return {"pages": pages, "flags": flags, "rules": rules, "rules_asked": [r["id"] for r, _, _, _ in compiled][:64],
            "clefFlagList": clef_flags[:LIST_CAP], "needsReviewList": needs_review[:LIST_CAP], "summary": summary}


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--results", required=True)
    ap.add_argument("--rules", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--include-draft", action="store_true")
    args = ap.parse_args()
    results, pack = load(args.results, "results"), load(args.rules, "rule pack")
    if not isinstance(results, dict):
        fail("results must be a JSON object")
    out = apply(results, compile_rules(pack, args.include_draft))
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=2)
    print(json.dumps(out["summary"], indent=2))


if __name__ == "__main__":
    main()
