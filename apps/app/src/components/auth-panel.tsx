import {
  BadgeCheck,
  Coins,
  Cog,
  Scale,
  Server,
  ShoppingCart,
  TrendingUp,
  Users,
} from "@preprocess/ui/lib/icons";
import { spring } from "@preprocess/ui/lib/springs";
import { motion, useReducedMotion } from "motion/react";

const TEAMS = [
  Cog,
  Coins,
  ShoppingCart,
  BadgeCheck,
  Scale,
  TrendingUp,
  Users,
  Server,
];

const STEPS = [
  { label: "Extract parties and terms", detail: "2m", state: "done" },
  { label: "Verify against your rules", detail: "14/14", state: "done" },
  { label: "Finance approval", detail: "Waiting", state: "waiting" },
  { label: "Post to your systems", detail: "", state: "todo" },
] as const;

/** Where the dial points, in degrees from the top: the bead and the knob's dot. */
const SETTING = 25;
/** How far back the arc starts before it sweeps up to the setting. */
const SWEEP = 40;

/**
 * The art beside the sign-in, sign-up and invitation forms: the teams the
 * agents work with, a case working through its steps, and the dial. Purely
 * decorative, so it is hidden from assistive technology.
 */
export function AuthPanel() {
  const reduced = useReducedMotion();
  const enter = (delay: number) => ({ ...spring.slow, delay });

  return (
    <div aria-hidden className="pp-panel">
      <div className="pp-stage">
        <b className="pp-rings" />
        <div className="pp-dial">
          <b className="pp-track" />
          <motion.b
            animate={{ rotate: 0, opacity: 1 }}
            className="pp-sweep"
            initial={reduced ? false : { rotate: -SWEEP, opacity: 0 }}
            transition={enter(0.2)}
          >
            <b className="pp-arc" />
            <b className="pp-bead" style={{ rotate: `${SETTING}deg` }} />
          </motion.b>
          <motion.b
            animate={{ rotate: SETTING }}
            className="pp-knob"
            initial={reduced ? false : { rotate: SETTING - SWEEP }}
            transition={enter(0.2)}
          />
        </div>

        <div className="pp-team">
          <div className="pp-faces">
            {TEAMS.map((Icon, index) => (
              <motion.b
                key={index}
                animate={{ opacity: 1, x: 0 }}
                className="pp-face"
                initial={reduced ? false : { opacity: 0, x: -8 }}
                transition={enter(index * 0.03)}
              >
                <Icon />
              </motion.b>
            ))}
            <motion.b
              animate={{ opacity: 1, scale: 1 }}
              className="pp-face pp-agent"
              initial={reduced ? false : { opacity: 0, scale: 0.6 }}
              transition={enter(TEAMS.length * 0.03)}
            />
          </div>
          <p>
            Where every team in your org
            <br />
            automates complex work.
          </p>
        </div>

        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="pp-card"
          initial={reduced ? false : { opacity: 0, y: 12 }}
          transition={enter(0.1)}
        >
          <div className="pp-card-head">
            <span className="pp-card-title">Supplier onboarding pack</span>
            <span className="pp-pill">Running</span>
          </div>
          {STEPS.map((step, index) => (
            <motion.div
              key={step.label}
              animate={{ opacity: 1 }}
              className="pp-step"
              data-state={step.state}
              initial={reduced ? false : { opacity: 0 }}
              transition={enter(0.15 + index * 0.06)}
            >
              <i />
              <span>{step.label}</span>
              <em>{step.detail}</em>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </div>
  );
}
