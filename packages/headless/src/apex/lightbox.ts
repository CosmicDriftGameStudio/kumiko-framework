// Vanilla lightbox for Apex marketing pages — click .shot-frame img to enlarge,
// prev/next (buttons or arrow keys) walks all .shot-frame images on the page.
// Injected by renderApexPage; no React, no per-app wiring.

export const APEX_LIGHTBOX_HTML = `<dialog id="apex-lightbox" class="apex-lightbox" aria-label="Screenshot preview">
  <button type="button" class="apex-lightbox__close" aria-label="Close">&times;</button>
  <button type="button" class="apex-lightbox__prev" aria-label="Previous screenshot">&lsaquo;</button>
  <button type="button" class="apex-lightbox__next" aria-label="Next screenshot">&rsaquo;</button>
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
  var prevBtn = dlg.querySelector(".apex-lightbox__prev");
  var nextBtn = dlg.querySelector(".apex-lightbox__next");
  if (!img || !closeBtn || !prevBtn || !nextBtn) return;
  var shots = [];
  var current = 0;
  function show(i) {
    var shot = shots[i];
    current = i;
    img.src = shot.currentSrc || shot.src;
    img.alt = shot.alt || "";
  }
  function step(delta) {
    if (shots.length < 2) return;
    show((current + delta + shots.length) % shots.length);
  }
  function open(target) {
    shots = Array.prototype.slice.call(document.querySelectorAll(".shot-frame img"));
    var start = shots.indexOf(target);
    if (start < 0) {
      shots = [target];
      start = 0;
    }
    show(start);
    prevBtn.hidden = nextBtn.hidden = shots.length < 2;
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
    open(t);
  });
  closeBtn.addEventListener("click", close);
  prevBtn.addEventListener("click", function () { step(-1); });
  nextBtn.addEventListener("click", function () { step(1); });
  document.addEventListener("keydown", function (e) {
    if (!dlg.open) return;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      step(-1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      step(1);
    }
  });
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
export const APEX_LIGHTBOX_SCRIPT_CSP_HASH = "sha256-CLZlqZx0zShYKXq1Qg6+VYMTEC6tqiIlNf6JPA1nLck=";
