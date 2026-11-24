// @ts-nocheck
// Empty-state figure: funnel.
// Vendored from @lucasmarkes/hairline (MIT, see ./LICENSE). Drawn with the
// hairline-create skill; edit the figure here, not a generated copy.
import { HL } from "./kernel";

/**
 * Funnel: a glass funnel held in the ring of a lab stand, over an empty
 * beaker. As the pointer nears, the funnel swivels on the ring's arm and tips
 * its mouth toward the viewer, so you see down its bare cone to the drain.
 * Nothing drips. The slider is how far it can tip, in degrees.
 *
 * The pattern: one continuous answer. A spring follows the pointer's distance
 * from the rim's resting centre, a fixed point, so the tipping funnel never
 * moves the hit out from under the pointer.
 */
const { Cam, clamp, facing, fit, hull, open, poly, prism, proj, put, rad, rings, seg, solid, spring, stepS, disposer, mk, pointer, register } = HL;

const ZP = 56, RIM = 72, NECK = 46, TIP = 32, RR = 22, RN = 2.6, LIP = 1.4, RING = 10.1, RW = 2;
const BZ0 = 5, BZ1 = 31, BR = 14, ROD = [30, -30], REST = 5, NEAR = 36, REACH = 170;
const S2 = Math.SQRT1_2;

/** A world point on the funnel, given in its own frame (a along the arm, b toward the viewer, z up), tipped by th degrees about the arm. */
function tip(a, b, z, th) {
  const s = Math.sin(rad(th)), c = Math.cos(rad(th)), h = z - ZP;
  const b2 = b * c + h * s, z2 = -b * s + h * c + ZP;
  return [(a + b2) * S2, (b2 - a) * S2, z2];
}
/** n samples round a circle of radius r at height z in the funnel's frame, as world points. */
const circle = (r, z, th, n = 28) => Array.from({ length: n }, (_, k) => {
  const f = (k / n) * Math.PI * 2;
  return tip(r * Math.cos(f), r * Math.sin(f), z, th);
});

