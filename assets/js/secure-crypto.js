// Secure documents (vemianpm.com/secure-upload and Michael's /secure-inbox): the encryption, with the browser's
// WebCrypto. Also loaded by the Node tools (source/docs/make-office-key.mjs, form-backend/test/secure-docs.test.mjs).
//
// How one submission is locked, on the applicant's device, before anything is sent:
// - A random AES-256-GCM key K for this submission. Each file is cut into 2 MB pieces and every piece is encrypted
//   with K (its own random 96-bit IV, and "f<file>.c<piece>" as additional data, so pieces can't be swapped or
//   reordered). File names, types and the applicant's message go in an encrypted manifest, which also says how many
//   pieces each file has, so a missing piece can't go unnoticed.
// - K is then locked twice: with the applicant's key (24 random characters = 120 bits, made here and shown to them
//   at the end; HKDF-SHA-256 turns it into an AES-GCM key) and with Vemian's office public key (RSA-OAEP-3072,
//   SHA-256). The office private key stays locked with Michael's passphrase (PBKDF2-SHA-256, 600,000 rounds).
// - The forms script stores only these locked copies and the scrambled pieces, plus SHA-256 of an access code that
//   also comes from the applicant's key, so it can hand the pieces back to the applicant without being able to read
//   them. Michael's pages prove themselves with a token that is locked inside the office key.
(function (root) {
  'use strict';
  const WC = root.crypto || globalThis.crypto;
  const subtle = WC.subtle;
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const PIECE = 2 * 1024 * 1024;   // the forms script expects pieces of at most this size (SecureDocs.gs DOCS.piece)
  const OVERHEAD = 28;             // a 12-byte IV in front and a 16-byte tag at the end of every encrypted piece
  const ROUNDS = 600000;           // PBKDF2 rounds for Michael's passphrase
  const ALPHA = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';   // Crockford's base 32: no I, L, O or U

  const rand = (n) => WC.getRandomValues(new Uint8Array(n));
  const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  function b64(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let s = '';
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function unb64(s) {
    const bin = atob(String(s || ''));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  async function sha256(bytes) { return new Uint8Array(await subtle.digest('SHA-256', bytes)); }

  // ---------- base 32, for the applicant's key and the reference ----------
  function toBase32(bytes) {
    let bits = 0, val = 0, out = '';
    for (const b of bytes) {
      val = (val << 8) | b;
      bits += 8;
      while (bits >= 5) { bits -= 5; out += ALPHA[(val >> bits) & 31]; }
      val &= (1 << bits) - 1;
    }
    if (bits) out += ALPHA[(val << (5 - bits)) & 31];
    return out;
  }
  function fromBase32(str) {
    let bits = 0, val = 0;
    const out = [];
    for (const ch of str) {
      const v = ALPHA.indexOf(ch);
      if (v < 0) return null;
      val = (val << 5) | v;
      bits += 5;
      if (bits >= 8) { bits -= 8; out.push((val >> bits) & 255); }
      val &= (1 << bits) - 1;
    }
    return new Uint8Array(out);
  }
  // What people type: any case, spaces or dashes, O for 0 and I or L for 1.
  const tidy = (s) => String(s || '').toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');

  // The applicant's key: 24 characters in groups of 4, like 7Q2M-XW3P-D5R9-TKH6-C8JN-4FAB.
  const formatKey = (bytes) => toBase32(bytes).match(/.{4}/g).join('-');
  function readKey(text) {
    const s = tidy(text);
    if (s.length !== 24) return null;
    const b = fromBase32(s);
    return b && b.length === 15 ? b : null;
  }
  // A reference like VPM-8F4K92 (made by the forms script). Accepts it typed without the dash or the VPM.
  function readRef(text) {
    let s = tidy(text);
    if (s.length === 9 && s.startsWith('VPM')) s = s.slice(3);
    return /^[0-9A-HJKMNP-TV-Z]{6}$/.test(s) ? `VPM-${s}` : '';
  }

  // ---------- AES-GCM with the IV in front ----------
  async function seal(key, data, ad) {
    const iv = rand(12);
    const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(ad) }, key, data));
    const out = new Uint8Array(12 + ct.length);
    out.set(iv);
    out.set(ct, 12);
    return out;
  }
  async function unseal(key, data, ad) {
    return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: data.subarray(0, 12), additionalData: enc.encode(ad) }, key, data.subarray(12)));
  }
  const aesKey = (raw, uses) => subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, uses);

  // The applicant's key -> a key that locks K, and an access code for the forms script (two halves of one HKDF).
  async function fromApplicantKey(keyBytes) {
    const ikm = await subtle.importKey('raw', keyBytes, 'HKDF', false, ['deriveBits']);
    const bits = new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: enc.encode('Vemian secure documents v1') }, ikm, 512));
    return { kek: await aesKey(bits.slice(0, 32), ['encrypt', 'decrypt']), access: bits.slice(32) };
  }

  // ---------- the applicant's side ----------
  // files: [{ name, type, label, bytes: Uint8Array }]; office: from officePublic(). Returns the key to show them,
  // the header for the forms script, and the encrypted pieces in upload order.
  async function lockSubmission({ files, message, office, onProgress }) {
    const raw = rand(32);
    const K = await aesKey(raw, ['encrypt', 'decrypt']);
    const keyBytes = rand(15);
    const { kek, access } = await fromApplicantKey(keyBytes);
    const total = files.reduce((s, f) => s + f.bytes.length, 0) || 1;
    const pieces = [];
    const parts = [];
    const list = [];
    let done = 0;
    for (let f = 0; f < files.length; f++) {
      const b = files[f].bytes;
      const count = Math.max(1, Math.ceil(b.length / PIECE));
      list.push({ name: String(files[f].name || 'file'), type: String(files[f].type || 'application/octet-stream'), label: String(files[f].label || ''), size: b.length, pieces: count });
      for (let c = 0; c < count; c++) {
        const slice = b.subarray(c * PIECE, Math.min(b.length, (c + 1) * PIECE));
        const data = await seal(K, slice, `f${f}.c${c}`);
        pieces.push(data);
        parts.push({ f, c, n: data.length });
        done += slice.length;
        if (onProgress) onProgress(done / total);
      }
    }
    const manifest = await seal(K, enc.encode(JSON.stringify({ v: 1, files: list, message: String(message || '') })), 'manifest');
    const wrapA = await seal(kek, raw, 'key');
    const wrapO = new Uint8Array(await subtle.encrypt({ name: 'RSA-OAEP' }, office.key, raw));
    raw.fill(0);
    return {
      key: formatKey(keyBytes),
      header: { v: 1, kid: office.kid, wrapA: b64(wrapA), wrapO: b64(wrapO), manifest: b64(manifest), parts, check: hex(await sha256(access)) },
      pieces,
    };
  }
  // What the forms script needs to hand the pieces back: the access code (base64), or null if the key is mistyped.
  async function accessCode(keyText) {
    const kb = readKey(keyText);
    return kb ? b64((await fromApplicantKey(kb)).access) : null;
  }
  async function keyFromApplicant(header, keyText) {
    const kb = readKey(keyText);
    if (!kb) throw new Error('That key isn’t complete.');
    const { kek } = await fromApplicantKey(kb);
    return aesKey(await unseal(kek, unb64(header.wrapA), 'key'), ['decrypt']);
  }

  // ---------- Vemian's side ----------
  async function makeOfficeKey(passphrase) {
    const pair = await subtle.generateKey({ name: 'RSA-OAEP', modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['encrypt', 'decrypt']);
    const spki = new Uint8Array(await subtle.exportKey('spki', pair.publicKey));
    const pkcs8 = new Uint8Array(await subtle.exportKey('pkcs8', pair.privateKey));
    const token = rand(32);
    const salt = rand(16);
    const lockKey = await passKey(passphrase, salt, ROUNDS);
    const locked = await seal(lockKey, enc.encode(JSON.stringify({ pkcs8: b64(pkcs8), token: b64(token) })), 'office');
    pkcs8.fill(0);
    return {
      v: 1,
      kid: hex(await sha256(spki)).slice(0, 12),
      created: new Date().toISOString(),
      publicKey: b64(spki),
      adminHash: hex(await sha256(token)),
      locked: { salt: b64(salt), rounds: ROUNDS, data: b64(locked) },
    };
  }
  async function passKey(passphrase, salt, rounds) {
    const base = await subtle.importKey('raw', enc.encode(String(passphrase).normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
    return subtle.deriveKey({ name: 'PBKDF2', salt, iterations: rounds, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  // office: { kid, publicKey } as published on /secure-upload
  async function officePublic(office) {
    return { kid: office.kid, key: await subtle.importKey('spki', unb64(office.publicKey), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']) };
  }
  // office: { kid, locked } as published on /secure-inbox. Returns null for a wrong passphrase.
  async function unlockOffice(office, passphrase) {
    const k = await passKey(passphrase, unb64(office.locked.salt), office.locked.rounds);
    let inner;
    try { inner = JSON.parse(dec.decode(await unseal(k, unb64(office.locked.data), 'office'))); } catch { return null; }
    const privateKey = await subtle.importKey('pkcs8', unb64(inner.pkcs8), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt']);
    return { kid: office.kid, privateKey, token: inner.token };
  }
  // The same office key locked with a new passphrase (same private key and token). Null if oldPass is wrong.
  async function relockOffice(office, oldPass, newPass) {
    const k = await passKey(oldPass, unb64(office.locked.salt), office.locked.rounds);
    let inner;
    try { inner = await unseal(k, unb64(office.locked.data), 'office'); } catch { return null; }
    const salt = rand(16);
    const data = await seal(await passKey(newPass, salt, ROUNDS), inner, 'office');
    inner.fill(0);
    return { ...office, locked: { salt: b64(salt), rounds: ROUNDS, data: b64(data) } };
  }
  async function keyFromOffice(header, privateKey) {
    return aesKey(new Uint8Array(await subtle.decrypt({ name: 'RSA-OAEP' }, privateKey, unb64(header.wrapO))), ['decrypt']);
  }

  // ---------- both sides: reading a submission once K is unlocked ----------
  async function readManifest(header, K) { return JSON.parse(dec.decode(await unseal(K, unb64(header.manifest), 'manifest'))); }
  async function readPiece(K, data, f, c) { return unseal(K, data instanceof Uint8Array ? data : unb64(data), `f${f}.c${c}`); }

  const api = {
    PIECE, OVERHEAD, ROUNDS, b64, unb64, hex, sha256, formatKey, readKey, readRef,
    lockSubmission, accessCode, keyFromApplicant,
    makeOfficeKey, officePublic, unlockOffice, relockOffice, keyFromOffice,
    readManifest, readPiece,
  };
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  root.VemianCrypto = api;
})(typeof self !== 'undefined' ? self : globalThis);
