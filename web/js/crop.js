// Masters Compendium — кадрирование картинки для фишки/портрета: двигаешь и приближаешь, круг показывает, что попадёт на фишку.
(() => {
  "use strict";
  const MC = window.MC;
  const { t } = MC;

  /** Открыть картинку и выбрать кадр. Возвращает File (квадрат size×size) или null. */
  MC.cropImage = (file, size = 512) => new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.onload = () => {
      const V = Math.min(320, window.innerWidth - 60);     // размер окошка кадра на экране
      const base = V / Math.min(img.width, img.height);     // «вписать»: меньшая сторона = окошко
      let z = 1, ox = 0, oy = 0;                            // приближение и сдвиг центра (в пикселях окошка)
      const wrap = document.createElement("div");
      wrap.className = "crop-wrap";
      wrap.innerHTML = `<div class="crop-box glass">
        <b>${t("crop.title")}</b><span class="muted small">${t("crop.hint")}</span>
        <div class="crop-view" style="width:${V}px;height:${V}px"><canvas width="${V * 2}" height="${V * 2}"></canvas><i class="crop-ring"></i></div>
        <label class="crop-zoom">${MC.icon("zoom-out", "sm")}<input type="range" min="1" max="6" step="0.01" value="1">${MC.icon("zoom-in", "sm")}</label>
        <div class="crop-btns"><button class="btn small" data-crop="full">${t("crop.full")}</button>
          <button class="btn small" data-crop="x">${t("cancel")}</button>
          <button class="btn small primary" data-crop="ok">${MC.icon("check", "sm")} ${t("crop.ok")}</button></div></div>`;
      document.body.appendChild(wrap);
      const cv = wrap.querySelector("canvas"), ctx = cv.getContext("2d"), range = wrap.querySelector("input");
      const clampPan = () => {
        const k = base * z, mx = Math.max(0, (img.width * k - V) / 2), my = Math.max(0, (img.height * k - V) / 2);
        ox = MC.clamp(ox, -mx, mx); oy = MC.clamp(oy, -my, my);
      };
      const draw = () => {
        clampPan();
        const k = base * z * 2;
        ctx.clearRect(0, 0, cv.width, cv.height);
        ctx.drawImage(img, V + ox * 2 - (img.width * k) / 2, V + oy * 2 - (img.height * k) / 2, img.width * k, img.height * k);
      };
      draw();
      // перетаскивание и щипок двумя пальцами
      const pts = new Map();
      let last = null;
      const view = wrap.querySelector(".crop-view");
      view.addEventListener("pointerdown", (e) => { try { view.setPointerCapture(e.pointerId); } catch { /* */ } pts.set(e.pointerId, [e.clientX, e.clientY]); last = null; });
      view.addEventListener("pointermove", (e) => {
        if (!pts.has(e.pointerId)) return;
        const prev = pts.get(e.pointerId);
        pts.set(e.pointerId, [e.clientX, e.clientY]);
        if (pts.size === 2) {
          const [a, b] = [...pts.values()];
          const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
          if (last) { z = MC.clamp(z * d / last, 1, 6); range.value = z; }
          last = d;
        } else { ox += e.clientX - prev[0]; oy += e.clientY - prev[1]; }
        draw();
      });
      const up = (e) => { pts.delete(e.pointerId); last = null; };
      view.addEventListener("pointerup", up);
      view.addEventListener("pointercancel", up);
      view.addEventListener("wheel", (e) => { e.preventDefault(); z = MC.clamp(z * (e.deltaY < 0 ? 1.1 : 1 / 1.1), 1, 6); range.value = z; draw(); }, { passive: false });
      range.addEventListener("input", () => { z = Number(range.value); draw(); });
      const done = async (mode) => {
        wrap.remove();
        if (mode === "x") { URL.revokeObjectURL(url); resolve(null); return; }
        if (mode === "full") { URL.revokeObjectURL(url); resolve(file); return; }
        const out = document.createElement("canvas");
        const k = base * z, src = V / k;                        // сколько пикселей картинки в окошке
        out.width = out.height = Math.round(Math.min(size, src));
        const sx = img.width / 2 - ox / k - src / 2, sy = img.height / 2 - oy / k - src / 2;
        out.getContext("2d").drawImage(img, sx, sy, src, src, 0, 0, out.width, out.height);
        URL.revokeObjectURL(url);
        let blob = await new Promise((ok) => out.toBlob(ok, "image/webp", 0.92));
        if (!blob || blob.type !== "image/webp") blob = await new Promise((ok) => out.toBlob(ok, "image/png"));
        resolve(blob ? new File([blob], (file.name || "image").replace(/\.\w+$/, "") + (blob.type === "image/webp" ? ".webp" : ".png"), { type: blob.type }) : file);
      };
      wrap.addEventListener("click", (e) => { const b = e.target.closest("[data-crop]"); if (b) done(b.dataset.crop); });
    };
    img.src = url;
  });
  /** Выбрать файл и сразу кадрировать. */
  MC.pickImageCropped = async (size = 512) => {
    const f = await MC.pickFile("image/*");
    return f ? MC.cropImage(f, size) : null;
  };
})();
