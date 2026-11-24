// @ts-nocheck
// Empty-state figure: scale.
// Vendored from @lucasmarkes/hairline (MIT, see ./LICENSE). Drawn with the
// hairline-create skill; edit the figure here, not a generated copy.
import { HL } from "./kernel";

/**
 * Scale: a balance on its pillar, two bare pans hung from the beam, resting a
 * little out of true. Bring the pointer over a pan and it presses down: the
 * beam tips toward it and the other pan rises. Both stay empty. The slider is
 * how far the beam can tip, in degrees.
 *
 * The pattern: one continuous answer. A spring follows the pointer's distance
 * from each pan's resting centre, two fixed points, so a pan sinking away from
 * the pointer can never move the hit out from under it.
 */
const { Cam, circ, clamp, facing, fillet, fit, hull, open, poly, prism, proj, put, rad, ringAt, rrect, run, seg, solid, spring, stepS, disposer, mk, pointer, register } = HL;

const L = 46, PIV = 64, HANG = 27, PR = 14, PD = 4.5, D = 2.2, REST = 4, NEAR = 30, REACH = 112;
const PHI = 36, CA = Math.cos((PHI * Math.PI) / 180), SA = Math.sin((PHI * Math.PI) / 180);

/** A ring laid along the beam's own axes (u along the beam, v towards the viewer), centred on (cu, cv). */
const turn = (ring, cu = 0, cv = 0) => ring.map((q) => {
  const u = q.u + cu, v = q.v + cv;
  return { u: u * CA + v * SA, v: v * CA - u * SA, nu: q.nu * CA + q.nv * SA, nv: q.nv * CA - q.nu * SA };
});

