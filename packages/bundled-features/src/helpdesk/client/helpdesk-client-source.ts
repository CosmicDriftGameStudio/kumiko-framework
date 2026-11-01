// The browser client ships as a string so it survives the tsc-only dist build, which copies no
// loose .js assets. Keep it free of backslashes, backticks and template placeholders.
export const HELPDESK_CLIENT_SOURCE = `(function () {
  "use strict";

  var QUERY_PATH = "/api/query";
  var WRITE_PATH = "/api/write";
  var CHALLENGE_QUERY = "helpdesk:query:challenge";
  var SUBMIT_WRITE = "helpdesk:write:submit";
  var CSRF_COOKIE_NAME = "kumiko_csrf";
  var CSRF_HEADER_NAME = "X-CSRF-Token";
  var LOCALE_HEADER_NAME = "X-Locale";
  var SLICE_MS = 12;

  var K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ]);
  var H0 = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

  var block = new Uint8Array(64);
  var words = new Uint32Array(64);
  var digest = new Uint32Array(8);

  function rotr(x, n) {
    return (x >>> n) | (x << (32 - n));
  }

  // One 64-byte block only: challenge, colon and decimal nonce stay far below 56 bytes.
  function sha256Block() {
    var i;
    for (i = 0; i < 16; i++) {
      words[i] = (block[i * 4] << 24) | (block[i * 4 + 1] << 16) | (block[i * 4 + 2] << 8) | block[i * 4 + 3];
    }
    for (i = 16; i < 64; i++) {
      var w15 = words[i - 15];
      var w2 = words[i - 2];
      var s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
      var s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
      words[i] = (words[i - 16] + s0 + words[i - 7] + s1) | 0;
    }
    var a = H0[0], b = H0[1], c = H0[2], d = H0[3], e = H0[4], f = H0[5], g = H0[6], h = H0[7];
    for (i = 0; i < 64; i++) {
      var t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + words[i]) | 0;
      var t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    digest[0] = (H0[0] + a) | 0; digest[1] = (H0[1] + b) | 0; digest[2] = (H0[2] + c) | 0; digest[3] = (H0[3] + d) | 0;
    digest[4] = (H0[4] + e) | 0; digest[5] = (H0[5] + f) | 0; digest[6] = (H0[6] + g) | 0; digest[7] = (H0[7] + h) | 0;
  }

  function hasLeadingZeroBits(bits) {
    var i = 0;
    var remaining = bits;
    while (remaining >= 32) {
      if (digest[i] !== 0) return false;
      i++;
      remaining -= 32;
    }
    if (remaining === 0) return true;
    return (digest[i] >>> (32 - remaining)) === 0;
  }

  function solveProofOfWork(challenge, bits) {
    return new Promise(function (resolve, reject) {
      var prefix = challenge + ":";
      if (prefix.length > 40) {
        reject(new Error("challenge too long"));
        return;
      }
      var i;
      block.fill(0);
      for (i = 0; i < prefix.length; i++) block[i] = prefix.charCodeAt(i);
      var counter = 0;

      function step() {
        var deadline = Date.now() + SLICE_MS;
        do {
          var nonce = String(counter);
          var length = prefix.length + nonce.length;
          for (i = 0; i < nonce.length; i++) block[prefix.length + i] = nonce.charCodeAt(i);
          block[length] = 0x80;
          var bitLength = length * 8;
          block[62] = (bitLength >>> 8) & 0xff;
          block[63] = bitLength & 0xff;
          sha256Block();
          if (hasLeadingZeroBits(bits)) {
            resolve(nonce);
            return;
          }
          counter++;
        } while (counter % 256 !== 0 || Date.now() < deadline);
        setTimeout(step, 0);
      }
      step();
    });
  }

  function readCsrfToken() {
    var parts = document.cookie.split(";");
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i].trim();
      var separator = part.indexOf("=");
      if (separator > 0 && part.slice(0, separator) === CSRF_COOKIE_NAME) {
        return decodeURIComponent(part.slice(separator + 1));
      }
    }
    return undefined;
  }

  function pageLocale() {
    var language = (document.documentElement.lang || "").toLowerCase().split("-")[0];
    return language === "de" ? "de-DE" : "en-US";
  }

  function postJson(path, body) {
    var headers = { "Content-Type": "application/json" };
    headers[LOCALE_HEADER_NAME] = pageLocale();
    var csrf = readCsrfToken();
    if (csrf !== undefined) headers[CSRF_HEADER_NAME] = csrf;
    return fetch(path, {
      method: "POST",
      credentials: "omit",
      headers: headers,
      body: JSON.stringify(body)
    }).then(function (response) {
      return response.json().then(
        function (json) { return { status: response.status, response: response, body: json }; },
        function () { return { status: response.status, response: response, body: undefined }; }
      );
    });
  }

  function retryAfterOf(result) {
    var header = result.response.headers.get("Retry-After");
    if (header !== null && /^[0-9]+$/.test(header)) return Number(header);
    var error = result.body && result.body.error;
    var seconds = error && error.details && error.details.retryAfterSeconds;
    return typeof seconds === "number" ? seconds : undefined;
  }

  var pending = null;

  function startChallenge() {
    return postJson(QUERY_PATH, { type: CHALLENGE_QUERY, payload: {} }).then(function (result) {
      var data = result.body && result.body.data;
      if (result.status !== 200 || !data || typeof data.challenge !== "string") {
        throw new Error("challenge failed");
      }
      var solved = solveProofOfWork(data.challenge, data.bits);
      solved.catch(function () {});
      return { challenge: data.challenge, solved: solved, options: { phone: data.phone, kinds: data.kinds } };
    });
  }

  function ensureChallenge() {
    if (pending === null) {
      pending = startChallenge();
      pending.catch(function () { pending = null; });
    }
    return pending;
  }

  function load() {
    return ensureChallenge().then(function (state) { return state.options; });
  }

  function submit(fields) {
    return ensureChallenge().then(function (state) {
      pending = null;
      return state.solved.then(function (nonce) {
        var payload = {};
        for (var key in fields) {
          if (Object.prototype.hasOwnProperty.call(fields, key)) payload[key] = fields[key];
        }
        payload.challenge = state.challenge;
        payload.nonce = nonce;
        if (payload.locale === undefined) payload.locale = document.documentElement.lang || "en";
        return postJson(WRITE_PATH, { type: SUBMIT_WRITE, payload: payload });
      });
    }).then(function (result) {
      if (result.status === 429) {
        var retryAfterSeconds = retryAfterOf(result);
        return retryAfterSeconds === undefined
          ? { kind: "rate-limited" }
          : { kind: "rate-limited", retryAfterSeconds: retryAfterSeconds };
      }
      if (result.status === 200 && result.body && result.body.isSuccess === true) return { kind: "sent" };
      return { kind: "failed" };
    }, function () {
      return { kind: "failed" };
    });
  }

  window.KumikoHelpdesk = { load: load, submit: submit };
})();
`;
