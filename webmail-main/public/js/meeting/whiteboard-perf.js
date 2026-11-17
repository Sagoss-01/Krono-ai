(function(g){
  const WBPerf = {
    rafThrottle(fn){
      let raf = 0, lastArgs = null, lastThis = null;
      return function(...args){
        lastArgs = args; lastThis = this;
        if (raf) return;
        raf = requestAnimationFrame(() => {
          raf = 0;
          fn.apply(lastThis, lastArgs || []);
        });
      };
    },
    debounce(fn, wait = 120){
      let timer = 0;
      return function(...args){
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), wait);
      };
    },
    createThrottle(fn, wait = 50){
      let last = 0, timer = 0, queued = null, queuedThis = null;
      const invoke = () => {
        timer = 0;
        last = Date.now();
        const args = queued; queued = null;
        fn.apply(queuedThis, args || []);
      };
      return function(...args){
        queued = args; queuedThis = this;
        const now = Date.now();
        if (now - last >= wait) return invoke();
        if (!timer) timer = setTimeout(invoke, wait - (now - last));
      };
    },
    shouldKeepPoint(lastPx, nextPx, minPx = 1.5){
      if (!lastPx || !nextPx) return true;
      const dx = nextPx.x - lastPx.x;
      const dy = nextPx.y - lastPx.y;
      return (dx * dx + dy * dy) >= (minPx * minPx);
    }
  };
  g.WBPerf = Object.assign(g.WBPerf || {}, WBPerf);
})(window);
