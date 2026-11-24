// @ts-nocheck
// Empty-state figure: tag.
// Vendored from @lucasmarkes/hairline (MIT, see ./LICENSE). Drawn with the
// hairline-create skill; edit the figure here, not a generated copy.
import { HL } from "./kernel";

/**
 * Tag: a blank luggage tag on a string loop, hung from a peg on a small wall
 * plate. At rest it hangs turned a little, swung a touch to one side; the tag
 * is lit whole, its peg and plate quieter. As the pointer brushes it, the tag
 * swings away from the pointer and turns over on the string, showing that both
 * faces carry only empty ruled lines. The slider is how far it turns, in degrees.
 *
 * The pattern: one continuous answer, two springs. Both read the pointer's
 * offset from the tag's resting centre, a fixed point, so the turning tag can
 * never move the hit out from under the pointer.
 */
const {
  Cam,
  circ,
  clamp,
  fillet,
  fit,
  hull,
  open,
  poly,
  proj,
  rad,
  rrect,
  seg,
  spring,
  stepS,
  disposer,
  mk,
  place,
  pointer,
  register,
} = HL;

const PX = 22,
  PZ = 104,
  T = 2,
  PEG = 22,
  PR = 2.4,
  KR = 3.6;
const LS = 15,
  TOP = 9,
  TW = 18,
  TH = 56,
  CUT = 8,
  TK = 1.4,
  EYE = 2.2,
  RING = 4.6;
const YAW = -20,
  SWING = 5,
  SW = 16,
  NEAR = 34,
  REACH = 170;
const K = [PX, PEG - 5, PZ + PR];
const Q = Math.SQRT1_2,
  V = [0.61, 0.61, 0.5];

const area = (pts) =>
  pts.reduce((s, p, k) => {
    const q = pts[(k + 1) % pts.length];
    return s + p[0] * q[1] - q[0] * p[1];
  }, 0);
/** A closed outline wound against `like`, so the two in one path cut a hole. */
const against = (pts, like) =>
  Math.sign(area(pts)) === Math.sign(area(like)) ? pts.slice().reverse() : pts;

/** The tag's outline in its own plane (u across, v down from the peg): clipped top corners, a long blank body. */
const OUT = fillet(
  [
    [-TW + CUT, TOP],
    [TW - CUT, TOP],
    [TW, TOP + CUT],
    [TW, TOP + TH],
    [-TW, TOP + TH],
    [-TW, TOP + CUT],
  ],
  [2, 2, 2.4, 3.4, 3.4, 2.4],
);
const ringPts = (r, n) => circ(r, n).map((q) => [q.u, LS + q.v]);
const HOLE = against(ringPts(EYE, 16), OUT),
  RINGP = ringPts(RING, 20);
/** The empty fields: a short one for the name, then the long lines. */
const LINES = [
  [TOP + 22, 4],
  [TOP + 30, TW - 5],
  [TOP + 38, TW - 5],
  [TOP + 46, TW - 5],
];

/** A turned, swung frame: (u, v, n) in the tag's plane to a world point. It turns `yaw` about the vertical through the peg, then swings `sw` in the picture plane. */
function frame(yaw, sw) {
  const cy = Math.cos(rad(yaw)),
    sy = Math.sin(rad(yaw)),
    c = Math.cos(rad(sw)),
    s = Math.sin(rad(sw));
  const rot = (p) => {
    const d = Q * p[0] + Q * p[1];
    return [
      p[0] * c + Q * p[2] * s + Q * d * (1 - c),
      p[1] * c - Q * p[2] * s + Q * d * (1 - c),
      p[2] * c + (Q * p[1] - Q * p[0]) * s,
    ];
  };
  const nrm = rot([-sy, cy, 0]);
  const W = (u, v, n) => {
    const p = rot([u * cy - n * sy, u * sy + n * cy, -v]);
    return [K[0] + p[0], K[1] + p[1], K[2] + p[2]];
  };
  const dot = nrm[0] * V[0] + nrm[1] * V[1] + nrm[2] * V[2];
  return { W, facing: dot >= 0, open: Math.abs(dot) / VN };
}

/** The turn to rest on: never within EDGE of edge-on, where the tag would read as a sliver; the spring still sweeps through. */
const EDGE = Math.sin(rad(20)),
  VN = Math.hypot(...V);
