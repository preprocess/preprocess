// @ts-nocheck
// Empty-state figure: flashlight.
// Vendored from @lucasmarkes/hairline (MIT, see ./LICENSE). Drawn with the
// hairline-create skill; edit the figure here, not a generated copy.
import { HL } from "./kernel";

/**
 * Flashlight: a flashlight lying on a bare floor, its beam a dashed cone that
 * ends in a dashed pool on the boards. The flashlight is lit whole. The pointer is unprojected onto the floor, and the flashlight turns
 * on its middle to aim at it: a spring on the angle, clamped to a sweep. The
 * pool slides across the floor and finds nothing. The slider is the sweep, in
 * degrees either side of rest.
 *
 * The pattern: one continuous answer. The aim is read from the floor plane,
 * which never moves, so turning the flashlight can never move the hit.
 */
const { Cam, circ, clamp, facing, fit, hull, open, poly, prism, proj, put, rad, rrect, seg, solid, spring, stepS, unproj, disposer, mk, place, pointer, register } = HL;

const L = 56, PIV = 26, RB = 5.4, RH = 8.8, RZ = 9.4, RL = 7.2, POOL = 12, D = 55, REST = -4;
const PX = -2, PY = 0, V = [0.612, 0.612, 0.5];

/** The axis rises from the tail, lying on the floor, to the bezel, lying on the floor. */
const axisZ = (u) => RB + ((RZ - RB) * clamp(u, 0, L)) / L;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let sweep = value;

  const C = Cam(45, 0.5, 2.6);
  fit(C, [[-36, -48, -3], [70, -48, -3], [70, 42, -3], [-36, 42, -3], [-24, -16, 19], [-24, 18, 19]], 200, 168);
  const P = proj(C);

  const g = mk("g", {}, svg);

  // the floor: one thin plate, and three board seams running under everything
  const fr = rrect(-36, -48, 70, 42, 9, 14), fi = rrect(-34.2, -46.2, 68.2, 40.2, 7.2, 14);
  const floor = solid(g);
  put(floor, prism(P, facing(C), fr, fi, -3, 0));
  // the floor holds it up: drawn quieter than the flashlight
  floor.sil.classList.remove("sil");
  mk("path", { d: [-30, -8, 22].map((y) => seg(P(-33, y, 0), P(67, y, 0))).join(""), class: "nf lo" }, g);

  // the pool, on the boards, and the beam: painted around the flashlight
  const pool = mk("path", { class: "nf dash" }, g);
  const fl = mk("g", {}, g);
  const beam = mk("path", { class: "nf dash" }, g);

  // the flashlight's parts, tail to lens: the lens always faces the viewer inside the sweep
  const body = solid(fl), grip = mk("path", { class: "nf lo" }, fl), sw = solid(fl), head = solid(fl), bez = solid(fl);
  for (const s of [body, sw, head, bez]) s.sil.classList.add("hi");
  const face = mk("path", { class: "nf hi" }, fl), lens = mk("path", { class: "hi" }, fl), refl = mk("path", { class: "nf lo" }, fl);
  const bulb = mk("circle", { r: 1.2, class: "dot m" }, fl);
  const ring = circ(1, 28), swFoot = rrect(13, -2.2, 21, 2.2, 2), swTop = rrect(13.7, -1.5, 20.3, 1.5, 1.3);

  let drawn = NaN;
  function draw(th) {
    if (Math.abs(th - drawn) < 1e-4) return;
    drawn = th;
    const c = Math.cos(th), s = Math.sin(th);
    const W = (u, v, z) => P(PX + (u - PIV) * c - v * s, PY + (u - PIV) * s + v * c, z);
    const disc = (u, r) => ring.map((q) => W(u, r * q.u, axisZ(u) + r * q.v));
    const shell = (...parts) => poly(hull([].concat(...parts.map(([u, r]) => disc(u, r)))));
    // the half of a band round the body that faces the viewer
    const pv = -s * V[0] + c * V[1], f0 = Math.atan2(V[2], pv);
    const band = (u, r) => { const pts = []; for (let k = 0; k <= 12; k++) { const f = f0 - Math.PI / 2 + (Math.PI * k) / 12; pts.push(W(u, r * Math.cos(f), axisZ(u) + r * Math.sin(f))); } return open(pts); };

    body.sil.setAttribute("d", shell([-1, RB - 1.4], [0.8, RB], [36, RB]));
    grip.setAttribute("d", band(4.5, RB) + band(31, RB) + band(33, RB));
    const turn = (q) => ({ u: PX + (q.u - PIV) * c - q.v * s, v: PY + (q.u - PIV) * s + q.v * c, nu: q.nu * c - q.nv * s, nv: q.nu * s + q.nv * c });
    const zt = axisZ(16) + RB;
    put(sw, prism(P, (q) => q.nu * 0.707 + q.nv * 0.707 >= 0, swFoot.map(turn), swTop.map(turn), zt - 0.8, zt + 1.3));
    head.sil.setAttribute("d", shell([35, RB], [43, RH], [L - 3, RH]));
    bez.sil.setAttribute("d", shell([L - 3, RZ], [L, RZ]));
    face.setAttribute("d", poly(disc(L, RZ)));
    lens.setAttribute("d", poly(disc(L, RL)));
    refl.setAttribute("d", poly(disc(L, 2.6)));
    place(bulb, W(L, 0, axisZ(L)));

    // the pool sits D from the pivot along the aim; the beam is the cone's two outer edges
    const cx = PX + D * c, cy = PY + D * s;
    const spot = ring.map((q) => P(cx + POOL * q.u, cy + POOL * q.v, 0));
    pool.setAttribute("d", poly(spot) + poly(ring.map((q) => P(cx + POOL * 0.5 * q.u, cy + POOL * 0.5 * q.v, 0))));
    const src = disc(L, RL), from = new Set(src), h = hull(src.concat(spot));
    let d = "";
    h.forEach((a, k) => { const b = h[(k + 1) % h.length]; if (from.has(a) !== from.has(b)) d += seg(a, b); });
    beam.setAttribute("d", d);
  }

  const sp = spring(rad(REST));
  draw(sp.x);
  const B = register(stage, (dt) => { const moving = stepS(sp, dt); draw(sp.x); return moving; });
  bag.add(B.unregister);

  // the hit: the pointer on the floor plane, read as an angle round the fixed pivot
  let over = null;
  function aim() {
    const on = !!over;
    sp.t = rad(REST) + (on ? clamp(wrap(Math.atan2(over[1] - PY, over[0] - PX) - rad(REST)), -rad(sweep), rad(sweep)) : 0);
    read.textContent = on ? "spot · 0" : "rest";
    B.wake();
  }
  bag.add(pointer(stage, {
    move: ([x, y]) => { over = unproj(C, x, y, 0); aim(); },
    leave: () => { over = null; aim(); },
  }));
  bag.add(() => svg.replaceChildren());

  return { set: (v) => { sweep = v; aim(); }, destroy: bag.dispose };
}

export default {
  name: "flashlight",
  means: "A flashlight on a bare floor: point anywhere and it turns to light the spot, and finds nothing there.",
  rules: [1, 3, 5, 6],
  range: [16, 26, 34],
  tour: [[325, 150], [150, 240], null],
  mount,
};
