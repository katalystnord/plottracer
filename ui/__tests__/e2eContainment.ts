/**
 * WHERE AN e2e's WINDOWS GO - the one place that decides it.
 *
 * David works on ONE machine. A run that takes over the screen stops him
 * working AND pins the CPU while it does it, so containment is a hard
 * requirement, not a courtesy - and a run that is going to land on his screen
 * should REFUSE before it costs him anything, rather than discover it visually.
 *
 * ⚑ THE ARGUMENT, not an env hint. Three things look like they should contain
 * an Electron app on this machine and DO NOT (all measured 2026-07-27):
 *   - `xvfb-run` alone - Ozone prefers Wayland and ignores DISPLAY;
 *   - unsetting WAYLAND_DISPLAY - Ozone finds the socket via XDG_RUNTIME_DIR;
 *   - ELECTRON_OZONE_PLATFORM_HINT=x11, and `app.commandLine.appendSwitch(
 *     'ozone-platform', …)` inside the entry - both applied AFTER the platform
 *     is chosen.
 * Only `--ozone-platform=x11` as a LAUNCH ARGUMENT works, which is why this
 * returns args rather than setting anything.
 *
 * ⚑⚑ WHY IT REFUSES, AND WHY THAT IS THE WHOLE POINT (2026-08-17). This gate
 * used to be three identical copies - `workspace.e2e`, `electronMain.e2e` and
 * `spiderShot.e2e` each wrote it out - and every copy treated an ABSENT
 * variable as "fine, launch anyway". So the contained path was the OPT-IN and
 * the developer's real screen was the DEFAULT: forgetting the variable was not
 * an error, it was normal operation. It cost David exactly that, the morning
 * this was written - a suite run that excluded `workspace.e2e.test.ts` by name
 * still launched `electronMain.e2e.test.ts` onto his desktop, because the
 * runner remembered one GUI file out of three and the harness had no opinion.
 * The standing order is headless-by-default and his screen by explicit request;
 * this makes the code say that instead of the operator having to remember it.
 *
 * ⚠️ WHAT THIS DOES **NOT** PROVE. `PLOTTRACER_OZONE_PLATFORM=x11` with
 * `DISPLAY=:0` still lands on his real screen through Xwayland, and nothing
 * here can tell a virtual display from a real one - `:99` is a convention, not
 * a fact the harness can check. So this guard catches the FORGOTTEN case, which
 * is the one that actually happens; it is not a containment proof. The proof is
 * still positive evidence, counted on the display itself:
 *
 *     DISPLAY=:99 xwininfo -root -children | grep -c '^     0x'
 *
 * ⚑ The recipe this expects:
 *
 *     ls /tmp/.X11-unix/X99 >/dev/null 2>&1 || {
 *       rm -f /tmp/.X99-lock
 *       nohup Xvfb :99 -screen 0 1600x1000x24 >/tmp/xvfb99.log 2>&1 &
 *     }
 *     env -u WAYLAND_DISPLAY DISPLAY=:99 PLOTTRACER_OZONE_PLATFORM=x11 npx vitest run
 */

/** Set this to launch on the real screen deliberately - the exception the
 * standing order allows for, made explicit so it cannot happen by omission. */
const REAL_SCREEN_OPT_IN = 'PLOTTRACER_REAL_SCREEN';

/** The platform passed as `--ozone-platform=…`. Its presence is what the
 * headless recipe declares; `x11` is the only value that has ever worked here. */
const PLATFORM_VAR = 'PLOTTRACER_OZONE_PLATFORM';

const REFUSAL = [
  `This e2e launches a real Electron window and neither ${PLATFORM_VAR} nor`,
  `${REAL_SCREEN_OPT_IN} is set, so it would take over the developer's screen`,
  'and his CPU. Run it headless:',
  '',
  '  ls /tmp/.X11-unix/X99 >/dev/null 2>&1 || {',
  '    rm -f /tmp/.X99-lock',
  '    nohup Xvfb :99 -screen 0 1600x1000x24 >/tmp/xvfb99.log 2>&1 &',
  '  }',
  `  env -u WAYLAND_DISPLAY DISPLAY=:99 ${PLATFORM_VAR}=x11 npx vitest run`,
  '',
  `…or set ${REAL_SCREEN_OPT_IN}=1 to use the real screen on purpose.`,
].join('\n');

/**
 * The launch arguments that place this run's windows somewhere deliberate.
 *
 * @throws if neither containment nor the real-screen opt-in has been declared -
 * before the app starts, so nothing is drawn and no CPU is spent.
 */
export function ozoneArgs(env: NodeJS.ProcessEnv = process.env): string[] {
  const platform = env[PLATFORM_VAR];
  if (platform) return [`--ozone-platform=${platform}`];
  if (env[REAL_SCREEN_OPT_IN] === '1') return [];
  throw new Error(REFUSAL);
}
