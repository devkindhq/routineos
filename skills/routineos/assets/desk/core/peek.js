// core/peek.js: the peek (spec 4.5). A list opens one record in a panel at the end without leaving the list. Opening
// pushes ?peek=<key> onto the address so Back closes it; j and k move through the key list captured at open (moving
// replaces the address, it does not push); o opens the full record in place of the peek entry; closing returns
// focus to whatever had it at open. A page that hosts peeks sets ctx.peek = {open(key)} once its list is drawn and
// calls ctx.peekReady(), and the shell reopens a peek named in the address on load.
export function peekSplit_(hash) {
  var h = String(hash || "");
  var i = h.indexOf("?");
  return { path: i === -1 ? h : h.slice(0, i), pairs: i === -1 ? [] : h.slice(i + 1).split("&").filter(Boolean) };
}

export function peekIsKey_(pair) { return pair === "peek" || pair.indexOf("peek=") === 0; }

// The address without its peek key; other query keys keep their order.
export function stripPeek(hash) {
  var p = peekSplit_(hash);
  var rest = p.pairs.filter(function (x) { return !peekIsKey_(x); });
  return p.path + (rest.length ? "?" + rest.join("&") : "");
}

// The address with ?peek=<key> last.
export function peekHash(hash, key) {
  var base = stripPeek(hash);
  return base + (base.indexOf("?") === -1 ? "?" : "&") + "peek=" + encodeURIComponent(key);
}

// The peek key in an address, or null.
export function peekKey(hash) {
  var hit = peekSplit_(hash).pairs.filter(function (x) { return x.indexOf("peek=") === 0; })[0];
  if (!hit) return null;
  try { return decodeURIComponent(hit.slice(5).replace(/\+/g, " ")); } catch (e) { return null; }
}

export function peekPosition(keys, key) {
  var i = keys.indexOf(key);
  if (i === -1) return { index: null, total: keys.length, prev: null, next: null };
  return { index: i, total: keys.length, prev: i > 0 ? keys[i - 1] : null, next: i < keys.length - 1 ? keys[i + 1] : null };
}

export function setDisabled(node, off) {
  node.disabled = !!off;
  if (off) node.setAttribute("disabled", ""); else node.removeAttribute("disabled");
}
