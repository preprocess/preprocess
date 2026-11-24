// @ts-nocheck
// Empty-state figure: briefcase.
// Vendored from @lucasmarkes/hairline (MIT, see ./LICENSE). Drawn with the
// hairline-create skill; edit the figure here, not a generated copy.
import { HL } from "./kernel";

/**
 * Briefcase: a hard case lying flat, handle out, lid a crack ajar. As the
 * pointer nears, the lid swings up on its back hinge and shows the bare floor
 * and an empty document pocket inside. The slider is how far the lid can open,
 * in degrees.
 *
 * The pattern: one continuous answer. A spring follows the pointer's distance
 * from the lid's resting centre, a fixed point, so the rising lid can never
 * move the hit out from under the pointer.
 */
const { Cam, clamp, fillet, fit, hull, open, poly, proj, rad, rrect, run, seg, spring, stepS, disposer, mk, place, pointer, register } = HL;

const L = 84, W = 58, HB = 11, HL_ = 7, R = 5, T = 1.6, B = 1.4, REST = 16, NEAR = 36, REACH = 170;
const HX = L / 2, HW = 15, HD = 11, LEG = 5, ZH = 4.6, HT = 2.4;
const LATCH = [L * 0.2, L * 0.8];

const area = (pts) => pts.reduce((s, p, k) => { const q = pts[(k + 1) % pts.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0);
/** A closed outline wound against `like`, so the two in one path cut a hole. */
const against = (pts, like) => (Math.sign(area(pts)) === Math.sign(area(like)) ? pts.slice().reverse() : pts);

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let most = value;

  const C = Cam(45, 0.5, 2.45);
  /** The lid's local point (u along the case, v from the hinge, w up from the seam), opened th degrees. */
  const lidPt = (th) => { const s = Math.sin(rad(th)), c = Math.cos(rad(th)); return (u, v, w) => [u, v * c - w * s, HB + v * s + w * c]; };
  const ext = [];
  for (const th of [0, 122]) for (const [u, v, w] of [[0, 0, 0], [L, 0, HL_], [0, W, HL_], [L, W, 0], [L, W, HL_], [0, 0, HL_]]) ext.push(lidPt(th)(u, v, w));
  fit(C, ext.concat([[0, W, 0], [L, W, 0], [L, 0, 0], [HX - HW, W + HD, ZH], [HX + HW, W + HD, ZH]]), 200, 168);
  const P = proj(C);
  // the direction toward the viewer: the one world vector the camera flattens to a point
  const o = P(0, 0, 0), ax = [P(1, 0, 0), P(0, 1, 0), P(0, 0, 1)].map((p) => [p[0] - o[0], p[1] - o[1]]);
  const r1 = ax.map((a) => a[0]), r2 = ax.map((a) => a[1]);
  let eye = [r1[1] * r2[2] - r1[2] * r2[1], r1[2] * r2[0] - r1[0] * r2[2], r1[0] * r2[1] - r1[1] * r2[0]];
  if (eye[2] < 0) eye = eye.map((x) => -x);
  const sees = (n) => n[0] * eye[0] + n[1] * eye[1] + n[2] * eye[2] > 1e-6;
  const front = (q) => sees([q.nu, q.nv, 0]);

  const outer = rrect(0, 0, L, W, R, 5), crease = rrect(B, B, L - B, W - B, R - B, 5), lip = rrect(T, T, L - T, W - T, R - T, 5);
  const at = (ring, z) => ring.map((q) => P(q.u, q.v, z));
  const g = mk("g", {}, svg);

  // inside the base, painted first: the floor seam along the far walls, seen only through the opening
  mk("path", { d: open(at(run(lip, (q) => !front(q)), T)), class: "nf lo" }, g);

  // the base, lit whole with its lid, handle and latches: one plate from its foot and rim, with the opening cut through its top
  const shell = hull(at(outer, 0).concat(at(outer, HB)));
  mk("path", { d: poly(shell) + poly(against(at(lip, HB), shell)), class: "sil hi" }, g);
  mk("path", { d: open(at(run(outer, front), HB - 0.01)), class: "nf lo" }, g);

  // the two latches on the near side, just under the seam
  const onSide = (y) => (p) => P(p[0], y, p[1]);
  for (const x of LATCH) {
    const plate = fillet([[x - 5, HB - 6.5], [x + 5, HB - 6.5], [x + 5, HB - 0.8], [x - 5, HB - 0.8]], [1.4, 1.4, 1, 1]);
    mk("path", { d: poly(plate.map(onSide(W + 0.4))), class: "lo" }, g);
    mk("path", { d: poly(plate.map(onSide(W + 1.3))), class: "nf hi" }, g);
    place(mk("circle", { r: 0.9, class: "dot off" }, g), P(x, W + 1.3, HB - 4.2));
  }

  // the handle, a flat loop out of the near side
  const loop = fillet(
    [[HX - HW, W], [HX - HW, W + HD], [HX + HW, W + HD], [HX + HW, W], [HX + HW - LEG, W], [HX + HW - LEG, W + HD - LEG], [HX - HW + LEG, W + HD - LEG], [HX - HW + LEG, W]],
    [0.4, 4.5, 4.5, 0.4, 0.4, 1.6, 1.6, 0.4],
  );
  mk("path", { d: poly(loop.map((p) => P(p[0], p[1], ZH))), class: "lo" }, g);
  mk("path", { d: poly(loop.map((p) => P(p[0], p[1], ZH + HT))), class: "sil hi" }, g);

  // the lid: its inside (floor seam, an empty pocket), then its shell, then the catches on its near wall
  const lg = mk("g", {}, g);
  const lSeam = mk("path", { class: "nf lo" }, lg);
  const vm = W * 0.5, pocket = fillet(
    [[6, 5], [L - 6, 5], [L - 6, vm], [HX + 8, vm], [HX + 4, vm - 4.5], [HX - 4, vm - 4.5], [HX - 8, vm], [6, vm]],
    [2, 2, 1.4, 1, 2.2, 2.2, 1, 1.4],
  );
  const pBack = mk("path", { class: "lo" }, lg), pFace = mk("path", { class: "sil" }, lg);
  const lShell = mk("path", { class: "sil hi" }, lg), lCrease = mk("path", { class: "nf lo" }, lg);
  const catches = LATCH.map(() => mk("path", { class: "nf hi" }, lg));
  const catchShape = (x) => fillet([[x - 3.5, 0.8], [x + 3.5, 0.8], [x + 3.5, 3.8], [x - 3.5, 3.8]], [0.8, 0.8, 0.8, 0.8]);

  let drawn = NaN;
  function draw(th) {
    if (Math.abs(th - drawn) < 0.01) return;
    drawn = th;
    const s = Math.sin(rad(th)), c = Math.cos(rad(th)), lp = lidPt(th);
    const Q = (u, v, w) => P(...lp(u, v, w));
    const tilt = (q) => [q.nu, q.nv * c, q.nv * s];
    const ring = (rg, w) => rg.map((q) => Q(q.u, q.v, w));
    const inside = !sees([0, -s, c]);
    const sil = hull(ring(outer, 0).concat(ring(outer, HL_)));
    lShell.setAttribute("d", poly(sil) + (inside ? poly(against(ring(lip, 0), sil)) : ""));
    lCrease.setAttribute("d", inside ? "" : open(ring(run(crease, (q) => sees(tilt(q))), HL_)));
    lSeam.setAttribute("d", inside ? open(ring(run(lip, (q) => !sees(tilt(q))), HL_ - T)) : "");
    pBack.setAttribute("d", inside ? poly(pocket.map((p) => Q(p[0], p[1], HL_ - T))) : "");
    pFace.setAttribute("d", inside ? poly(pocket.map((p) => Q(p[0], p[1], HL_ - T - 1.2))) : "");
    const nearWall = sees([0, c, s]);
    catches.forEach((el, i) => el.setAttribute("d", nearWall ? poly(catchShape(LATCH[i]).map((p) => Q(p[0], W + 0.9, p[1]))) : ""));
  }

  const sp = spring(REST);
  draw(REST);
  const Bk = register(stage, (dt) => { const moving = stepS(sp, dt); draw(sp.x); return moving; });
  bag.add(Bk.unregister);

  // the hit: distance from where the lid's centre rests, which never moves
  const anchor = P(L / 2, W / 2, HB + HL_);
  function aim(f) {
    sp.t = REST + (most - REST) * f;
    const on = f > 0.5;
    read.textContent = on ? "case · 0" : "rest";
    Bk.wake();
  }
  bag.add(pointer(stage, {
    move: ([x, y]) => {
      const d = Math.hypot(x - anchor[0], y - anchor[1]), t = clamp((REACH - d) / (REACH - NEAR), 0, 1);
      aim(t * t * (3 - 2 * t));
    },
    leave: () => aim(0),
  }));
  bag.add(() => svg.replaceChildren());

  return { set: (v) => { most = v; aim(0); }, destroy: bag.dispose };
}

export default {
  name: "briefcase",
  means: "A briefcase lying shut: bring the pointer near and the lid swings up on an empty pocket.",
  rules: [1, 3, 5, 8],
  range: [72, 100, 120],
  tour: [[200, 200], [215, 150], null],
  mount,
};
