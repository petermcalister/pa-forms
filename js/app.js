/**
 * Pete PA — Static Form Renderer
 *
 * Reads a URL fragment, decodes (base64url -> zlib -> JSON),
 * renders a form, and on submit constructs a wa.me deep link.
 */

(function () {
  "use strict";

  const app = document.getElementById("app");

  // ── Decode helpers ──────────────────────────────────────────

  function base64urlDecode(str) {
    str = str.replace(/-/g, "+").replace(/_/g, "/");
    while (str.length % 4) str += "=";
    const binary = atob(str);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  async function zlibDecompress(uint8array) {
    const ds = new DecompressionStream("deflate");
    const writer = ds.writable.getWriter();
    writer.write(uint8array);
    writer.close();
    const reader = ds.readable.getReader();
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const total = chunks.reduce((a, c) => a + c.length, 0);
    const result = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return new TextDecoder().decode(result);
  }

  async function decodeFragment(fragment) {
    const bytes = base64urlDecode(fragment);
    const json = await zlibDecompress(bytes);
    return JSON.parse(json);
  }

  // ── State ───────────────────────────────────────────────────

  // answers keyed by question id
  const answers = {};

  // ── Render helpers ──────────────────────────────────────────

  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (k === "className") el.className = v;
        else if (k.startsWith("on")) el.addEventListener(k.slice(2).toLowerCase(), v);
        else el.setAttribute(k, v);
      }
    }
    for (const child of children) {
      if (child == null) continue;
      if (typeof child === "string") el.appendChild(document.createTextNode(child));
      else el.appendChild(child);
    }
    return el;
  }

  // ── Question renderers ─────────────────────────────────────

  function renderSingleSelect(q) {
    const grid = h("div", { className: "card-grid" });
    const options = q.options || [];
    options.forEach(function (opt) {
      const card = h("div", {
        className: "card-option",
        "data-value": opt,
        onClick: function () {
          answers[q.id] = opt;
          grid.querySelectorAll(".card-option").forEach(function (c) { c.classList.remove("selected"); });
          card.classList.add("selected");
        },
      }, opt);
      grid.appendChild(card);
    });
    return grid;
  }

  function renderMultiSelect(q) {
    answers[q.id] = answers[q.id] || [];
    const grid = h("div", { className: "card-grid" });
    const options = q.options || [];
    options.forEach(function (opt) {
      const checkmark = h("span", { className: "checkmark" }, "\u2713");
      const card = h("div", {
        className: "card-option",
        "data-value": opt,
        onClick: function () {
          const sel = answers[q.id];
          const idx = sel.indexOf(opt);
          if (idx >= 0) { sel.splice(idx, 1); card.classList.remove("selected"); }
          else { sel.push(opt); card.classList.add("selected"); }
        },
      }, checkmark, opt);
      grid.appendChild(card);
    });
    return grid;
  }

  function renderYesNo(q) {
    const group = h("div", { className: "yesno-group" });
    ["yes", "no"].forEach(function (val) {
      const btn = h("div", {
        className: "yesno-btn",
        "data-value": val,
        onClick: function () {
          answers[q.id] = val;
          group.querySelectorAll(".yesno-btn").forEach(function (b) { b.classList.remove("selected"); });
          btn.classList.add("selected");
        },
      }, val === "yes" ? "Yes" : "No");
      group.appendChild(btn);
    });
    return group;
  }

  function renderSlider(q) {
    var minVal = q.min_value != null ? q.min_value : 0;
    var maxVal = q.max_value != null ? q.max_value : 10;
    var stepVal = q.step != null ? q.step : 1;
    var initial = Math.round((minVal + maxVal) / 2);
    answers[q.id] = String(initial);

    var display = h("span", { className: "slider-value" }, String(initial));
    var input = h("input", {
      type: "range",
      min: String(minVal),
      max: String(maxVal),
      step: String(stepVal),
      value: String(initial),
      onInput: function () {
        answers[q.id] = input.value;
        display.textContent = input.value;
      },
    });

    var wrap = h("div", { className: "slider-wrap" }, input, display);
    var labels = h("div", { className: "slider-labels" },
      h("span", null, String(minVal)),
      h("span", null, String(maxVal))
    );
    var container = h("div", null, wrap, labels);
    return container;
  }

  function renderTextInput(q) {
    var input = h("input", {
      type: "text",
      className: "text-input",
      placeholder: q.placeholder || "",
      onInput: function () { answers[q.id] = input.value; },
    });
    return input;
  }

  function renderDatePicker(q) {
    var input = h("input", {
      type: "date",
      className: "native-input",
      onChange: function () { answers[q.id] = input.value; },
    });
    return input;
  }

  function renderTimePicker(q) {
    var input = h("input", {
      type: "time",
      className: "native-input",
      onChange: function () { answers[q.id] = input.value; },
    });
    return input;
  }

  function renderRating(q) {
    var maxStars = q.max_value != null ? q.max_value : 5;
    var minStars = q.min_value != null ? q.min_value : 1;
    var row = h("div", { className: "rating-row" });
    var buttons = [];

    for (var i = minStars; i <= maxStars; i++) {
      (function (val) {
        var btn = h("button", {
          type: "button",
          className: "star-btn",
          onClick: function () {
            answers[q.id] = String(val);
            buttons.forEach(function (b, idx) {
              if (idx + minStars <= val) b.classList.add("active");
              else b.classList.remove("active");
            });
          },
        }, "\u2605");
        buttons.push(btn);
        row.appendChild(btn);
      })(i);
    }
    return row;
  }

  function renderRanked(q) {
    var options = (q.options || []).slice();
    answers[q.id] = options.slice();

    var list = h("div", { className: "ranked-list" });

    function rebuild() {
      list.innerHTML = "";
      var items = answers[q.id];
      items.forEach(function (opt, idx) {
        var upBtn = h("button", {
          type: "button",
          className: "rank-btn",
          disabled: idx === 0,
          onClick: function () {
            var arr = answers[q.id];
            var tmp = arr[idx - 1];
            arr[idx - 1] = arr[idx];
            arr[idx] = tmp;
            rebuild();
          },
        }, "\u25B2");

        var downBtn = h("button", {
          type: "button",
          className: "rank-btn",
          disabled: idx === items.length - 1,
          onClick: function () {
            var arr = answers[q.id];
            var tmp = arr[idx + 1];
            arr[idx + 1] = arr[idx];
            arr[idx] = tmp;
            rebuild();
          },
        }, "\u25BC");

        var btns = h("div", { className: "rank-btns" }, upBtn, downBtn);
        var item = h("div", { className: "ranked-item" },
          h("span", { className: "rank-num" }, String(idx + 1) + "."),
          h("span", { className: "rank-label" }, opt),
          btns
        );
        list.appendChild(item);
      });
    }

    rebuild();
    return list;
  }

  var renderers = {
    single_select: renderSingleSelect,
    multi_select: renderMultiSelect,
    yes_no: renderYesNo,
    slider: renderSlider,
    text_input: renderTextInput,
    date_picker: renderDatePicker,
    time_picker: renderTimePicker,
    rating: renderRating,
    ranked: renderRanked,
  };

  // ── Form rendering ─────────────────────────────────────────

  function renderForm(form) {
    app.innerHTML = "";

    var titleEl = h("h1", { className: "form-title" }, form.title);
    app.appendChild(titleEl);

    if (form.description) {
      var descEl = h("p", { className: "form-description" }, form.description);
      app.appendChild(descEl);
    }

    var questionEls = [];

    form.questions.forEach(function (q) {
      var label = h("span", { className: "question-label" },
        q.label,
        q.required ? h("span", { className: "required-star" }, " *") : null
      );

      var renderer = renderers[q.type];
      var body = renderer ? renderer(q) : h("div", null, "Unsupported question type: " + q.type);

      var errorMsg = h("div", { className: "validation-error" }, "This question is required.");

      var questionDiv = h("div", { className: "question", "data-qid": q.id }, label, body, errorMsg);
      questionEls.push({ el: questionDiv, q: q });
      app.appendChild(questionDiv);
    });

    var submitBtn = h("button", {
      type: "button",
      className: "submit-btn",
      onClick: function () { handleSubmit(form, questionEls); },
    }, "Submit via WhatsApp");
    app.appendChild(submitBtn);
  }

  // ── Validation & submit ────────────────────────────────────

  function handleSubmit(form, questionEls) {
    var valid = true;

    questionEls.forEach(function (item) {
      item.el.classList.remove("invalid");
      if (!item.q.required) return;

      var val = answers[item.q.id];
      var empty = val == null
        || val === ""
        || (Array.isArray(val) && val.length === 0);

      if (empty) {
        item.el.classList.add("invalid");
        valid = false;
      }
    });

    if (!valid) {
      var first = document.querySelector(".question.invalid");
      if (first) first.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    // Build response string
    var parts = [];
    form.questions.forEach(function (q) {
      var val = answers[q.id];
      if (val == null || val === "") return;
      if (Array.isArray(val)) val = val.join(",");
      parts.push(q.id + "=" + val);
    });

    var response = "COWORK_FORM:" + form.id + "|" + parts.join("|");

    // Copy to clipboard and show the response for manual paste
    if (navigator.clipboard) {
      navigator.clipboard.writeText(response).catch(function () {});
    }

    // Try wa.me deep link (lets user pick contact/group)
    var waUrl = "https://wa.me/?text=" + encodeURIComponent(response);
    window.open(waUrl, "_blank");

    // Show success with response string as fallback
    showSuccess(response);
  }

  function showSuccess(response) {
    app.innerHTML = "";
    var screen = h("div", { className: "success-screen" },
      h("div", { className: "success-icon" }, "\u2705"),
      h("div", { className: "success-title" }, "Form submitted!"),
      h("div", { className: "success-body" }, "Paste this into the cowork-pa WhatsApp group if WhatsApp didn't open automatically:"),
      h("pre", { className: "response-string", style: "background:#1e1e2e;padding:12px;border-radius:8px;font-size:13px;word-break:break-all;margin-top:12px;user-select:all;cursor:pointer" }, response),
      h("div", { className: "success-body", style: "margin-top:8px;opacity:0.6;font-size:13px" }, "Response also copied to clipboard.")
    );
    app.appendChild(screen);
  }

  // ── Error display ──────────────────────────────────────────

  function showError(message, detail) {
    app.innerHTML = "";
    var container = h("div", { className: "error-msg" },
      h("div", null, message),
      detail ? h("div", { className: "error-detail" }, detail) : null
    );
    app.appendChild(container);
  }

  // ── Init ───────────────────────────────────────────────────

  async function init() {
    var fragment = window.location.hash.slice(1);

    if (!fragment) {
      showError("No form data found.", "Please open a valid form link that includes a # fragment.");
      return;
    }

    try {
      var form = await decodeFragment(fragment);
      renderForm(form);
    } catch (err) {
      showError("Could not load form.", "The link may be invalid or corrupted. (" + err.message + ")");
    }
  }

  init();
})();
