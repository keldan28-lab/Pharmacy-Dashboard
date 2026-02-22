// Shared postMessage helpers for static HTML pages (no modules/build step)
(function () {
  if (!window.InventoryApp) window.InventoryApp = {};

  function pickPayload(evtData) {
    // Backward compatible: older dashboard sent { data: computed }
    if (evtData && typeof evtData === 'object') {
      if (evtData.computed || evtData.raw) {
        return {
          raw: evtData.raw || null,
          computed: evtData.computed || evtData.data || null
        };
      }
      if (evtData.data) {
        return { raw: null, computed: evtData.data };
      }
    }
    return { raw: null, computed: evtData || null };
  }

  /**
   * Request mock data from the parent dashboard.
   * @param {(payload:{raw:any, computed:any})=>void} onData
   */
  function requestMockData(onData) {
    if (!window.parent || window.parent === window) {
      console.warn('postMessage: no parent window found.');
      onData({ raw: null, computed: null });
      return;
    }

    function handler(event) {
      if (!event || !event.data) return;
      if (event.data.type !== 'mockDataResponse') return;
      window.removeEventListener('message', handler);
      onData(pickPayload(event.data));
    }

    window.addEventListener('message', handler);
    window.parent.postMessage({ type: 'requestMockData' }, '*');
  }

  window.InventoryApp.postMessage = window.InventoryApp.postMessage || {};
  window.InventoryApp.postMessage.requestMockData = requestMockData;
  window.InventoryApp.postMessage.pickPayload = pickPayload;
})();
