// @ts-nocheck
// Empty-state figure: mailbox.
// Vendored from @lucasmarkes/hairline (MIT, see ./LICENSE). Drawn with the
// hairline-create skill; edit the figure here, not a generated copy.
import { HL } from "./kernel";

/**
 * Mailbox: a curbside mailbox on its post, flag down, door a little ajar. As
 * the pointer nears, the door drops open on its bottom hinge and shows the
 * bare ribbed floor inside. The slider is how far the door can open, in
 * degrees.
 *
 * The pattern: one continuous answer. A spring follows the pointer's distance
 * from the door's resting centre, a fixed point, so the opening door can never
 * move the hit out from under the pointer.
 */
const { Cam, clamp, facing, fillet, fit, hull, open, poly, prism, proj, put, rad, rings, seg, solid, spring, stepS, disposer, mk, place, pointer, register } = HL;

const L = 70, W = 34, Z0 = 40, H = 13, R = W / 2, T = 1.6, D = 1.8, REST = 16, NEAR = 36, REACH = 170;

/** The end profile, in (y, height above the floor), inset by i: rounded foot corners, straight walls, an arched roof. */
function profile(i) {
  const pts = [], rb = 3, arc = (cy, cz, r, a0, a1, n) => {
    for (let k = 0; k <= n; k++) { const a = rad(a0 + ((a1 - a0) * k) / n); pts.push([cy + r * Math.cos(a), cz + r * Math.sin(a)]); }
  };
  arc(W - i - rb, i + rb, rb, -90, 0, 3);
  arc(R, H, R - i, 0, 180, 16);
  arc(i + rb, i + rb, rb, 180, 270, 3);
  return pts;
}

const area = (pts) => pts.reduce((s, p, k) => { const q = pts[(k + 1) % pts.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0);
/** A closed outline wound against `like`, so the two in one path cut a hole. */
const against = (pts, like) => (Math.sign(area(pts)) === Math.sign(area(like)) ? pts.slice().reverse() : pts);

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let most = value;

  const C = Cam(45, 0.5, 2.6);
  fit(C, [[24, 6, 0], [46, 28, 0], [0, 0, Z0 + H + R], [L, W, Z0 + H + R], [L + H + R, W, Z0], [0, W, Z0], [L, 0, Z0]], 200, 170);
  const P = proj(C), front = facing(C);
  const outer = profile(0), inner = profile(T);
  const at = (x) => (q) => P(x, q[0], Z0 + q[1]);

  const g = mk("g", {}, svg);

  // a concrete footing, and the post standing in it
  const [fr, fi] = rings(24, 6, 46, 28, 4, 1.2);
  const foot = solid(g);
  put(foot, prism(P, front, fr, fi, 0, 4));
  const [pr, pi] = rings(30, 12, 40, 22, 1.5, 0.8);
  const post = solid(g);
  put(post, prism(P, front, pr, pi, 4, Z0));
  // the footing and post hold it up: drawn quieter than the box
  for (const s of [foot, post]) s.sil.classList.remove("sil");

  // inside, painted first: the back wall and the bare ribbed floor, seen only through the opening
  const back = inner.map(at(T)), lip = inner.map(at(L));
  mk("path", { d: poly(back), class: "nf lo" }, g);
  const ribs = [W * 0.3, W * 0.5, W * 0.7].map((y) => seg(P(T + 4, y, Z0 + T), P(L - 2, y, Z0 + T))).join("");
  mk("path", { d: ribs + seg(back[4], lip[4]) + seg(back[back.length - 1], lip[lip.length - 1]), class: "nf lo" }, g);

  // the body, lit whole with its door and flag: one plate from both end profiles, with the opening cut through its near end
  const shell = hull(outer.map(at(0)).concat(outer.map(at(L))));
  mk("path", { d: poly(shell) + poly(against(lip, shell)), class: "sil hi" }, g);
  mk("path", { d: seg(P(3, W, Z0 + H), P(L - 1, W, Z0 + H)), class: "nf lo" }, g);

  // the flag, folded down along the near side
  const flag = fillet([[8, 11], [30, 11], [30, 8.5], [41, 8.5], [41, 17.5], [30, 17.5], [30, 13.6], [8, 13.6]], [1.2, 0.6, 1.6, 1.6, 1.6, 1.6, 0.6, 1.2]);
  const onSide = (y) => (p) => P(p[0], y, Z0 + p[1]);
  mk("path", { d: poly(flag.map(onSide(W + 0.6))), class: "lo" }, g);
  mk("path", { d: poly(flag.map(onSide(W + 1.8))), class: "sil hi" }, g);
  place(mk("circle", { r: 1.1, class: "dot m" }, g), P(11, W + 1.8, Z0 + 12.3));

  // the door, hinged along its foot: its inner edge, its face, and the latch tab at its top
  const dBack = mk("path", { class: "lo" }, g), dFace = mk("path", { class: "sil hi" }, g), dTab = mk("path", { class: "nf" }, g);
  const tab = fillet([[R - 4, H + R - 7], [R + 4, H + R - 7], [R + 4, H + R - 3.5], [R - 4, H + R - 3.5]], [1, 1, 1, 1]);
  let drawn = NaN;
  function draw(th) {
    if (Math.abs(th - drawn) < 0.01) return;
    drawn = th;
    const s = Math.sin(rad(th)), c = Math.cos(rad(th));
    const door = (off) => (q) => P(L + q[1] * s + off * c, q[0], Z0 + q[1] * c - off * s);
    dBack.setAttribute("d", poly(outer.map(door(0))));
    dFace.setAttribute("d", poly(outer.map(door(D))));
    dTab.setAttribute("d", poly(tab.map(door(D))));
  }

  const sp = spring(REST);
  draw(REST);
  const B = register(stage, (dt) => { const moving = stepS(sp, dt); draw(sp.x); return moving; });
  bag.add(B.unregister);

  // the hit: distance from where the door's centre rests, which never moves
  const anchor = P(L, R, Z0 + H);
  function aim(f) {
    sp.t = REST + (most - REST) * f;
    const on = f > 0.5;
    read.textContent = on ? "box · 0" : "rest";
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
  name: "mailbox",
  means: "A mailbox with its flag down: bring the pointer near and the door drops open on a bare floor.",
  rules: [1, 3, 5, 8],
  range: [55, 88, 112],
  tour: [[330, 230], [262, 170], null],
  mount,
};
