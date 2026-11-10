// core/lock.js: the optional PIN privacy screen (spec 5.15, 7e). When meta/lock holds a valid PBKDF2 hash and this
// tab has not passed it, the shell draws only this screen; the Desk is not rendered behind it. A pass is kept in
// memory for the page life and in sessionStorage when storage works, so a blocked storage still lets the person in
// and keeps them in across route changes. It is a privacy screen, not access control.
export var LOCK_PASS_KEY = "routineos-desk-unlocked";
export var LOCK_COPY = "Privacy screen. It hides the Desk on shared screens; it does not protect the data itself.";
export var lockPassMem_ = false;

export function validPin(pin) { return typeof pin === "string" && /^[0-9]{6}$/.test(pin); }

// The same shape desk_contract.check_lock accepts; a malformed doc never locks anyone out.
export function validLock(doc) {
  return !!doc && typeof doc === "object" && doc.algo === "PBKDF2-SHA-256"
    && typeof doc.salt === "string" && /^(?:[0-9a-f]{2}){8,64}$/.test(doc.salt)
    && typeof doc.hash === "string" && /^[0-9a-f]{64}$/.test(doc.hash)
    && typeof doc.iterations === "number" && doc.iterations % 1 === 0 && doc.iterations >= 100000 && doc.iterations <= 10000000;
}

export function hexBytes_(hex) {
  var out = new Uint8Array(hex.length / 2);
  for (var i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

// PBKDF2-SHA-256 of the PIN over the salt, 32 bytes as lowercase hex.
export function hashPin(pin, saltHex, iterations) {
  var subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (!subtle) return Promise.reject(new Error("Web Crypto is not available"));
  return subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]).then(function (key) {
    return subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: hexBytes_(saltHex), iterations: iterations }, key, 256);
  }).then(function (bits) {
    return Array.prototype.map.call(new Uint8Array(bits), function (b) { return (b < 16 ? "0" : "") + b.toString(16); }).join("");
  });
}

// A pass names the salt of the lock it opened, so a PIN set or changed since (a new salt) asks again.
export function lockPassed(salt) {
  if (typeof salt !== "string" || !salt) return false;
  if (lockPassMem_ === salt) return true;
  try { return globalThis.sessionStorage.getItem(LOCK_PASS_KEY) === salt; } catch (e) { return false; }
}

export function rememberLockPass(salt) {
  lockPassMem_ = salt;
  try { globalThis.sessionStorage.setItem(LOCK_PASS_KEY, salt); } catch (e) { /* blocked: the pass lasts this page life */ }
}

export function forgetLockPass() {
  lockPassMem_ = false;
  try { globalThis.sessionStorage.removeItem(LOCK_PASS_KEY); } catch (e) { /* blocked: nothing was stored */ }
}
