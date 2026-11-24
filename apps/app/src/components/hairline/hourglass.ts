// @ts-nocheck
// Empty-state figure: hourglass.
// Vendored from @lucasmarkes/hairline (MIT, see ./LICENSE). Drawn with the
// hairline-create skill; edit the figure here, not a generated copy.
import { HL } from "./kernel";

/**
 * Hourglass: an hourglass in its frame, two discs and three posts round two
 * glass bulbs. All the sand is still in the top bulb; the glass and the sand's
 * level are lit, the frame quieter, and the bottom bulb is bare. As the pointer nears, the
 * hourglass rocks on its rim toward it, as if about to be turned, and settles
 * back; no grain falls. The slider is how far it can lean, in degrees.
 *
 * The pattern: one continuous answer. Two springs hold the lean, toward x and
 * toward y; their targets come from the pointer's distance to the glass's
 * resting neck and its direction on the neck's plane, both fixed, so the lean
 * never moves the hit out from under the pointer.
 */
const { Cam, place, circ, clamp, facing, fit, hull, open, poly, prism, proj, put, rad, rrect, solid, spring, stepS, unproj, disposer, mk, pointer, register } = HL;

const RD = 28, TD = 4.5, H = 80, ZN = H / 2, RP = 21.5, NEAR = 30, REACH = 175, ZS = 51;
const POSTS = [218, 98, -18]; // the far post first, then the two near ones
/** The glass's radius at u, from the neck (0) to the disc (1). */
const bulb = (u) => 2.4 + 13.6 * Math.sin(rad(138 * u));

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let most = value;

  const C = Cam(45, 0.5, 2.75);
  fit(C, [[-RD, -RD, 0], [RD, RD, 0], [RD, -RD, 0], [-RD, RD, 0], [-RD, -RD, H], [RD, RD, H], [RD, -RD, H], [-RD, RD, H]], 200, 166);
  const P = proj(C), front = facing(C);

  const disc = [rrect(-RD, -RD, RD, RD, RD, 14), rrect(-RD + 1.8, -RD + 1.8, RD - 1.8, RD - 1.8, RD - 1.8, 14)];
  const post = circ(1.9, 24), neck = circ(3.4, 32);
  const zLo = (u) => ZN - u * (ZN - TD), zHi = (u) => ZN + u * (H - TD - ZN);
  const levels = Array.from({ length: 13 }, (_, k) => k / 12);
  const uS = (ZS - ZN) / (H - TD - ZN), sand = circ(bulb(uS) - 0.9, 48);

  const g = mk("g", {}, svg);
  const base = solid(g), back = solid(g);
  const glassLo = mk("path", { class: "sil hi" }, g), glassHi = mk("path", { class: "sil hi" }, g);
  const collar = solid(g), level = mk("path", { class: "nf sil hi" }, g);
  // the sand's top, a few grains on it, none below
  const grains = [], rs = bulb(uS) - 3.4;
  for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) {
    const x = (i + (j % 2) * 0.5) * 3.6 + 0.8, y = j * 3.2 - 0.6;
    if (Math.hypot(x, y) < rs && (i * 7 + j * 3 + 21) % 4 !== 0) grains.push([x, y, ZS, mk("circle", { r: 0.8, class: "dot off" }, g)]);
  }
  const near = [solid(g), solid(g)], top = solid(g);
  const posts = [back].concat(near);
  // the frame holds the glass: drawn quieter than it
  for (const f of [base, back, collar, top].concat(near)) f.sil.classList.remove("sil");

  let drawn = "";
  function draw(ax, ay) {
    const key = ax.toFixed(2) + "," + ay.toFixed(2);
    if (key === drawn) return;
    drawn = key;
    // rock on the rim toward the lean: s along it, measured from the pivot on the rim
    const len = Math.hypot(ax, ay), th = rad(len), ux = len ? ax / len : 1, uy = len ? ay / len : 0;
    const c = Math.cos(th), s = Math.sin(th);
    const T = (x, y, z) => {
      const a = x * ux + y * uy - RD, w = -x * uy + y * ux;
      const a3 = a * c + z * s + RD, z2 = -a * s + z * c;
      return P(a3 * ux - w * uy, a3 * uy + w * ux, z2);
    };
    const at = (cx, cy) => (x, y, z) => T(x + cx, y + cy, z);
    const ring = (r, z) => r.map((q) => T(q.u, q.v, z));
    const shell = (zf) => poly(hull(levels.flatMap((u) => ring(circ(bulb(u), 40), zf(u)))));

    put(base, prism(T, front, disc[0], disc[1], 0, TD));
    POSTS.forEach((deg, i) => put(posts[i], prism(at(RP * Math.cos(rad(deg)), RP * Math.sin(rad(deg))), front, post, null, TD, H - TD)));
    glassLo.setAttribute("d", shell(zLo));
    glassHi.setAttribute("d", shell(zHi));
    put(collar, prism(T, front, neck, null, ZN - 2.6, ZN + 2.6));
    for (const [x, y, z, el] of grains) place(el, T(x, y, z));
    level.setAttribute("d", poly(ring(sand, ZS)));
    put(top, prism(T, front, disc[0], disc[1], H - TD, H));
  }

  const sx = spring(0), sy = spring(0);
  draw(0, 0);
  const B = register(stage, (dt) => { const m = stepS(sx, dt) | stepS(sy, dt); draw(sx.x, sy.x); return !!m; });
  bag.add(B.unregister);

  // the hit: distance from where the neck rests, and direction on the neck's plane; neither moves
  const anchor = P(0, 0, ZN);
  function aim(f, dx, dy) {
    sx.t = most * f * dx;
    sy.t = most * f * dy;
    const on = f > 0.5;
    read.textContent = on ? "fallen · 0" : "rest";
    B.wake();
  }
  bag.add(pointer(stage, {
    move: ([x, y]) => {
      const d = Math.hypot(x - anchor[0], y - anchor[1]), t = clamp((REACH - d) / (REACH - NEAR), 0, 1);
      const [wx, wy] = unproj(C, x, y, ZN), l = Math.hypot(wx, wy), k = Math.min(1, l / 30) / (l || 1);
      aim(t * t * (3 - 2 * t), wx * k, wy * k);
    },
    leave: () => aim(0, 0, 0),
  }));
  bag.add(() => svg.replaceChildren());

  return { set: (v) => { most = v; aim(0, 0, 0); }, destroy: bag.dispose };
}

export default {
  name: "hourglass",
  means: "An hourglass with all its sand still on top: bring the pointer near and it leans, as if to be turned. Nothing has fallen.",
  rules: [1, 3, 5, 8],
  range: [6, 11, 16],
  tour: [[318, 214], [92, 150], null],
  mount,
};