const area = (pts) => pts.reduce((s, p, k) => { const q = pts[(k + 1) % pts.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0);
const against = (pts, like) => (Math.sign(area(pts)) === Math.sign(area(like)) ? pts.slice().reverse() : pts);

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let most = value;

  const C = Cam(45, 0.5, 2.5);
  fit(C, [[-26, -42, 0], [44, 22, 0], [44, -42, 0], [-26, 22, 0], [ROD[0], ROD[1], 88], ...circle(RR, RIM, 40, 8), ...circle(RR, RIM, 0, 8)], 200, 166);
  const P = proj(C), front = facing(C);
  const W = (q) => P(q[0], q[1], q[2]);

  const g = mk("g", {}, svg);

  // the stand's heavy foot
  const [fr, fi] = rings(-26, -42, 44, 22, 6, 1.6);
  const foot = solid(g);
  put(foot, prism(P, front, fr, fi, 0, BZ0));

  // the beaker: its bare floor painted first, seen through the mouth, then the glass with the mouth cut through it
  const ring = (r, z, n = 32) => Array.from({ length: n }, (_, k) => { const f = (k / n) * Math.PI * 2; return P(r * Math.cos(f), r * Math.sin(f), z); });
  const mouth = ring(BR - 1, BZ1), floor = ring(BR - 1, BZ0 + 1.6);
  mk("path", { d: poly(mouth), class: "lo" }, g);
  mk("path", { d: poly(floor), class: "nf lo" }, g);
  const glass = hull(ring(BR, BZ0).concat(ring(BR, BZ1)));
  mk("path", { d: poly(glass) + poly(against(mouth, glass)) }, g);
  // graduation ticks down the near-left side, unequal like a real scale
  const on = (f, z) => P(BR * Math.cos(rad(f)), BR * Math.sin(rad(f)), z);
  mk("path", { d: [12, 17, 22, 27].map((z, k) => seg(on(64, z), on(k % 2 ? 72 : 80, z))).join(""), class: "nf lo" }, g);

  // the rod, its clamp boss, and the arm reaching to the ring
  const [rr, ri] = rings(ROD[0] - 2, ROD[1] - 2, ROD[0] + 2, ROD[1] + 2, 2, 0.6);
  const rodS = solid(g);
  put(rodS, prism(P, front, rr, ri, BZ0, 88));
  const [br, bi] = rings(ROD[0] - 4.5, ROD[1] - 4.5, ROD[0] + 4.5, ROD[1] + 4.5, 2, 0.9);
  const boss = solid(g);
  put(boss, prism(P, front, br, bi, ZP - 5, ZP + 4));
  // the stand holds the funnel up: drawn quieter than the funnel, which is lit whole
  for (const s of [foot, rodS, boss]) s.sil.classList.remove("sil");
  const rod = (a) => [-1, 1].flatMap((sb) => [-1, 1].map((sz) => tip(a, sb * 1.3, ZP + sz * 1.3, 0)));
  mk("path", { d: poly(hull(rod(RING + RW).concat(rod(42 - 4.5)).map(W))) }, g);

  // the parts that tip: the ring's back half and the stem, the glass, the ring's front half, then the bare cone seen through the mouth
  const ringBack = mk("path", {}, g), stem = mk("path", { class: "sil hi" }, g), shell = mk("path", { class: "sil hi" }, g);
  const ringFront = mk("path", {}, g), inside = mk("path", { class: "lo" }, g), cone = mk("path", { class: "nf lo" }, g);
  const lip = mk("path", { class: "nf sil hi" }, g);
  const half = (th, near) => {
    const n = 16, arc = (r) => Array.from({ length: n + 1 }, (_, k) => {
      const f = rad(near ? (180 * k) / n : 180 + (180 * k) / n);
      return W(tip(r * Math.cos(f), r * Math.sin(f), ZP, th));
    });
    return poly(arc(RING + RW).concat(arc(RING).reverse()));
  };
  /** The runs of a polyline that fall inside the mouth: inside a convex cone, exactly what shows through it. */
  const through = (pts, mouth, closed) => {
    const sgn = Math.sign(area(mouth));
    const ins = (q) => mouth.every((a, k) => { const b = mouth[(k + 1) % mouth.length]; return sgn * ((b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0])) > 0; });
    const at = closed ? pts.findIndex((q) => !ins(q)) : 0;
    if (at < 0) return poly(pts);
    const seq = closed ? pts.slice(at).concat(pts.slice(0, at + 1)) : pts;
    let d = "", run = [];
    for (const q of seq.concat([null])) {
      if (q && ins(q)) { run.push(q); continue; }
      if (run.length > 1) d += open(run);
      run = [];
    }
    return d;
  };
  const RIBS = [20, 80, 140, 200, 260, 320];
  let drawn = NaN;
  function draw(th) {
    if (Math.abs(th - drawn) < 0.01) return;
    drawn = th;
    const rimO = circle(RR + LIP, RIM, th).map(W), rimI = circle(RR, RIM, th).map(W);
    const neck = circle(RN, NECK, th, 16).map(W), hole = circle(RN - 0.9, NECK, th, 16).map(W);
    ringBack.setAttribute("d", half(th, false));
    stem.setAttribute("d", poly(hull(circle(1.9, NECK + 1, th, 12).concat(circle(1.5, TIP, th, 12)).map(W))));
    shell.setAttribute("d", poly(hull(rimO.concat(neck))));
    ringFront.setAttribute("d", half(th, true));
    inside.setAttribute("d", poly(rimI));
    const ribs = RIBS.map((a) => through(Array.from({ length: 13 }, (_, k) => {
      const u = k / 12, r = RR - 0.6 + (RN - RR + 0.6) * u, f = rad(a);
      return W(tip(r * Math.cos(f), r * Math.sin(f), RIM - 0.4 + (NECK - RIM + 0.4) * u, th));
    }), rimI, false));
    cone.setAttribute("d", ribs.join("") + through(hole, rimI, true));
    lip.setAttribute("d", poly(rimO) + poly(rimI));
  }

  const sp = spring(REST);
  draw(REST);
  const B = register(stage, (dt) => { const moving = stepS(sp, dt); draw(sp.x); return moving; });
  bag.add(B.unregister);

  // the hit: distance from where the rim's centre rests, which never moves
  const anchor = P(0, 0, RIM);
  function aim(f) {
    sp.t = REST + (most - REST) * f;
    const on = f > 0.5;
    read.textContent = on ? "drops · 0" : "rest";
    B.wake();
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
  name: "funnel",
  means: "A funnel in its stand over an empty beaker: bring the pointer near and it tips toward you, its cone bare to the drain.",
  rules: [1, 3, 5, 6],
  range: [20, 30, 40],
  tour: [[250, 170], [170, 84], null],
  mount,
};
