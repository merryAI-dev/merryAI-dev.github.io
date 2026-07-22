(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const elements = {
    signIn: $("#signIn"),
    app: $("#editorApp"),
    title: $("#title"),
    description: $("#description"),
    body: $("#editorBody"),
    saveState: $("#saveState"),
    wordCount: $("#wordCount"),
    toolbar: $("#formatToolbar"),
    restoreBanner: $("#restoreBanner"),
    settings: $("#settingsDialog"),
    posts: $("#postsDialog"),
    postsList: $("#postsList"),
    preview: $("#previewDialog"),
    link: $("#linkDialog"),
    imageInput: $("#imageInput"),
    toast: $("#toast")
  };

  const fields = {
    slug: $("#slug"),
    series: $("#series"),
    seriesNo: $("#seriesNo"),
    tags: $("#tags"),
    readingTime: $("#readingTime"),
    published: $("#published")
  };

  const STORAGE_KEY = "mysc-editor-draft-v1";
  const sanitizerOptions = {
    ALLOWED_TAGS: ["p", "br", "h2", "h3", "strong", "b", "em", "i", "u", "mark", "blockquote", "pre", "code", "a", "ul", "ol", "li", "figure", "figcaption", "img", "table", "thead", "tbody", "tr", "th", "td", "hr"],
    ALLOWED_ATTR: ["href", "target", "rel", "src", "alt", "title"]
  };

  const state = {
    path: "",
    sha: "",
    savedFingerprint: "",
    savedRange: null,
    autosaveTimer: null,
    toastTimer: null,
    busy: false
  };

  function defaultSlug() {
    const now = new Date();
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false
    }).formatToParts(now).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
    return `note-${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}`;
  }

  function sanitize(html) {
    const template = document.createElement("template");
    template.innerHTML = html || "";
    template.content.querySelectorAll("span[style*='background'], font[color]").forEach((node) => {
      const mark = document.createElement("mark");
      mark.innerHTML = node.innerHTML;
      node.replaceWith(mark);
    });
    return window.DOMPurify.sanitize(template.innerHTML, sanitizerOptions);
  }

  function resizeTextarea(textarea) {
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }

  function collectDocument() {
    return {
      title: elements.title.value.trim(),
      description: elements.description.value.trim(),
      body: sanitize(elements.body.innerHTML),
      slug: fields.slug.value.trim().toLowerCase(),
      series: fields.series.value.trim(),
      seriesNo: Number(fields.seriesNo.value) || 1,
      tags: fields.tags.value.split(",").map((tag) => tag.trim()).filter(Boolean),
      readingTime: Number(fields.readingTime.value) || 1,
      published: fields.published.checked,
      cardImage: state.cardImage || "",
      nextTitle: state.nextTitle || "",
      nextUrl: state.nextUrl || "",
      path: state.path,
      sha: state.sha
    };
  }

  function fingerprint(documentState = collectDocument()) {
    return JSON.stringify(documentState);
  }

  function updateCount() {
    const text = elements.body.textContent.replace(/\s+/g, " ").trim();
    elements.wordCount.textContent = `${text.length.toLocaleString("ko-KR")}자`;
  }

  function setSaveState(message) {
    elements.saveState.textContent = message;
  }

  function toast(message) {
    elements.toast.textContent = message;
    elements.toast.hidden = false;
    window.clearTimeout(state.toastTimer);
    state.toastTimer = window.setTimeout(() => { elements.toast.hidden = true; }, 3200);
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      ...options
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || "요청을 처리하지 못했어요.");
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function saveLocal() {
    const documentState = collectDocument();
    if (!documentState.title && !elements.body.textContent.trim()) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ savedAt: Date.now(), document: documentState }));
    if (fingerprint(documentState) !== state.savedFingerprint) setSaveState("이 브라우저에 저장됨");
  }

  function scheduleLocalSave() {
    window.clearTimeout(state.autosaveTimer);
    setSaveState("작성 중…");
    state.autosaveTimer = window.setTimeout(saveLocal, 650);
  }

  function applyDocument(documentState, { server = false } = {}) {
    elements.title.value = documentState.title || "";
    elements.description.value = documentState.description || "";
    elements.body.innerHTML = sanitize(documentState.body || "<p><br></p>");
    fields.slug.value = documentState.slug || defaultSlug();
    fields.series.value = documentState.series || "Building the Ledger";
    fields.seriesNo.value = documentState.seriesNo || 1;
    fields.tags.value = (documentState.tags || []).join(", ");
    fields.readingTime.value = documentState.readingTime || 8;
    fields.published.checked = Boolean(documentState.published);
    state.path = documentState.path || "";
    state.sha = documentState.sha || "";
    state.cardImage = documentState.cardImage || "";
    state.nextTitle = documentState.nextTitle || "";
    state.nextUrl = documentState.nextUrl || "";
    resizeTextarea(elements.title);
    resizeTextarea(elements.description);
    updateCount();
    if (server) {
      state.savedFingerprint = fingerprint();
      setSaveState(state.path ? "저장됨" : "새 글");
    }
  }

  function newDocument({ discardLocal = true } = {}) {
    applyDocument({
      slug: defaultSlug(), series: "Building the Ledger", seriesNo: 1,
      readingTime: 8, published: false, body: "<p><br></p>"
    }, { server: true });
    history.replaceState(null, "", location.pathname);
    if (discardLocal) localStorage.removeItem(STORAGE_KEY);
    elements.posts.close();
    elements.title.focus();
  }

  function checkLocalRecovery() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
      const local = JSON.parse(raw);
      if (local.document && fingerprint(local.document) !== state.savedFingerprint) {
        elements.restoreBanner.hidden = false;
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  async function loadPost(path) {
    elements.posts.close();
    setSaveState("불러오는 중…");
    try {
      const result = await api(`/api/posts?path=${encodeURIComponent(path)}`);
      const body = window.marked.parse(result.post.bodyMarkdown || "", { gfm: true, breaks: false });
      applyDocument({ ...result.post, body }, { server: true });
      history.replaceState(null, "", `${location.pathname}?path=${encodeURIComponent(path)}`);
      checkLocalRecovery();
      elements.title.focus();
    } catch (error) {
      setSaveState("불러오기 실패");
      toast(error.message);
    }
  }

  function validate(documentState) {
    if (!documentState.title) return "제목을 입력해주세요.";
    if (!elements.body.textContent.trim()) return "본문을 입력해주세요.";
    if (!/^[a-z0-9-]{3,80}$/.test(documentState.slug)) return "영문 주소는 3~80자의 영문 소문자, 숫자, 하이픈만 쓸 수 있어요.";
    return "";
  }

  async function save(mode = "save") {
    if (state.busy) return;
    const documentState = collectDocument();
    if (mode === "publish") documentState.published = true;
    const message = validate(documentState);
    if (message) { toast(message); return; }

    state.busy = true;
    $("#saveButton").disabled = true;
    $("#publishButton").disabled = true;
    setSaveState(mode === "publish" ? "발행하는 중…" : "저장하는 중…");
    try {
      const result = await api("/api/posts", { method: "PUT", body: JSON.stringify(documentState) });
      state.path = result.post.path;
      state.sha = result.post.sha;
      fields.published.checked = result.post.published;
      state.savedFingerprint = fingerprint();
      localStorage.removeItem(STORAGE_KEY);
      elements.restoreBanner.hidden = true;
      history.replaceState(null, "", `${location.pathname}?path=${encodeURIComponent(state.path)}`);
      setSaveState(result.post.published ? "발행됨" : "초안 저장됨");
      toast(result.post.published ? "글을 발행했어요." : "초안을 안전하게 저장했어요.");
    } catch (error) {
      setSaveState(error.status === 409 ? "다른 수정 발견" : "저장 실패");
      toast(error.status === 409 ? "다른 곳에서 이 글이 수정됐어요. 내 글에서 다시 불러온 뒤 확인해주세요." : error.message);
    } finally {
      state.busy = false;
      $("#saveButton").disabled = false;
      $("#publishButton").disabled = false;
    }
  }

  function renderPreview() {
    $("#previewSeries").textContent = fields.series.value.trim();
    $("#previewTitle").textContent = elements.title.value.trim() || "제목 없음";
    $("#previewDescription").textContent = elements.description.value.trim();
    $("#previewBody").innerHTML = sanitize(elements.body.innerHTML);
    elements.preview.showModal();
  }

  async function showPosts() {
    elements.posts.showModal();
    elements.postsList.innerHTML = "<p>글을 불러오는 중…</p>";
    try {
      const result = await api("/api/posts");
      if (!result.posts.length) {
        elements.postsList.innerHTML = "<p>아직 저장한 글이 없어요.</p>";
        return;
      }
      elements.postsList.replaceChildren(...result.posts.map((post) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "post-row";
        const text = document.createElement("span");
        const title = document.createElement("strong");
        title.textContent = post.title || "제목 없음";
        const meta = document.createElement("small");
        meta.textContent = post.date;
        text.append(title, meta);
        const status = document.createElement("span");
        status.className = `status-dot${post.published ? " public" : ""}`;
        status.textContent = post.published ? "공개" : "초안";
        button.append(text, status);
        button.addEventListener("click", () => loadPost(post.path));
        return button;
      }));
    } catch (error) {
      elements.postsList.textContent = error.message;
    }
  }

  function rememberSelection() {
    const selection = window.getSelection();
    if (!selection.rangeCount || selection.isCollapsed || !elements.body.contains(selection.anchorNode)) {
      elements.toolbar.hidden = true;
      return;
    }
    state.savedRange = selection.getRangeAt(0).cloneRange();
    const rect = state.savedRange.getBoundingClientRect();
    elements.toolbar.style.left = `${Math.max(170, Math.min(innerWidth - 170, rect.left + rect.width / 2))}px`;
    elements.toolbar.style.top = `${rect.top}px`;
    elements.toolbar.hidden = false;
  }

  function restoreSelection() {
    if (!state.savedRange) return false;
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(state.savedRange);
    return true;
  }

  function runCommand(command, value) {
    restoreSelection();
    elements.body.focus();
    if (command === "highlight") {
      document.execCommand("hiliteColor", false, "#ffed8b");
    } else {
      document.execCommand(command, false, value || null);
    }
    elements.toolbar.hidden = true;
    scheduleLocalSave();
  }

  function insertHtmlAtSelection(html) {
    restoreSelection();
    elements.body.focus();
    document.execCommand("insertHTML", false, sanitize(html));
    scheduleLocalSave();
  }

  async function uploadImage(file) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast("이미지는 5MB 이하만 올릴 수 있어요."); return; }
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    setSaveState("이미지 올리는 중…");
    try {
      const result = await api("/api/images", {
        method: "POST",
        body: JSON.stringify({ name: file.name, type: file.type, data })
      });
      insertHtmlAtSelection(`<figure><img src="${result.path}" alt=""><figcaption>이미지 설명을 입력하세요</figcaption></figure><p><br></p>`);
      toast("이미지를 넣었어요.");
    } catch (error) {
      toast(error.message);
    } finally {
      setSaveState("작성 중…");
      elements.imageInput.value = "";
    }
  }

  function bindEvents() {
    [elements.title, elements.description].forEach((textarea) => {
      textarea.addEventListener("input", () => { resizeTextarea(textarea); scheduleLocalSave(); });
    });
    elements.body.addEventListener("input", () => { updateCount(); scheduleLocalSave(); });
    document.addEventListener("selectionchange", () => requestAnimationFrame(rememberSelection));

    elements.toolbar.addEventListener("mousedown", (event) => event.preventDefault());
    elements.toolbar.querySelectorAll("[data-command]").forEach((button) => {
      button.addEventListener("click", () => runCommand(button.dataset.command, button.dataset.value));
    });

    $("#linkButton").addEventListener("click", () => {
      if (!state.savedRange) return;
      elements.link.showModal();
      $("#linkUrl").focus();
    });
    $("#linkForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const url = $("#linkUrl").value.trim();
      if (!/^https?:\/\//i.test(url)) { toast("http:// 또는 https:// 주소를 입력해주세요."); return; }
      runCommand("createLink", url);
      elements.link.close();
      $("#linkUrl").value = "";
    });

    $("#settingsButton").addEventListener("click", () => elements.settings.showModal());
    $("#previewButton").addEventListener("click", renderPreview);
    $("#postsButton").addEventListener("click", showPosts);
    $("#newPostButton").addEventListener("click", () => {
      elements.posts.close();
      if (fingerprint() !== state.savedFingerprint || localStorage.getItem(STORAGE_KEY)) {
        $("#discardDialog").showModal();
      } else {
        newDocument();
      }
    });
    $("#confirmNewButton").addEventListener("click", () => newDocument());
    $("#saveButton").addEventListener("click", () => save("save"));
    $("#publishButton").addEventListener("click", () => save("publish"));
    $("#imageButton").addEventListener("click", () => {
      const selection = window.getSelection();
      if (selection.rangeCount && elements.body.contains(selection.anchorNode)) state.savedRange = selection.getRangeAt(0).cloneRange();
      elements.imageInput.click();
    });
    elements.imageInput.addEventListener("change", () => uploadImage(elements.imageInput.files[0]));

    $("#restoreButton").addEventListener("click", () => {
      try {
        const local = JSON.parse(localStorage.getItem(STORAGE_KEY));
        applyDocument(local.document);
        history.replaceState(null, "", local.document.path ? `${location.pathname}?path=${encodeURIComponent(local.document.path)}` : location.pathname);
        setSaveState("복구한 원고");
      } catch { toast("복구할 원고를 읽지 못했어요."); }
      elements.restoreBanner.hidden = true;
    });
    $("#discardButton").addEventListener("click", () => {
      localStorage.removeItem(STORAGE_KEY);
      elements.restoreBanner.hidden = true;
    });

    document.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        save("save");
      }
      if (event.key === "Escape") elements.toolbar.hidden = true;
    });
    window.addEventListener("beforeunload", (event) => {
      if (fingerprint() !== state.savedFingerprint) {
        saveLocal();
        event.preventDefault();
      }
    });
  }

  async function init() {
    bindEvents();
    try {
      await api("/auth/me");
      elements.app.hidden = false;
      const path = new URLSearchParams(location.search).get("path");
      if (path) await loadPost(path);
      else {
        newDocument({ discardLocal: false });
        checkLocalRecovery();
      }
    } catch (error) {
      elements.signIn.hidden = false;
      if (error.status === 503) {
        elements.signIn.querySelector("p").textContent = "편집기 연결 설정을 마무리하고 있어요. 잠시 후 다시 시도해주세요.";
      }
    }
  }

  window.addEventListener("DOMContentLoaded", init);
})();
