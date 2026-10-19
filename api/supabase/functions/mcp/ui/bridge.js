// SPDX-License-Identifier: AGPL-3.0-only
// MCP Apps view side (protocol 2026-01-26), JSON-RPC over postMessage with
// the host. Hand-written instead of bundling @modelcontextprotocol/ext-apps:
// its 2.x release needs MCP SDK 2, and the wire protocol is all a view needs.
// Inlined into every Zappion screen by zappion_apps.ts.
(function () {
  "use strict";
  let nextId = 1;
  let pending = new Map();
  let handlers = {};
  let hostCapabilities = {};

  function post(message) {
    window.parent.postMessage(Object.assign({ jsonrpc: "2.0" }, message), "*");
  }

  function request(method, params) {
    let id = nextId++;
    post({ id: id, method: method, params: params || {} });
    return new Promise(function (resolve, reject) {
      pending.set(id, { resolve: resolve, reject: reject });
    });
  }

  function notify(method, params) {
    post({ method: method, params: params || {} });
  }

  window.addEventListener("message", function (event) {
    if (event.source !== window.parent) return;
    let m = event.data;
    if (!m || m.jsonrpc !== "2.0") return;
    if (m.id !== undefined && !m.method) {
      let p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      if (m.error) p.reject(new Error(m.error.message || "Host error"));
      else p.resolve(m.result);
      return;
    }
    if (m.method === "ui/notifications/host-context-changed") {
      applyContext(m.params);
    }
    let handler = handlers[m.method];
    // Requests from the host (ui/resource-teardown, ping) need an answer.
    if (m.id !== undefined) post({ id: m.id, result: {} });
    if (handler) handler(m.params || {});
  });

  function applyContext(context) {
    if (!context) return;
    let root = document.documentElement;
    if (context.theme) {
      root.dataset.theme = context.theme;
      root.style.colorScheme = context.theme;
    }
    let vars = context.styles && context.styles.variables;
    if (vars) {
      Object.keys(vars).forEach(function (key) {
        if (vars[key]) root.style.setProperty(key, vars[key]);
      });
    }
    let fonts = context.styles && context.styles.css &&
      context.styles.css.fonts;
    if (fonts && !document.getElementById("host-fonts")) {
      let style = document.createElement("style");
      style.id = "host-fonts";
      style.textContent = fonts;
      document.head.appendChild(style);
    }
  }

  function watchSize() {
    let last = 0;
    let report = function () {
      // The body, not the document: the document is never shorter than the
      // iframe, so a screen that got smaller would keep its old height.
      let height = Math.ceil(document.body.getBoundingClientRect().height);
      if (height === last) return;
      last = height;
      notify("ui/notifications/size-changed", {
        width: Math.ceil(document.documentElement.scrollWidth),
        height: height,
      });
    };
    new ResizeObserver(report).observe(document.body);
    report();
  }

  // The tool result's structured content, or its JSON text when a host
  // passes only `content`.
  function resultData(result) {
    if (!result) return null;
    if (result.structuredContent) return result.structuredContent;
    let text = (result.content || []).find(function (c) {
      return c.type === "text";
    });
    if (!text) return null;
    try {
      return JSON.parse(text.text);
    } catch (_) {
      return { error: text.text };
    }
  }

  window.McpApp = {
    on: function (method, handler) {
      handlers[method] = handler;
    },
    connect: function (name) {
      return request("ui/initialize", {
        protocolVersion: "2026-01-26",
        appInfo: { name: name, version: "1.0.0" },
        appCapabilities: {},
      }).then(function (result) {
        hostCapabilities = (result && result.hostCapabilities) || {};
        applyContext(result && result.hostContext);
        notify("ui/notifications/initialized", {});
        watchSize();
        return result;
      });
    },
    /** Calls a server tool through the host; rejects with the tool's error. */
    callTool: function (name, args) {
      return request("tools/call", { name: name, arguments: args })
        .then(function (result) {
          let data = resultData(result);
          if (result && result.isError) {
            // A guard refusal is {error: {code, message}}; a thrown error is
            // plain text.
            let error = data && data.error;
            let err = new Error(
              (error && error.message) || error || textOf(result),
            );
            err.code = error && error.code;
            throw err;
          }
          return data;
        });
    },
    /** Tells the model what happened on screen, when the host supports it. */
    updateModelContext: function (text) {
      if (!hostCapabilities.updateModelContext) return Promise.resolve();
      return request("ui/update-model-context", {
        content: [{ type: "text", text: text }],
      }).catch(function () {});
    },
    resultData: resultData,
  };

  function textOf(result) {
    let text = (result.content || []).find(function (c) {
      return c.type === "text";
    });
    return text ? text.text : "The tool call failed.";
  }
})();
