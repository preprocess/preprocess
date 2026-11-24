// @ts-nocheck
// Empty-state figure: tincans.
// Vendored from @lucasmarkes/hairline (MIT, see ./LICENSE). Drawn with the
// hairline-create skill; edit the figure here, not a generated copy.
import { HL } from "./kernel";

/**
 * Tin cans: two tin-can telephones lying apart on the ground, their closed
 * ends turned to each other and joined by a slack string that curls along the
 * ground between them. As the pointer comes along the string it lifts toward
 * taut and the cans tip up to it; nothing comes through. The slider is how
 * much of the slack the pointer can take up, in percent.
 *
 * The pattern: one continuous answer. A spring follows the pointer's distance
 * from where the string's middle rests, a fixed point, so the lifting string
 * never moves the hit out from under the pointer.
 */
const {
  Cam,
  clamp,
  fit,
  hull,
  lerp,
  open,
  poly,
  proj,
  rad,
  unproj,
  spring,
  stepS,
  disposer,
  mk,
  place,
  pointer,
  register,
} = HL;

const RC = 12,
  LC = 31,
  RIM = 1.3,
  RIBS = [9, 13.5, 18, 22.5],
  N = 40,
  SAG = 20,
  BOW = 14,
  LEAN = 15,
  NEAR = 30,
  REACH = 200;

/** Height that bends smoothly onto the ground instead of passing under it. */
const ground = (z) => 0.3 + 0.5 * (z + Math.hypot(z, 4));
const dot3 = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
const area = (pts) =>
  pts.reduce((s, p, k) => {
    const q = pts[(k + 1) % pts.length];
    return s + p[0] * q[1] - q[0] * p[1];
  }, 0);
/** A closed outline wound against `like`, so the two in one path cut a hole. */
const against = (pts, like) =>
  Math.sign(area(pts)) === Math.sign(area(like)) ? pts.slice().reverse() : pts;