function settle(yaw, sw) {
  if (frame(yaw, sw).open >= EDGE) return yaw;
  for (let d = 1; d < 90; d++)
    for (const y of [yaw - d, yaw + d]) if (frame(y, sw).open >= EDGE) return y;
  return yaw;
}

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let most = value;

  // fitted to every turn and swing the tag can reach, so nothing leaves the frame
  const C = Cam(45, 0.5, 3.35);
  const reach = [
    [PX - 12, 0, PZ + 16],
    [PX + 12, 0, PZ + 16],
    [PX - 12, 0, PZ - 14],
  ];
  for (let y = YAW; y <= YAW + 220; y += 20)
    for (const s of [-SW, SWING, SW]) {
      const f = frame(y, s);
      for (const p of OUT) reach.push(f.W(p[0], p[1], 0));
    }
  fit(C, reach, 200, 162);
  const P = proj(C);
  const g = mk("g", {}, svg);

  // the wall plate, a thin rounded plaque with two screws; it and the peg hold the tag, drawn quieter
  const plaque = rrect(PX - 11, PZ - 14, PX + 11, PZ + 16, 5, 5);
  const onWall = (y) => (q) => P(q.u, y, q.v);
  mk("path", { d: poly(plaque.map(onWall(0))), class: "lo" }, g);
  mk("path", { d: poly(plaque.map(onWall(T))) }, g);
  for (const z of [PZ + 10, PZ - 8])
    place(mk("circle", { r: 1, class: "dot off" }, g), P(PX, T, z));

  // the peg: a round shaft out of the plate, and a knob on its end
  const disc = (r, y) => circ(r, 16).map((q) => P(PX + q.u, y, PZ + q.v));
  mk("path", { d: poly(hull(disc(PR, T).concat(disc(PR, PEG - 3)))) }, g);
  // the string loop over the shaft, behind the knob and the tag: it shows above the tag's top and through the eyelet
  const loop = mk("path", { class: "nf" }, g);
  mk("path", { d: poly(hull(disc(KR, PEG - 3).concat(disc(KR, PEG)))) }, g);
  mk("path", { d: poly(disc(KR - 0.8, PEG)), class: "nf lo" }, g);
  // the tag, lit whole: its far face (the thickness edge), its near face, and the eyelet ring
  const farP = mk("path", { class: "lo" }, g),
    nearP = mk("path", { class: "sil hi" }, g);
  const rules = mk("path", { class: "nf lo" }, g),
    ring = mk("path", { class: "nf hi" }, g);

  let dy = NaN,
    ds = NaN;
  function draw(yaw, sw) {
    if (Math.abs(yaw - dy) < 0.01 && Math.abs(sw - ds) < 0.01) return;
    dy = yaw;
    ds = sw;
    const { W, facing } = frame(yaw, sw),
      h = facing ? TK / 2 : -TK / 2;
    const plate = (n) =>
      poly(OUT.map((p) => P(...W(p[0], p[1], n)))) +
      poly(HOLE.map((p) => P(...W(p[0], p[1], n))));
    farP.setAttribute("d", plate(-h));
    nearP.setAttribute("d", plate(h));
    const a = P(...W(-1.4, LS - EYE + 0.4, 0)),
      b = P(...W(1.4, LS - EYE + 0.4, 0));
    loop.setAttribute(
      "d",
      open([
        a,
        P(K[0] - 1.2, K[1] + 0.6, K[2]),
        P(K[0] + 1.2, K[1] - 0.6, K[2]),
        b,
      ]),
    );
    rules.setAttribute(
      "d",
      LINES.map(([v, u1]) =>
        seg(P(...W(-TW + 5, v, h)), P(...W(u1, v, h))),
      ).join(""),
    );
    ring.setAttribute("d", poly(RINGP.map((p) => P(...W(p[0], p[1], h)))));
  }

  const turn = spring(YAW),
    sway = spring(SWING);
  draw(YAW, SWING);
  const B = register(stage, (dt) => {
    const m1 = stepS(turn, dt),
      m2 = stepS(sway, dt);
    draw(turn.x, sway.x);
    return m1 || m2;
  });
  bag.add(B.unregister);

  // the hit: the pointer against where the tag's middle rests, which never moves
  const anchor = P(...frame(YAW, SWING).W(0, TOP + TH / 2, 0));
  function aim(f, side) {
    sway.t = SWING + SW * side * f;
    turn.t = settle(YAW + most * f, sway.t);
    const on = f > 0.5;
    read.textContent = on ? "lines · 0" : "rest";
    B.wake();
  }
  bag.add(
    pointer(stage, {
      move: ([x, y]) => {
        const d = Math.hypot(x - anchor[0], y - anchor[1]),
          t = clamp((REACH - d) / (REACH - NEAR), 0, 1);
        aim(t * t * (3 - 2 * t), clamp((x - anchor[0]) / 60, -1, 1));
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
  name: "tag",
  means:
    "A blank luggage tag on a peg: brush it and it swings and turns over, both faces still empty.",
  rules: [1, 3, 5, 8],
  range: [120, 160, 200],
  tour: [[250, 190], [180, 170], null],
  mount,
};
