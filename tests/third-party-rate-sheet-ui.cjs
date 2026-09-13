/* Existing command now runs the current production React + global-CSS browser
 * regression. Synthetic only; all external requests rejected; no live account. */
require('./country-rate-matrix-ui.cjs').run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
