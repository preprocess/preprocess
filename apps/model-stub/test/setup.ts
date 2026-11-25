// Loads the Worker's module graph while files are collected, before any test
// runs. Otherwise the first request in each file pays for it inside that
// test's 5 s timeout, which a busy CI runner can exceed.
import "../src/index.ts";
