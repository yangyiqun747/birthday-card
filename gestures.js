'use strict';

// Pinch detection adapted from Uynaity/birthday-gesture-site (MIT, as stated in its README).
// https://github.com/Uynaity/birthday-gesture-site/blob/main/script.js
const BirthdayGestures = (() => {
  function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0));
  }

  function isStraight(points, base, joint, tip) {
    const a = distance(points[base], points[joint]);
    const b = distance(points[joint], points[tip]);
    return a + b > 0 && distance(points[base], points[tip]) / (a + b) > .9;
  }

  function classify(points) {
    if (!points || points.length < 21) return null;

    const palm = distance(points[0], points[9]);
    if (!palm) return null;

    const index = isStraight(points, 5, 6, 8);
    const middle = isStraight(points, 9, 10, 12);
    const ring = isStraight(points, 13, 14, 16);
    const little = isStraight(points, 17, 18, 20);
    const fingersApart = distance(points[8], points[12]) > palm * .24;
    if (index && middle && !ring && !little && fingersApart) return 'victory';
    if (distance(points[4], points[8]) < palm * .29) return 'pinch';
    if (index && middle && ring && little) return 'palm';
    if (index && !middle && !ring && !little) return 'point';
    return null;
  }

  function createHold(duration) {
    let previous = null;
    let since = 0;
    let triggered = false;

    return {
      update(gesture, now) {
        if (gesture !== previous) {
          previous = gesture;
          since = now;
          triggered = false;
        }
        const progress = gesture ? Math.min(1, (now - since) / duration) : 0;
        const complete = progress === 1 && !triggered;
        if (complete) triggered = true;
        return { progress, complete };
      },
    };
  }

  return { classify, createHold };
})();
