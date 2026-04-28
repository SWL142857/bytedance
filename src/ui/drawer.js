let _prevFocusEl = null;

export function openDrawer() {
  const drawer = document.getElementById("console-drawer");
  const backdrop = document.getElementById("drawer-backdrop");
  if (!drawer || !backdrop) return;
  _prevFocusEl = document.activeElement;
  drawer.hidden = false;
  backdrop.hidden = false;
  requestAnimationFrame(function () {
    drawer.classList.add("drawer-open");
    backdrop.classList.add("drawer-backdrop-visible");
    const firstFocusable = drawer.querySelector("button, [href], input, select, textarea, [tabindex]:not([tabindex=\"-1\"])");
    if (firstFocusable) firstFocusable.focus();
  });
}

export function closeDrawer() {
  const drawer = document.getElementById("console-drawer");
  const backdrop = document.getElementById("drawer-backdrop");
  if (!drawer || !backdrop) return;
  drawer.classList.remove("drawer-open");
  backdrop.classList.remove("drawer-backdrop-visible");
  setTimeout(function () {
    drawer.hidden = true;
    backdrop.hidden = true;
    if (_prevFocusEl && _prevFocusEl.focus) _prevFocusEl.focus();
    _prevFocusEl = null;
  }, 320);
}

export function trapFocus(e) {
  const drawer = document.getElementById("console-drawer");
  if (!drawer || drawer.hidden) return;
  const focusables = drawer.querySelectorAll("button, [href], input, select, textarea, [tabindex]:not([tabindex=\"-1\"])");
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

export function mountDrawer() {
  const openBtn = document.getElementById("console-open-btn");
  if (openBtn) openBtn.addEventListener("click", openDrawer);

  const closeBtn = document.getElementById("drawer-close-btn");
  if (closeBtn) closeBtn.addEventListener("click", closeDrawer);

  const backdrop = document.getElementById("drawer-backdrop");
  if (backdrop) backdrop.addEventListener("click", closeDrawer);

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeDrawer();
    if (e.key === "Tab") trapFocus(e);
  });
}

export function mountIntroOverlay() {
  const overlay = document.getElementById("intro-overlay");
  if (!overlay) return;

  const prefersReduced = window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let alreadyShown = false;
  try { alreadyShown = sessionStorage.getItem("hireloop-intro-shown") === "1"; }
  catch (e) { alreadyShown = false; }

  if (prefersReduced || alreadyShown) {
    overlay.hidden = true;
    return;
  }

  const fill = overlay.querySelector(".intro-bar-fill");
  if (fill) {
    requestAnimationFrame(function () {
      fill.style.width = "100%";
    });
  }

  setTimeout(function () {
    overlay.setAttribute("data-state", "leave");
    try { sessionStorage.setItem("hireloop-intro-shown", "1"); } catch (e) { /* noop */ }
    setTimeout(function () { overlay.hidden = true; }, 360);
  }, 880);
}
