// @ts-nocheck
// Empty-state figure: robot.
// Vendored from @lucasmarkes/hairline (MIT, see ./LICENSE). Drawn with the
// hairline-create skill; edit the figure here, not a generated copy.
import { HL } from "./kernel";

/**
 * Windup: a small robot standing idle, nothing to do yet. As the pointer
 * moves, its head turns a little to look toward it; the body never moves.
 * The slider is how far the head may turn, in degrees.
 *
 * The pattern: one continuous answer. A spring follows the pointer's x
 * against a fixed anchor, the head's resting centre, so the turning head can
 * never move the hit out from under the pointer.
 */
const {
  Cam,
  circ,
  clamp,
  facing,
  fit,
  hull,
  open,
  poly,
  proj,
  rad,
  rrect,
  run,
  disposer,
  mk,
  place,
  pointer,
  register,
  spring,
  stepS,
  solid,
} = HL;

// body and head footprints (x across, y front to back, the face on +y), the turn toward the viewer, and the head's resting yaw
const BZ0 = 3,
  BZ1 = 27,
  HZ0 = 28,
  HZ1 = 49,
  HW = 13,
  HD = 11.5,
  HR = 7,
  TURN = 36,
  TILT = 2.5,
  REST = -6,
  NEAR = 30,
  REACH = 240,
  SPAN = 120;

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let most = value;

  const S = 4.9,
    C = Cam(45, 0.5, S);
  const rot = (x, y, a) => {
    const c = Math.cos(rad(a)),
      s = Math.sin(rad(a));
    return [x * c + y * s, y * c - x * s];
  };
  const W = (x, y, z) => [...rot(x, y, TURN), z];
  // the head: yawed about its own upright axis, with a slight roll on the neck
  const tc = Math.cos(rad(TILT)),
    ts = Math.sin(rad(TILT));
  const headAt = (yaw) => (x, y, z) => {
    const [u, v] = rot(x * tc - (z - HZ0) * ts, y, yaw);
    return W(u, v, HZ0 + x * ts + (z - HZ0) * tc);
  };
  const box = [];
  for (const x of [-HW, HW]) for (const y of [-HD, HD]) box.push(W(x, y, 0));
  for (const yaw of [-40, 40])
    for (const x of [-HW, HW])
      for (const y of [-HD, HD]) box.push(headAt(yaw)(x, y, HZ1));
  fit(C, box.concat([W(0, -1, HZ1 + 10)]), 200, 166);
  const P0 = proj(C),
    F0 = facing(C);
  const P = (x, y, z) => P0(...W(x, y, z));
  const turned = (a) => (q) => {
    const [nu, nv] = rot(q.nu, q.nv, a);
    return F0({ ...q, nu, nv });
  };
  const g = mk("g", {}, svg);

  /** A soft block: rounded in plan, its top and foot rolled over by bev. Writes its silhouette and top crease into s. */
  function pillow(s, pr, front, x0, y0, x1, y1, r, z0, z1, bev) {
    const pts = [],
      n = 5;
    for (let k = 0; k <= n; k++) {
      const a = rad((90 * k) / n),
        i = bev * (1 - Math.sin(a)),
        dz = bev * (1 - Math.cos(a));
      const ring = rrect(
        x0 + i,
        y0 + i,
        x1 - i,
        y1 - i,
        Math.max(r - i, 0.5),
        10,
      );
      for (const z of [z0 + dz, z1 - dz])
        for (const q of ring) pts.push(pr(q.u, q.v, z));
    }
    const lid = rrect(
      x0 + bev,
      y0 + bev,
      x1 - bev,
      y1 - bev,
      Math.max(r - bev, 0.5),
      10,
    );
    s.sil.setAttribute("d", poly(hull(pts)));
    s.cr.setAttribute("d", open(run(lid, front).map((q) => pr(q.u, q.v, z1))));
    return s;
  }
  /** A short arm: the hull of two balls, shoulder and hand. */
  const nub = (a, b, r) => {
    const ring = circ(r * S, 16),
      pa = P(...a),
      pb = P(...b);
    return poly(
      hull(
        ring
          .map((q) => [pa[0] + q.u, pa[1] + q.v])
          .concat(ring.map((q) => [pb[0] + q.u, pb[1] + q.v])),
      ),
    );
  };

  // two feet, held quieter than the robot
  for (const x of [-9, 2])
    pillow(
      solid(g),
      P,
      turned(TURN),
      x,
      -6,
      x + 7,
      8,
      3,
      0,
      BZ0 + 1,
      1.4,
    ).sil.classList.remove("sil");
  // the far arm, the body, the near arm: both arms hang straight down
  mk(
    "path",
    { d: nub([-11.5, 0, 22], [-12.5, 0.5, 16], 2.8), class: "sil hi" },
    g,
  );
  pillow(
    solid(g),
    P,
    turned(TURN),
    -11,
    -9,
    11,
    9,
    6,
    BZ0,
    BZ1,
    3,
  ).sil.classList.add("hi");
  mk(
    "path",
    { d: nub([11.5, 0, 22], [12.5, 0.5, 16], 2.8), class: "sil hi" },
    g,
  );

  // the head, its antenna with a ball, and two round eyes: redrawn as it turns
  const head = solid(g);
  head.sil.classList.add("hi");
  const stalk = mk("path", { class: "nf hi" }, g),
    ball = mk("path", { class: "sil hi" }, g);
  const eyes = [-5, 5].map(() =>
    mk("circle", { r: 1.25 * S, class: "dot" }, g),
  );

  let drawn = NaN;
  function draw(yaw) {
    if (Math.abs(yaw - drawn) < 0.05) return;
    drawn = yaw;
    const H = headAt(yaw),
      Q = (x, y, z) => P0(...H(x, y, z));
    pillow(head, Q, turned(TURN + yaw), -HW, -HD, HW, HD, HR, HZ0, HZ1, 4);
    stalk.setAttribute("d", open([Q(0, -1.5, HZ1), Q(0, -1.5, HZ1 + 6)]));
    const tip = Q(0, -1.5, HZ1 + 8);
    ball.setAttribute(
      "d",
      poly(circ(2.2 * S, 20).map((q) => [tip[0] + q.u, tip[1] + q.v])),
    );
    eyes.forEach((e, k) => place(e, Q(k ? 5 : -5, HD + 0.2, 39)));
  }

  const sp = spring(REST);
  draw(REST);
  const B = register(stage, (dt) => {
    const moving = stepS(sp, dt);
    draw(sp.x);
    return moving;
  });
  bag.add(B.unregister);

  // the hit: the pointer against where the head's centre rests, which never moves
  const anchor = P(0, 0, (HZ0 + HZ1) / 2);
  function aim(f, dx) {
    sp.t = REST + (most * clamp(dx / SPAN, -1, 1) - REST) * f;
    read.textContent = f > 0.3 ? "agents · 0" : "rest";
    B.wake();
  }
  bag.add(
    pointer(stage, {
      move: ([x, y]) => {
        const dx = x - anchor[0],
          d = Math.hypot(dx, y - anchor[1]);
        const t = clamp((REACH - d) / (REACH - NEAR), 0, 1);
        aim(Math.min(1, 1.6 * t * t * (3 - 2 * t)), dx);
      },
      leave: () => aim(0, 0),
    }),
  );
  bag.add(() => svg.replaceChildren());

  return {
    set: (v) => {
      most = v;
      aim(0, 0);
    },
    destroy: bag.dispose,
  };
}

export default {
  name: "robot",
  means:
    "A small robot standing idle with no work yet: move the pointer and its head turns to look, but nothing starts.",
  rules: [1, 3, 5, 8],
  range: [12, 25, 35],
  tour: [[320, 140], [90, 180], null],
  mount,
};
