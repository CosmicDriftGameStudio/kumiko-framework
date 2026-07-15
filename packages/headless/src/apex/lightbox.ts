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

// CSP hash-source for the inline script above; apex output is often
// pre-rendered, so a per-request nonce can't work. Guarded by lightbox.test.ts.
export const APEX_LIGHTBOX_SCRIPT_CSP_HASH = "sha256-f+hHLpDuQsjmtFZCjdM13D9NaMTCyOKaawAhfLf/X9o=";
