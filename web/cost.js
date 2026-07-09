"use strict";
// Pure route summary cost. Search ranking stays in router.js; this only displays estimates.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Cost = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const BRT = new Set(["FP", "FP2"]);
  const PREMIUM = new Set(["PP", "PP2", "PP3"]);

  function fareInfo(data, route) {
    return (data.fare && data.fare[route]) || [0, "?"];
  }

  function edgeSecs(data, route, from, to) {
    const byRoute = data.etime && data.etime[route];
    const byStop = byRoute && byRoute[from];
    return (byStop && byStop[to]) || 0;
  }

  function routeCost(path, data) {
    let secs = 0, fare = 0, brtPaid = false, prevStop = null, curRoute = null;
    for (const step of path) {
      if (step.kind === "take") {
        if (step.xtype === "w") brtPaid = false;
        const [price, klass] = fareInfo(data, step.route);
        if (BRT.has(klass)) {
          if (!brtPaid) {
            fare += price;
            brtPaid = true;
          }
        } else if (PREMIUM.has(klass)) {
          fare += price;
        }
        curRoute = step.route;
        prevStop = step.stop;
      } else if (step.kind === "ride") {
        const route = step.route == null ? curRoute : step.route;
        if (route != null && prevStop != null) secs += edgeSecs(data, route, prevStop, step.stop);
        curRoute = route;
        prevStop = step.stop;
      } else if (step.kind === "board") {
        prevStop = step.stop;
      }
    }
    return { secs, fare };
  }

  function fmtFare(n) {
    return n ? "Rp" + n.toLocaleString("id-ID") : "Gratis";
  }

  return { routeCost, fmtFare };
});
