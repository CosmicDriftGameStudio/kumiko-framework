// Vanilla lightbox for Apex marketing pages — click .shot-frame img to enlarge.
// Injected by renderApexPage; no React, no per-app wiring.

export const APEX_LIGHTBOX_HTML = `<dialog id="apex-lightbox" class="apex-lightbox" aria-label="Screenshot preview">
  <button type="button" class="apex-lightbox__close" aria-label="Close">&times;</button>
  <img class="apex-lightbox__img" alt="" />
</dialog>`;

// Split from APEX_LIGHTBOX_SCRIPT so APEX_LIGHTBOX_SCRIPT_CSP_HASH hashes
// exactly the bytes the browser executes — CSP's script-src hash-source
// covers the content between <script> and </script>, nothing more/less.
const APEX_LIGHTBOX_SCRIPT_BODY = `
(function () {
  var dlg = document.getElementById("apex-lightbox");
  if (!dlg) return;
  var img = dlg.querySelector(".apex-lightbox__img");
  var closeBtn = dlg.querySelector(".apex-lightbox__close");
  if (!img || !closeBtn) return;
  function open(src, alt) {
    img.src = src;
    img.alt = alt || "";
    if (typeof dlg.showModal === "function") dlg.showModal();
  }
  function close() {
    if (dlg.open) dlg.close();
  }
  document.addEventListener("click", function (e) {
    var t = e.target;
    if (!(t instanceof HTMLImageElement)) return;
    if (!t.closest(".shot-frame")) return;
    e.preventDefault();
    open(t.currentSrc || t.src, t.alt);
  });
  closeBtn.addEventListener("click", close);
  dlg.addEventListener("click", function (e) {
    if (e.target === dlg) close();
  });
  dlg.addEventListener("cancel", function (e) {
    e.preventDefault();
    close();
  });
})();
`;

/** ponytail: one delegated listener; no-op when no .shot-frame on the page. */
export const APEX_LIGHTBOX_SCRIPT = `<script>${APEX_LIGHTBOX_SCRIPT_BODY}</script>`;

// Apps that enforce `script-src 'self'` without `'unsafe-inline'`/nonce (the
// apex renderer has no per-request nonce hook — its output is often
// pre-rendered to static HTML at build time, where a nonce can't work
// anyway) need a hash-source instead. Add this to your CSP's script-src,
// e.g. `script-src 'self' 'sha256-...'` (value = this constant).
// lightbox.test.ts asserts this matches APEX_LIGHTBOX_SCRIPT_BODY byte-for-
// byte, so an edit to the script that doesn't update the hash fails CI
// instead of silently breaking every strict-CSP consumer's lightbox.
export const APEX_LIGHTBOX_SCRIPT_CSP_HASH = "sha256-f+hHLpDuQsjmtFZCjdM13D9NaMTCyOKaawAhfLf/X9o=";
