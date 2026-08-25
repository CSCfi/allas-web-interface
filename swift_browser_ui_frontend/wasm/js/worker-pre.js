var moduleStartComplete = false;

// Detect if inside a ServiceWorker
let inServiceWorker = false;
if (typeof ServiceWorkerGlobalScope !== "undefined") {
  inServiceWorker = self instanceof ServiceWorkerGlobalScope;
}

function timeout(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

var Module = {
  onRuntimeInitialized: () => {
    moduleStartComplete = true;
  },
  printErr: (text) => {},
};
