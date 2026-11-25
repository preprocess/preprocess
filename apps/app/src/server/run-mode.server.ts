import { runMode } from "@preprocess/runmode";
import { env } from "cloudflare:workers";

/** Sign-up is open on our cloud; a self-hosted install joins by invitation. */
export const signUpIsOpen = () => runMode(env).kind === "cloud";
