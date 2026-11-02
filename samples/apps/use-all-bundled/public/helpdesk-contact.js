// Must be served from the app's origin: client.js posts to the relative /api paths without cookies.
(() => {
  const KIND_LABELS = {
    question: "Question",
    contact: "Quote or contact request",
    bug: "Problem report",
  };

  const form = document.getElementById("contact-form");
  const kindSelect = document.getElementById("kind");
  const phoneField = document.getElementById("phone-field");
  const phoneInput = document.getElementById("phone");
  const submitButton = document.getElementById("submit");
  const status = document.getElementById("status");

  function showStatus(state, text) {
    status.dataset.state = state;
    status.textContent = text;
  }

  function fillKinds(kinds) {
    kindSelect.replaceChildren(
      ...kinds.map((kind) => {
        const option = document.createElement("option");
        option.value = kind;
        option.textContent = KIND_LABELS[kind] ?? kind;
        return option;
      }),
    );
    kindSelect.disabled = false;
  }

  function applyPhoneMode(mode) {
    phoneField.hidden = mode === "off";
    phoneInput.required = mode === "required";
    phoneField.querySelector(".label").textContent =
      mode === "required" ? "Phone" : "Phone (optional)";
    phoneInput.disabled = mode === "off";
  }

  function readFields() {
    const fields = {
      kind: kindSelect.value,
      name: form.elements.name.value.trim(),
      email: form.elements.email.value.trim(),
      message: form.elements.message.value.trim(),
      website: form.elements.website.value,
      page: window.location.pathname,
    };
    const phone = phoneInput.value.trim();
    if (!phoneInput.disabled && phone !== "") fields.phone = phone;
    return fields;
  }

  function describe(result) {
    if (result.kind === "sent") return ["sent", "Thank you, your message was sent."];
    if (result.kind === "rate-limited") {
      const minutes = Math.ceil((result.retryAfterSeconds ?? 0) / 60);
      return [
        "rate-limited",
        minutes > 0
          ? `Too many messages from your connection. Please try again in ${minutes} minutes.`
          : "Too many messages from your connection. Please try again later.",
      ];
    }
    return ["failed", "Your message could not be sent. Please try again in a moment."];
  }

  function loadOptions() {
    return window.KumikoHelpdesk.load().then(
      (options) => {
        fillKinds(options.kinds);
        applyPhoneMode(options.phone);
        submitButton.disabled = false;
      },
      () => showStatus("failed", "The form is not available right now. Please try again later."),
    );
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submitButton.disabled = true;
    showStatus("sending", "Sending...");
    window.KumikoHelpdesk.submit(readFields()).then((result) => {
      const [state, text] = describe(result);
      showStatus(state, text);
      if (result.kind === "sent") {
        form.reset();
        // A submit uses up the prefetched challenge, so prepare the next one.
        loadOptions();
      } else {
        submitButton.disabled = false;
      }
    });
  });

  loadOptions();
})();