const area = (pts) => pts.reduce((s, p, k) => { const q = pts[(k + 1) % pts.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0);
/** A closed outline wound against `like`, so the two in one path cut a hole. */
const against = (pts, like) => (Math.sign(area(pts)) === Math.sign(area(like)) ? pts.slice().reverse() : pts);

/** The beam in its own plane (u along it, w up from the pivot): tapered arms, rounded ends, and the needle standing over the pivot. */
const E = L + 3;
const BEAM = fillet(
  [[-E, -1.7], [-7, -3.2], [7, -3.2], [E, -1.7], [E, 1.7], [7, 3.2], [1.5, 3.2], [0.45, 12], [-0.45, 12], [-1.5, 3.2], [-7, 3.2], [-E, 1.7]],
  [1.6, 3, 3, 1.6, 1.6, 3, 0.8, 0.4, 0.4, 0.8, 3, 1.6],
);
const hole = (cu, r) => circ(r, 24).map((q) => [q.u + cu, q.v]);

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let most = value;

  const C = Cam(45, 0.5, 2.5);
  const W = (u, v, z) => [u * CA + v * SA, v * CA - u * SA, z];
  const lo = PIV - L * Math.sin(rad(20)) - HANG - PD, hi = PIV + L * Math.sin(rad(20)) + 1;
  fit(C, [W(-22, 13, 0), W(22, 13, 0), W(-22, -13, 0), W(22, -13, 0), W(-L - PR, 0, lo), W(L + PR, 0, lo), W(-L - PR, -PR, hi), W(L + PR, -PR, hi), W(0, 0, PIV + 12)], 200, 166);
  const P0 = proj(C), front = facing(C);
  const P = (u, v, z) => P0(...W(u, v, z));

  const g = mk("g", {}, svg);

  // a stepped plinth, the pillar standing in it, and the collar under the pivot
  const box = (x, y, r, b, n) => [turn(rrect(-x, -y, x, y, r, n)), turn(rrect(-x + b, -y + b, x - b, y - b, r - b, n))];
  const round = (r, b) => [turn(circ(r, 32)), turn(circ(r - b, 32))];
  // the plinth, pillar and collar hold the balance up: drawn quieter than it
  const block = ([ring, inner], z0, z1) => { const b = solid(g); put(b, prism(P0, front, ring, inner, z0, z1)); b.sil.classList.remove("sil"); };
  block(box(22, 13, 6, 1.4, 10), 0, 4);
  block(box(12, 7, 4, 1, 8), 4, 7);
  block(round(3.4, 0.8), 7, PIV - 5);
  block(round(5, 1), PIV - 7, PIV - 4);

  // the index behind the needle: a curved band over the pivot with three ticks
  const band = [];
  for (let k = 0; k <= 10; k++) { const a = rad(40 + k * 10); band.push([10 * Math.cos(a), 10 * Math.sin(a)]); }
  for (let k = 10; k >= 0; k--) { const a = rad(40 + k * 10); band.push([7.5 * Math.cos(a), 7.5 * Math.sin(a)]); }
  const onIdx = (p) => P(p[0], -2.4, PIV + p[1]);
  mk("path", { d: poly(band.map(onIdx)), class: "lo" }, g);
  mk("path", { d: [70, 90, 110].map((a) => seg(onIdx([8.3 * Math.cos(rad(a)), 8.3 * Math.sin(rad(a))]), onIdx([10 * Math.cos(rad(a)), 10 * Math.sin(rad(a))]))).join(""), class: "nf lo" }, g);

  // the pans, lit with the beam, each painted before its hangers: a shallow dish, its lip, and the bare floor's far edge
  const rim = circ(PR, 48), lip = circ(PR - 1.2, 48), foot = circ(PR - 5, 48), floor = circ(PR - 6, 48);
  const pans = [-1, 1].map(() => {
    const pg = mk("g", {}, g);
    return { body: mk("path", { class: "sil hi" }, pg), lip: mk("path", { class: "nf hi" }, pg), floor: mk("path", { class: "nf lo" }, pg), wires: mk("path", { class: "nf lo" }, pg) };
  });

  // the beam, lit whole with its pans: its back edge, its face, and the pivot cap
  const bBack = mk("path", { class: "lo" }, g), bFace = mk("path", { class: "sil hi" }, g), cap = mk("path", { class: "nf hi" }, g);

  let drawn = NaN;
  function draw(th) {
    if (Math.abs(th - drawn) < 0.01) return;
    drawn = th;
    const s = Math.sin(rad(th)), c = Math.cos(rad(th));
    const at = (v) => (p) => P(p[0] * c + p[1] * s, v, PIV - p[0] * s + p[1] * c);
    const face = BEAM.map(at(D / 2));
    bBack.setAttribute("d", poly(BEAM.map(at(-D / 2))));
    bFace.setAttribute("d", poly(face) + [-L, L].map((u) => poly(against(hole(u, 1.1).map(at(D / 2)), face))).join(""));
    cap.setAttribute("d", poly(hole(0, 2.6).map(at(D / 2 + 0.3))) + poly(hole(0, 0.9).map(at(D / 2 + 0.3))));
    [-1, 1].forEach((side, i) => {
      const hu = side * L * c, hz = PIV - side * L * s, zr = hz - HANG, pn = pans[i];
      const ring = (r, z) => ringAt(P0, turn(r, hu, 0), z);
      const top = ring(rim, zr), sides = [top.reduce((a, p) => (p[0] < a[0] ? p : a)), top.reduce((a, p) => (p[0] > a[0] ? p : a))];
      pn.body.setAttribute("d", poly(hull(top.concat(ring(foot, zr - PD)))));
      pn.lip.setAttribute("d", poly(ring(lip, zr)));
      pn.floor.setAttribute("d", open(ringAt(P0, run(turn(floor, hu, 0), (q) => !front(q)), zr - PD + 0.8)));
      const hook = P(hu, 0, hz);
      pn.wires.setAttribute("d", sides.map((p) => seg(hook, p)).join(""));
    });
  }

  const sp = spring(REST);
  draw(REST);
  const B = register(stage, (dt) => { const moving = stepS(sp, dt); draw(sp.x); return moving; });
  bag.add(B.unregister);

  // the hit: distance from where each pan's centre rests, which never moves
  const anchors = [-1, 1].map((side) => P(side * L * Math.cos(rad(REST)), 0, PIV - side * L * Math.sin(rad(REST)) - HANG));
  function aim(side, f) {
    sp.t = REST + (side * most - REST) * f;
    const on = f > 0.5 ? (side < 0 ? 0 : 1) : -1;
    read.textContent = on < 0 ? "rest" : on === 0 ? "pan L · 0" : "pan R · 0";
    B.wake();
  }
  const near = ([x, y], a) => { const t = clamp((REACH - Math.hypot(x - a[0], y - a[1])) / (REACH - NEAR), 0, 1); return t * t * (3 - 2 * t); };
  bag.add(pointer(stage, {
    move: (p) => { const fl = near(p, anchors[0]), fr = near(p, anchors[1]); if (fl > fr) aim(-1, fl); else aim(1, fr); },
    leave: () => aim(1, 0),
  }));
  bag.add(() => svg.replaceChildren());

  return { set: (v) => { most = v; aim(1, 0); }, destroy: bag.dispose };
}

export default {
  name: "scale",
  means: "A balance with two bare pans, a little out of true: press a pan with the pointer and the beam tips toward it.",
  rules: [1, 3, 5, 8],
  range: [9, 14, 20],
  tour: [[311, 193], [84, 161], null],
  mount,
};
