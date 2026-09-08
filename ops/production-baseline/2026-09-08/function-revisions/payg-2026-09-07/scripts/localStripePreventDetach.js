/* eslint-disable require-jsdoc */

// Firebase CLI deliberately starts downloadable emulators in fresh process
// groups. For this private local harness, keep those descendants in the
// supervisor's stable group so one group signal always reaches them. The
// marker is removed before Firebase constructs child environments, so this
// patch does not propagate into the emulated Functions runtime.

if (process.env.LOCAL_STRIPE_ATTACH_DESCENDANTS_ACTIVE === "true") {
  delete process.env.LOCAL_STRIPE_ATTACH_DESCENDANTS_ACTIVE;
  const childProcess = require("node:child_process");
  const originalSpawn = childProcess.spawn;
  childProcess.spawn = function attachedSpawn(command, args, options) {
    if (args && !Array.isArray(args) && typeof args === "object") {
      return originalSpawn.call(this, command, {
        ...args,
        detached: false,
      });
    }
    return originalSpawn.call(this, command, args, {
      ...(options || {}),
      detached: false,
    });
  };
}