/** A can's axis frame: `a` runs from the mouth to the closed end, tipped up by phi; e1, e2 span its rings. */
function frame(yaw, phi) {
  const y = rad(yaw),
    p = rad(phi),
    cy = Math.cos(y),
    sy = Math.sin(y),
    cp = Math.cos(p),
    sp = Math.sin(p);
  return {
    a: [cy * cp, sy * cp, sp],
    e1: [-sy, cy, 0],
    e2: [-cy * sp, -sy * sp, cp],
  };
}
/** The ring of the can at u along its axis, radius r: world points with their outward normals. */
function ring(m, f, u, r) {
  const out = [];
  for (let k = 0; k < N; k++) {
    const t = (2 * Math.PI * k) / N,
      c = Math.cos(t),
      s = Math.sin(t);
    const n = [
      c * f.e1[0] + s * f.e2[0],
      c * f.e1[1] + s * f.e2[1],
      c * f.e1[2] + s * f.e2[2],
    ];
    out.push({
      p: [
        m[0] + f.a[0] * u + r * n[0],
        m[1] + f.a[1] * u + r * n[1],
        m[2] + f.a[2] * u + r * n[2],
      ],
      n,
    });
  }
  return out;
}
/** The one cyclic run of a ring whose normals pass keep. */
function arc(rg, keep) {
  const k0 = rg.findIndex((q, k) => keep(q) && !keep(rg[(k + N - 1) % N]));
  if (k0 < 0) return [];
  const out = [];
  for (let k = 0; k < N && keep(rg[(k0 + k) % N]); k++)
    out.push(rg[(k0 + k) % N]);
  return out;
}

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let most = value;

  // the two cans: where the mouth rests, the axis's heading, and how far each tips up when lifted
  const cans = [
    { m: [0, 0, RC], yaw: 7, tip: 0.8 },
    { m: [146, 20, RC], yaw: 171, tip: 1 },
  ];
  const end = (c, L) => {
    const f = frame(c.yaw, LEAN * c.tip * L);
    return [c.m[0] + f.a[0] * LC, c.m[1] + f.a[1] * LC, c.m[2] + f.a[2] * LC];
  };

  /** The string at lift L, from the first can's closed end to the second's: slack along the ground at 0. */
  function line(L) {
    const A = end(cans[0], L),
      B = end(cans[1], L),
      dx = B[0] - A[0],
      dy = B[1] - A[1],
      d = Math.hypot(dx, dy);
    const sag = lerp(SAG, 1.2, L),
      bow = BOW * (1 - L),
      pts = [];
    for (let k = 0; k <= 48; k++) {
      const t = k / 48,
        s = -(Math.sin(Math.PI * t) ** 1.4) * (0.6 + 0.8 * t);
      pts.push([
        lerp(A[0], B[0], t) - (dy / d) * bow * s,
        lerp(A[1], B[1], t) + (dx / d) * bow * s,
        ground(lerp(A[2], B[2], t) - sag * 4 * t * (1 - t)),
      ]);
    }
    return pts;
  }

  const C = Cam(45, 0.5, 2.45);
  const ext = [];
  for (const c of cans)
    for (const L of [0, 1])
      for (const u of [0, LC])
        ring(c.m, frame(c.yaw, LEAN * c.tip * L), u, RC).forEach((q) =>
          ext.push(q.p),
        );
  fit(C, ext.concat(line(0)), 200, 168);
  const P = proj(C);
  const g0 = unproj(C, 200, 160, 0),
    g1 = unproj(C, 200, 160, 10),
    TC = [g1[0] - g0[0], g1[1] - g0[1], 10];
  const front = (q) => dot3(q.n, TC) > 0,
    back = (q) => !front(q);
  const pr = (rg) => rg.map((q) => P(...q.p));

  const g = mk("g", {}, svg);

  // each can is built once, in paint order; which end faces us never changes
  function build(c) {
    const f0 = frame(c.yaw, 0),
      mouthOut = dot3(f0.a, TC) < 0,
      el = {};
    if (mouthOut) {
      // inside, painted first: the bare closed end and the ribs on the far wall, seen only through the mouth
      el.floor = mk("path", { class: "nf lo" }, g);
      el.inRibs = mk("path", { class: "nf lo" }, g);
      el.knot = mk("circle", { r: 1, class: "dot off" }, g);
    }
    el.shell = mk("path", { class: "sil hi" }, g);
    el.ribs = mk("path", { class: "nf lo" }, g);
    if (!mouthOut) el.lid = mk("path", { class: "nf lo" }, g);
    return (L) => {
      const f = frame(c.yaw, LEAN * c.tip * L),
        m = c.m;
      const sh = hull(pr(ring(m, f, 0, RC)).concat(pr(ring(m, f, LC, RC))));
      el.ribs.setAttribute(
        "d",
        RIBS.map((u) => open(pr(arc(ring(m, f, u, RC), front)))).join(""),
      );
      if (mouthOut) {
        const r = RC - RIM;
        el.floor.setAttribute("d", poly(pr(ring(m, f, LC - 1, r))));
        el.inRibs.setAttribute(
          "d",
          RIBS.map((u) => open(pr(arc(ring(m, f, u, r), back)))).join(""),
        );
        place(
          el.knot,
          P(
            m[0] + f.a[0] * (LC - 1),
            m[1] + f.a[1] * (LC - 1),
            m[2] + f.a[2] * (LC - 1),
          ),
        );
        el.shell.setAttribute(
          "d",
          poly(sh) + poly(against(pr(ring(m, f, 0, r)), sh)),
        );
      } else {
        el.shell.setAttribute("d", poly(sh));
        el.lid.setAttribute("d", poly(pr(ring(m, f, LC, RC - RIM))));
      }
    };
  }

  // far can, then the string out of its closed end (lit with the cans), then the near can over the string's other end
  const drawA = build(cans[0]);
  const str = mk("path", { class: "nf hi" }, g);
  const drawB = build(cans[1]);

  let drawn = NaN;
  function draw(L) {
    if (Math.abs(L - drawn) < 0.001) return;
    drawn = L;
    drawA(L);
    drawB(L);
    str.setAttribute("d", open(line(L).map((p) => P(...p))));
  }

  const sp = spring(0);
  draw(0);
  const B = register(stage, (dt) => {
    const moving = stepS(sp, dt);
    draw(clamp(sp.x, 0, 1));
    return moving;
  });
  bag.add(B.unregister);

  // the hit: distance from where the string's middle rests, stretched along the string; none of it moves
  const rest = line(0),
    anchor = P(...rest[24]),
    a0 = P(...rest[0]),
    a1 = P(...rest[48]);
  const ux = a1[0] - a0[0],
    uy = a1[1] - a0[1],
    ul = Math.hypot(ux, uy);
  function aim(t) {
    sp.t = (t * most) / 100;
    read.textContent = t > 0.5 ? "line · 0" : "rest";
    B.wake();
  }
  bag.add(
    pointer(stage, {
      move: ([x, y]) => {
        const dx = x - anchor[0],
          dy = y - anchor[1],
          along = (dx * ux + dy * uy) / ul,
          across = (dy * ux - dx * uy) / ul;
        const t = clamp(
          (REACH - Math.hypot(along * 0.55, across)) / (REACH - NEAR),
          0,
          1,
        );
        aim(t * t * (3 - 2 * t));
      },
      leave: () => aim(0),
    }),
  );
  bag.add(() => svg.replaceChildren());

  return {
    set: (v) => {
      most = v;
      aim(0);
    },
    destroy: bag.dispose,
  };
}

export default {
  name: "tincans",
  means:
    "Two tin-can phones on a slack string: bring the pointer along it and the line lifts taut, but nothing comes through.",
  rules: [1, 3, 5, 8],
  range: [50, 80, 100],
  tour: [[196, 197], [150, 150], null],
  mount,
};
