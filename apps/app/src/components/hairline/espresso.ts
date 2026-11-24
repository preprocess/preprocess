// @ts-nocheck
// Empty-state figure: espresso.
// Vendored from @lucasmarkes/hairline (MIT, see ./LICENSE). Drawn with the
// hairline-create skill; edit the figure here, not a generated copy.
import { HL } from "./kernel";

/**
 * Espresso: a drained espresso cup on its saucer, handle out to the right. As
 * the pointer nears, the cup lifts off the saucer and tips its mouth toward
 * the viewer, rocking on its front foot, until its bare bottom shows: one
 * ring, nothing in it. The slider is how far the cup can tip, in degrees.
 *
 * The pattern: one continuous answer. A spring follows the pointer's distance
 * from the cup's resting centre, a fixed point, so the tipping cup can never
 * move the hit out from under the pointer.
 */
const { Cam, circ, clamp, fillet, fit, hull, poly, proj, rad, ringAt, spring, stepS, disposer, mk, pointer, register } = HL;

const RF = 9.5, RT = 15, CH = 19, T = 1.4, FL = 2.6, REST = 3, NEAR = 30, REACH = 160, N = 96;
const CX = -6, CY = -3, U = [Math.SQRT1_2, -Math.SQRT1_2, 0], NV = [Math.SQRT1_2, Math.SQRT1_2, 0];
const wall = (c) => RF + ((RT - RF) * c) / CH;

/** A point of the cup in its own frame (a along the handle, b toward the viewer, c up), tipped th degrees on its front foot and lifted. */
function pose(th) {
  const s = Math.sin(rad(th)), co = Math.cos(rad(th)), lift = th * 0.12;
  return (a, b, c) => {
    const bb = b - RF, n = bb * co + c * s + RF, z = -bb * s + c * co + lift;
    return [CX + a * U[0] + n * NV[0], CY + a * U[1] + n * NV[1], z];
  };
}
const ring = (W, r, c, b0) => Array.from({ length: N }, (_, k) => { const f = (2 * Math.PI * k) / N; return W(r * Math.cos(f), (b0 || 0) + r * Math.sin(f), c); });

const area = (pts) => pts.reduce((s, p, k) => { const q = pts[(k + 1) % pts.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0);
/** A closed outline wound against `like`, so the two in one path cut a hole. */
const against = (pts, like) => (Math.sign(area(pts)) === Math.sign(area(like)) ? pts.slice().reverse() : pts);

// the handle, an ear in the cup's own (a, c) plane, and the hole through it
const EAR = fillet([[wall(17) - 1.5, 17], [wall(16.5) + 9, 16], [wall(6) + 7, 5.4], [wall(4.5) - 1.5, 4.2]], [1, 4.8, 4.8, 1]);
const EYE = fillet([[wall(14.4) - 1.5, 14.2], [wall(14) + 6.2, 13.6], [wall(8) + 4.6, 7.8], [wall(7.4) - 1.5, 7.1]], [0.5, 2.6, 2.6, 0.5]);

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let most = value;

  const C = Cam(45, 0.5, 4);
  const ext = [0, 48].flatMap((th) => { const W = pose(th); return ring(W, RT, CH).concat(ring(W, RF, 0), EAR.map((q) => W(q[0], 0, q[1]))); });
  fit(C, ext.concat([[-33, 0, 0], [33, 0, 0], [0, -33, 3.5], [0, 33, 0], [23, 23, 0]]), 200, 168);
  const P = proj(C);
  const g = mk("g", {}, svg);

  // the saucer: a shallow dish and the well the cup's foot sits in
  const foot = circ(19, 96), top = circ(33, 96), dish = circ(27.5, 96);
  // the saucer holds the cup up: drawn quieter than the cup
  mk("path", { d: poly(hull(ringAt(P, foot, 0).concat(ringAt(P, top, 3.5)))) }, g);
  mk("path", { d: poly(ringAt(P, dish, 2.2)), class: "nf lo" }, g);
  mk("path", { d: poly(ring((x, y, z) => P(CX + x, CY + y, z), 11, 1.4)), class: "nf lo" }, g);

  // the cup, lit whole with its handle, back to front: the handle's far face and its near face, the inside, then the shell with its mouth cut through
  const earBack = mk("path", { class: "lo" }, g), earFace = mk("path", { class: "sil hi" }, g);
  const inside = mk("path", { class: "fo" }, g), floor = mk("path", { class: "nf lo" }, g);
  const shell = mk("path", { class: "sil hi" }, g), rim = mk("path", { class: "nf lo" }, g);

  let drawn = NaN;
  function draw(th) {
    if (Math.abs(th - drawn) < 0.01) return;
    drawn = th;
    const W = pose(th), S = (a, b, c) => P(...W(a, b, c)), R = (r, c) => ring(S, r, c);
    const plate = (b) => { const o = EAR.map((q) => S(q[0], b, q[1])), i = EYE.map((q) => S(q[0], b, q[1])); return poly(o) + poly(against(i, o)); };
    earBack.setAttribute("d", plate(-1.3));
    earFace.setAttribute("d", plate(1.3));
    // the mouth is cut on the rim's outer edge, so the far side is one line with the silhouette; the lip's inner edge is one dim ring
    const outerTop = R(RT, CH), body = hull(R(RF, 0).concat(outerTop));
    inside.setAttribute("d", poly(outerTop));
    floor.setAttribute("d", poly(R(wall(FL) - T, FL)));
    shell.setAttribute("d", poly(body) + poly(against(outerTop, body)));
    rim.setAttribute("d", poly(R(RT - T, CH)));
  }

  const sp = spring(REST);
  draw(REST);
  const B = register(stage, (dt) => { const moving = stepS(sp, dt); draw(sp.x); return moving; });
  bag.add(B.unregister);

  // the hit: distance from where the cup's middle rests, which never moves
  const anchor = P(...pose(REST)(0, 0, CH * 0.6));
  function aim(f) {
    sp.t = REST + (most - REST) * f;
    const on = f > 0.5;
    read.textContent = on ? "cup · 0" : "rest";
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
  name: "espresso",
  means: "A drained espresso cup on its saucer: bring the pointer near and it tips up to show its bare bottom.",
  rules: [1, 3, 5, 6],
  range: [24, 36, 48],
  tour: [[262, 196], [192, 140], null],
  mount,
};
