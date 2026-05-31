// Runs in the page's main JavaScript world.
// Primary: intercept GitHub's preview fetch/XHR to capture the current editor text.
// Fallback: read directly from the CodeMirror instance.
// The captured text is stored in document.documentElement.dataset.glossviewContent
// so the ISOLATED-world content script can read it without cross-world event dispatch.
(function () {
  if (window.__glossviewEditorBridgeInstalled) return;
  window.__glossviewEditorBridgeInstalled = true;

  var ATTR = "data-glossview-content";
  var SEQ_ATTR = "data-glossview-content-seq";
  var REQUEST_EVENT = "__glossview_request_editor_content";
  var RESPONSE_EVENT = "__glossview_editor_content";
  var CLEAR_EVENT = "__glossview_clear_editor_content";
  var lastText = null;
  var seq = 0;

  // ── Extract text from a POST body ──────────────────────────────────────────

  function extractText(body) {
    if (!body) return null;

    // URLSearchParams instance (passed directly as body to fetch)
    if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) {
      return (
        body.get("text") ||
        body.get("body") ||
        body.get("content") ||
        body.get("value") ||
        body.get("markdown") ||
        longestFormValue(body)
      );
    }

    // FormData instance
    if (typeof FormData !== "undefined" && body instanceof FormData) {
      var fv = body.get("text") || body.get("body") || body.get("content") || body.get("value") || body.get("markdown");
      return fv != null ? String(fv) : longestFormValue(body);
    }

    if (typeof body !== "string") return null;

    // URL-encoded form (most common for GitHub preview)
    try {
      var p = new URLSearchParams(body);
      var t = p.get("text") || p.get("body") || p.get("content") || p.get("value") || p.get("markdown") || longestFormValue(p);
      if (t) return t;
    } catch (_) {}

    // JSON body
    try {
      var j = JSON.parse(body);
      return j.text || j.body || j.content || j.value || j.markdown || null;
    } catch (_) {}

    return null;
  }

  function longestFormValue(form) {
    var best = "";
    try {
      form.forEach(function (value) {
        if (typeof value !== "string") return;
        if (value.length > best.length && /(^|\n)\s*(#{1,6}\s|```|>|- |\*)/.test(value)) {
          best = value;
        }
      });
    } catch (_) {}
    return best || null;
  }

  function isPreviewUrl(url) {
    return typeof url === "string" && /\/(preview|markdown)(\?.*)?$/.test(url);
  }

  function requestUrl(input) {
    return typeof input === "string" ? input : (input && input.url) || "";
  }

  function requestMethod(input, init) {
    return String((init && init.method) || (input && input.method) || "GET").toUpperCase();
  }

  function captureFetchBody(input, init) {
    if (init && init.body) {
      var direct = extractText(init.body);
      if (direct) storeContent(direct);
      return;
    }

    if (typeof Request !== "undefined" && input instanceof Request) {
      try {
        input.clone().text().then(function (body) {
          var text = extractText(body);
          if (text) storeContent(text);
        }).catch(function () {});
      } catch (_) {}
    }
  }

  function storeContent(text) {
    text = normalizeEditorText(text);
    if (text && text !== lastText) {
      lastText = text;
      try {
        seq += 1;
        document.documentElement.setAttribute(ATTR, text);
        document.documentElement.setAttribute(SEQ_ATTR, String(seq));
      } catch (_) {}
    }
  }

  function normalizeEditorText(text) {
    if (typeof text !== "string") return null;
    var normalized = text.replace(/\r\n?/g, "\n");
    if (!normalized.trim()) return null;

    // A large Markdown document with no line breaks almost always came from
    // contenteditable.textContent, which drops the editor's visual line breaks.
    if (
      normalized.indexOf("\n") < 0 &&
      normalized.length > 400 &&
      /#{1,6}\s|```|>\s*\[!|---/.test(normalized)
    ) {
      return null;
    }

    return normalized;
  }

  // ── Intercept fetch ─────────────────────────────────────────────────────────

  var origFetch = window.fetch;
  window.fetch = function (input, init) {
    var url = requestUrl(input);
    if (isPreviewUrl(url) && requestMethod(input, init) === "POST") {
      captureFetchBody(input, init);
    }
    return origFetch.apply(this, arguments);
  };

  // ── Intercept XHR ───────────────────────────────────────────────────────────

  var origOpen = XMLHttpRequest.prototype.open;
  var origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__gvUrl = url;
    this.__gvMethod = method;
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    if (
      String(this.__gvMethod || "").toUpperCase() === "POST" &&
      isPreviewUrl(this.__gvUrl)
    ) {
      var t = extractText(body);
      if (t) storeContent(t);
    }
    return origSend.apply(this, arguments);
  };

  // ── CodeMirror fallback ─────────────────────────────────────────────────────

  function fromCodeMirror() {
    // CodeMirror 5: instance stored as .CodeMirror on the wrapper element
    var cm5 = document.querySelector(".CodeMirror");
    if (cm5 && cm5.CodeMirror && typeof cm5.CodeMirror.getValue === "function") {
      return cm5.CodeMirror.getValue();
    }

    var roots = Array.prototype.slice.call(
      document.querySelectorAll(".cm-content, .cm-editor, .js-codemirror-editor")
    );
    for (var i = 0; i < roots.length; i++) {
      var text = findCodeMirrorDoc(roots[i]);
      if (text) return text;
    }

    return null;
  }

  function docFromView(value) {
    try {
      if (
        value &&
        value.state &&
        value.state.doc &&
        typeof value.state.doc.toString === "function"
      ) {
        return value.state.doc.toString();
      }
    } catch (_) {}
    return null;
  }

  function objectKeys(value) {
    var keys = [];
    try { keys = keys.concat(Object.getOwnPropertyNames(value)); } catch (_) {}
    try {
      if (Object.getOwnPropertySymbols) keys = keys.concat(Object.getOwnPropertySymbols(value));
    } catch (_) {}
    return keys;
  }

  function findCodeMirrorDoc(root) {
    var queue = [];
    var seen = typeof WeakSet !== "undefined" ? new WeakSet() : null;

    function enqueue(value, depth) {
      if (!value || depth > 5) return;
      var type = typeof value;
      if (type !== "object" && type !== "function") return;
      if (value === window || value === document) return;
      if (seen) {
        if (seen.has(value)) return;
        seen.add(value);
      }
      queue.push({ value: value, depth: depth });
    }

    enqueue(root, 0);
    enqueue(root.cmView, 0);
    enqueue(root.CodeMirror, 0);

    var inspected = 0;
    while (queue.length && inspected < 250) {
      inspected += 1;
      var item = queue.shift();
      var value = item.value;
      var direct = docFromView(value);
      if (direct) return direct;

      var keys = objectKeys(value);
      for (var i = 0; i < keys.length; i++) {
        try {
          var child = value[keys[i]];
          direct = docFromView(child);
          if (direct) return direct;
          enqueue(child, item.depth + 1);
        } catch (_) {}
      }
    }

    return null;
  }

  function fromTextArea() {
    var selectors = [
      "textarea[name='value']",
      "textarea[name='content']",
      "textarea[name='contents']",
      "textarea[name='body']",
      "textarea[name='text']",
      "textarea[name='markdown']",
      "textarea.js-code-textarea",
      "textarea.js-blob-contents",
      "textarea",
    ];

    for (var i = 0; i < selectors.length; i++) {
      var el = document.querySelector(selectors[i]);
      if (el && typeof el.value === "string" && el.value.trim()) {
        return normalizeEditorText(el.value);
      }
    }
    return null;
  }

  function fromEditor() {
    return fromCodeMirror() || fromTextArea();
  }

  // ── Proactive read on click: capture editor content when Preview tab is clicked
  //    Uses capture phase to run before GlossView's click handler (which schedules
  //    main() with a 300 ms delay — giving this listener plenty of time to store).

  document.addEventListener("click", function () {
    var content = fromEditor() || lastText;
    if (content) storeContent(content);
  }, true);

  function captureSoon() {
    setTimeout(function () {
      var content = fromEditor();
      if (content) storeContent(content);
    }, 0);
  }

  document.addEventListener("input", captureSoon, true);
  document.addEventListener("keyup", captureSoon, true);
  document.addEventListener("paste", captureSoon, true);

  // ── Respond to content script requests ─────────────────────────────────────

  document.addEventListener(REQUEST_EVENT, function () {
    var content = fromEditor();
    if (content) storeContent(content);
    document.dispatchEvent(
      new CustomEvent(RESPONSE_EVENT, { detail: content })
    );
  });

  document.addEventListener(CLEAR_EVENT, function () {
    lastText = null;
    try {
      document.documentElement.removeAttribute(ATTR);
      document.documentElement.removeAttribute(SEQ_ATTR);
    } catch (_) {}
  });
})();
