import { runMode } from "@preprocess/runmode";
import { env } from "cloudflare:workers";

/** Sign-up is open on our cloud; a self-hosted install joins by invitation. */
export const signUpIsOpen = () => runMode(env).kind === "cloud";

/** Google sign-in shows only where the install configured it. */
export const googleSignIn = () => Boolean(env.GOOGLE_CLIENT_ID);

/** The docs site the app links to, when the install has one. */
export const docsUrl = () => env.DOCS_URL ?? null;
