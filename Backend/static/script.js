let loginMode = "guest";
let userEmail = null;
let userUserId = null;  // User ID string (A1, C2...) for chat naming (A1.1, A1.2)
let userIsAdmin = false;
var SUPER_ADMIN_EMAIL = "parshant786yadav@gmail.com";
function isSuperAdmin() {
    return !!(userEmail && (userEmail + "").trim().toLowerCase() === SUPER_ADMIN_EMAIL);
}
let dbData = null;  // admin database view data
let chats = [];
let currentChat = null;
let globalDocuments = [];
let chatDocuments = {};
let companyDocuments = [];  // HR company docs (same-domain users access via chat only)
var API_BASE = (window.location.protocol === "http:" || window.location.protocol === "https:") ? "" : "http://localhost:8000";

/* ---------------- LOADERS ---------------- */
function showChatListLoader() {
    var chatList = document.getElementById("chatList");
    if (chatList) chatList.innerHTML = '<li class="chat-list-loading"><span class="chat-loader-dot"></span><span class="chat-loader-dot"></span><span class="chat-loader-dot"></span></li>';
}

function showChatAreaLoader() {
    var chatArea = document.getElementById("chatArea");
    if (chatArea) chatArea.innerHTML = '<div class="chat-area-loading"><span class="chat-loader-dot"></span><span class="chat-loader-dot"></span><span class="chat-loader-dot"></span></div>';
}

function hideChatAreaLoader() {
    var chatArea = document.getElementById("chatArea");
    if (chatArea) chatArea.innerHTML = "";
}

function prefersReducedMotion() {
    try {
        return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch (e) {
        return false;
    }
}

function scrollChatToBottomSmooth() {
    var el = document.getElementById("chatArea");
    if (!el) return;
    if (prefersReducedMotion()) {
        el.scrollTop = el.scrollHeight;
        return;
    }
    try {
        el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    } catch (e) {
        el.scrollTop = el.scrollHeight;
    }
}

/* ---------------- TOASTS & CONFIRM (in-app; no browser alert/confirm) ---------------- */
var TOAST_ICONS = {
    success: "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M20 6L9 17l-5-5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>",
    error: "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><circle cx=\"12\" cy=\"12\" r=\"10\"/><path d=\"M15 9l-6 6M9 9l6 6\" stroke-linecap=\"round\"/></svg>",
    warning: "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M12 9v4M12 17h.01\" stroke-linecap=\"round\"/><path d=\"M10.3 3.2L1.8 18.5c-.5 1 .1 2.2 1.2 2.2h18c1.1 0 1.7-1.2 1.2-2.2L13.7 3.2c-.5-1-1.1-1-1.4-1s-.9 0-1.4 1z\" stroke-linejoin=\"round\"/></svg>",
    info: "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><circle cx=\"12\" cy=\"12\" r=\"10\"/><path d=\"M12 16v-4M12 8h.01\" stroke-linecap=\"round\"/></svg>"
};

function toast(message, type) {
    type = type || "info";
    var container = document.getElementById("toastContainer");
    if (!container || message == null || message === "") return;
    var el = document.createElement("div");
    el.className = "toast toast--" + type;
    el.setAttribute("role", "status");
    var iconEl = document.createElement("span");
    iconEl.className = "toast-icon";
    iconEl.innerHTML = TOAST_ICONS[type] || TOAST_ICONS.info;
    var msgEl = document.createElement("span");
    msgEl.className = "toast-message";
    msgEl.textContent = String(message);
    var dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.className = "toast-dismiss";
    dismiss.setAttribute("aria-label", "Dismiss");
    dismiss.innerHTML = "&times;";
    el.appendChild(iconEl);
    el.appendChild(msgEl);
    el.appendChild(dismiss);
    container.appendChild(el);
    requestAnimationFrame(function () { el.classList.add("toast--visible"); });
    var duration = type === "error" ? 6500 : 5000;
    var timer = setTimeout(function () { removeToast(el); }, duration);
    dismiss.onclick = function () {
        clearTimeout(timer);
        removeToast(el);
    };
}

function removeToast(el) {
    if (!el || !el.parentNode) return;
    el.classList.remove("toast--visible");
    el.classList.add("toast--out");
    var ms = prefersReducedMotion() ? 0 : 280;
    setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el);
    }, ms);
}

function confirmDialog(message, opts) {
    opts = opts || {};
    var confirmLabel = opts.confirmLabel || "Confirm";
    var cancelLabel = opts.cancelLabel || "Cancel";
    var danger = !!opts.danger;
    return new Promise(function (resolve) {
        var overlay = document.getElementById("confirmDialog");
        if (!overlay) {
            resolve(false);
            return;
        }
        var msgEl = document.getElementById("confirmDialogMessage");
        var okBtn = document.getElementById("confirmDialogOk");
        var cancelBtn = document.getElementById("confirmDialogCancel");
        var backdrop = overlay.querySelector(".confirm-dialog-backdrop");
        if (!msgEl || !okBtn || !cancelBtn || !backdrop) {
            resolve(false);
            return;
        }
        msgEl.textContent = String(message);
        okBtn.textContent = confirmLabel;
        cancelBtn.textContent = cancelLabel;
        okBtn.classList.remove("confirm-dialog-btn--primary", "confirm-dialog-btn--danger");
        if (danger) {
            okBtn.classList.add("confirm-dialog-btn--danger");
        } else {
            okBtn.classList.add("confirm-dialog-btn--primary");
        }
        var finished = false;
        function end(val) {
            if (finished) return;
            finished = true;
            overlay.classList.add("hidden");
            overlay.setAttribute("aria-hidden", "true");
            document.removeEventListener("keydown", onKey);
            document.body.style.overflow = "";
            okBtn.onclick = null;
            cancelBtn.onclick = null;
            backdrop.onclick = null;
            resolve(val);
        }
        function onKey(e) {
            if (e.key === "Escape") end(false);
        }
        okBtn.onclick = function () { end(true); };
        cancelBtn.onclick = function () { end(false); };
        backdrop.onclick = function () { end(false); };
        document.addEventListener("keydown", onKey);
        document.body.style.overflow = "hidden";
        overlay.classList.remove("hidden");
        overlay.setAttribute("aria-hidden", "false");
    });
}

/* ---------------- PROFILE DROPDOWN ---------------- */

function toggleProfileDropdown(event) {
    if (event) event.stopPropagation();
    var box = document.getElementById("profileBox");
    if (!box) return;
    box.classList.toggle("open");
    var trigger = document.getElementById("profileTrigger");
    if (trigger) trigger.setAttribute("aria-expanded", box.classList.contains("open"));
    if (box.classList.contains("open")) {
        document.addEventListener("click", closeProfileDropdownOnClickOutside);
    } else {
        document.removeEventListener("click", closeProfileDropdownOnClickOutside);
    }
}

function closeProfileDropdownOnClickOutside(e) {
    var box = document.getElementById("profileBox");
    var trigger = document.getElementById("profileTrigger");
    if (box && trigger && !box.contains(e.target)) {
        closeProfileDropdown();
    }
}

function closeProfileDropdown() {
    var box = document.getElementById("profileBox");
    if (box) {
        box.classList.remove("open");
        document.removeEventListener("click", closeProfileDropdownOnClickOutside);
    }
    var trigger = document.getElementById("profileTrigger");
    if (trigger) trigger.setAttribute("aria-expanded", "false");
}

/* ---------------- MOBILE SIDEBAR ---------------- */

function toggleSidebar() {
    var layout = document.getElementById("layout");
    if (layout) layout.classList.toggle("sidebar-open");
}

function closeSidebar() {
    var layout = document.getElementById("layout");
    if (layout) layout.classList.remove("sidebar-open");
}

(function setupSidebarOverlay() {
    var overlay = document.getElementById("sidebarOverlay");
    if (overlay) overlay.addEventListener("click", closeSidebar);
})();

function changePhoto() {
    var input = document.getElementById("photoUpload");
    if (!input || !input.files || !input.files.length) return;
    var file = input.files[0];
    if (!file.type || !file.type.startsWith("image/")) {
        toast("Please choose an image file (e.g. JPG, PNG).", "warning");
        input.value = "";
        return;
    }
    var reader = new FileReader();
    reader.onload = function () {
        var profileImg = document.getElementById("profilePhoto");
        if (profileImg && reader.result) {
            profileImg.src = reader.result;
            if (userEmail) {
                try { localStorage.setItem("profilePhoto_" + userEmail, reader.result); } catch (e) {}
            }
        }
    };
    reader.readAsDataURL(file);
    input.value = "";
}

function loadSavedProfilePhoto() {
    if (!userEmail) return;
    var profileImg = document.getElementById("profilePhoto");
    if (!profileImg) return;
    try {
        var saved = localStorage.getItem("profilePhoto_" + userEmail);
        if (saved) profileImg.src = saved;
    } catch (e) {}
}

/* ---------------- LOGIN POPUP ---------------- */

var loginPopupMode = "personal";  // "personal" or "company"

function openLoginPopup() {
    closeSidebar();
    var popup = document.getElementById("loginPopup");
    if (popup) popup.classList.add("is-open");
    document.body.style.overflow = "hidden";
    showLoginStep1();
}

function closeLoginPopup() {
    var popup = document.getElementById("loginPopup");
    if (popup) popup.classList.remove("is-open");
    document.body.style.overflow = "";
}

function showLoginStep1() {
    document.getElementById("loginStep1").style.display = "block";
    document.getElementById("loginStep2").style.display = "none";
}

function resetOtpStep() {
    document.getElementById("loginOtpSection").style.display = "none";
    document.getElementById("loginOtpInput").value = "";
    var btn = document.getElementById("loginEmailBtn");
    btn.textContent = "Send verification code";
    btn.onclick = doSendOtp;
}

function showPersonalLogin() {
    loginPopupMode = "personal";
    document.getElementById("loginStep1").style.display = "none";
    document.getElementById("loginStep2").style.display = "block";
    document.getElementById("loginStep2Title").textContent = "Personal sign in";
    var hint = document.getElementById("loginStep2Hint");
    if (hint) hint.textContent = "We’ll email you a one-time code — no password to remember.";
    document.getElementById("loginEmailInput").placeholder = "you@example.com";
    document.getElementById("loginEmailInput").value = "";
    resetOtpStep();
    var input = document.getElementById("loginEmailInput");
    input.onkeydown = function (e) { if (e.key === "Enter") { e.preventDefault(); doSendOtp(); } };
    input.focus();
}

function showCompanyLogin() {
    loginPopupMode = "company";
    document.getElementById("loginStep1").style.display = "none";
    document.getElementById("loginStep2").style.display = "block";
    document.getElementById("loginStep2Title").textContent = "Company sign in";
    var hint = document.getElementById("loginStep2Hint");
    if (hint) hint.textContent = "Use your work email. We’ll send a code to verify your organization.";
    document.getElementById("loginEmailInput").placeholder = "you@company.com";
    document.getElementById("loginEmailInput").value = "";
    resetOtpStep();
    var input = document.getElementById("loginEmailInput");
    input.onkeydown = function (e) { if (e.key === "Enter") { e.preventDefault(); doSendOtp(); } };
    input.focus();
}

async function doSendOtp() {
    var email = (document.getElementById("loginEmailInput").value || "").trim();
    if (!email || !email.includes("@")) {
        toast(loginPopupMode === "company" ? "Enter a valid company email." : "Enter a valid email.", "warning");
        return;
    }
    var btn = document.getElementById("loginEmailBtn");
    btn.disabled = true;
    btn.textContent = "Sending...";
    try {
        var res = await fetch(API_BASE + "/auth/send-otp", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: email })
        });
        var data = await res.json().catch(function () { return {}; });
        if (!res.ok) {
            toast(data.detail || "Failed to send OTP.", "error");
            btn.disabled = false;
            btn.textContent = "Send verification code";
            return;
        }
        document.getElementById("loginOtpSection").style.display = "block";
        btn.textContent = "Resend code";
        btn.onclick = doSendOtp;
        btn.disabled = false;
        document.getElementById("loginOtpInput").value = "";
        document.getElementById("loginOtpInput").focus();
        document.getElementById("loginVerifyOtpBtn").onclick = doVerifyOtp;
        document.getElementById("loginOtpInput").onkeydown = function (e) {
            if (e.key === "Enter") { e.preventDefault(); doVerifyOtp(); }
        };
    } catch (e) {
        console.error(e);
        toast("Failed to send OTP. Check your connection.", "error");
        btn.disabled = false;
        btn.textContent = "Send verification code";
    }
}

async function doVerifyOtp() {
    var email = (document.getElementById("loginEmailInput").value || "").trim();
    var otp = (document.getElementById("loginOtpInput").value || "").trim();
    if (!email || !email.includes("@")) {
        toast("Enter a valid email first.", "warning");
        return;
    }
    if (!otp || otp.length < 4) {
        toast("Enter the 6-digit code from your email.", "warning");
        return;
    }
    try {
        var res = await fetch(API_BASE + "/auth/verify-otp", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: email, otp: otp, mode: loginPopupMode || "personal" })
        });
        var data = await res.json().catch(function () { return {}; });
        if (!res.ok) {
            toast(data.detail || "Invalid or expired code.", "error");
            return;
        }
        // Save whatever user typed in chat before login
        var pendingMsg = "";
        try { 
            var msgInput = document.getElementById("messageInput");
            if (msgInput) pendingMsg = msgInput.value || "";
        } catch(e) {}
        closeLoginPopup();
        if (loginPopupMode === "personal") {
            loginMode = "personal";
            userEmail = email;
            try { localStorage.setItem("userEmail", email); localStorage.setItem("loginMode", "personal"); } catch(e) {}
            applyPersonalLoginUI(email);
        } else {
            loginMode = "company";
            userEmail = email;
            try { localStorage.setItem("userEmail", email); localStorage.setItem("loginMode", "company"); } catch(e) {}
            applyCompanyLoginUI(email);
        }
        loadSavedProfilePhoto();
        var claimed = await claimGuestChatIfAny(email);
        if (!claimed) loadUserData(email);
        // Restore pending message after login
        try {
            if (pendingMsg) {
                var msgInput = document.getElementById("messageInput");
                if (msgInput) msgInput.value = pendingMsg;
            }
        } catch(e) {}
    } catch (e) {
        console.error(e);
        toast("Verification failed. Check your connection.", "error");
    }
    
}

// Restore session from localStorage on page load
// Restore session from localStorage on page load
(function restoreSession() {
    function doRestore() {
        try {
            // Reset guest count if no active guest chat
            if (!localStorage.getItem("documind_guest_chat_id")) {
                localStorage.removeItem("documind_guest_msg_count");
            }

            if (localStorage.getItem("loggedOut") === "1") {
                localStorage.removeItem("loggedOut");
                return;
            }

            var savedEmail = localStorage.getItem("userEmail");
            var savedMode = localStorage.getItem("loginMode") || "personal";
            if (!savedEmail) return;

            userEmail = savedEmail;
            loginMode = savedMode;

            if (savedMode === "company") {
                applyCompanyLoginUI(savedEmail);
            } else {
                applyPersonalLoginUI(savedEmail);
            }

            loadSavedProfilePhoto();

            var savedChat = localStorage.getItem("currentChat");
            loadUserData(savedEmail).then(function() {
                if (savedChat && chats.indexOf(savedChat) !== -1) {
                    selectChat(savedChat);
                }
            });

        } catch(e) {}
    }
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", doRestore);
    } else {
        doRestore();
    }
})();

function googleLoginFromPopup() {
    closeLoginPopup();
    // Save pending message before redirect
    try {
        var msgInput = document.getElementById("messageInput");
        if (msgInput && msgInput.value) {
            localStorage.setItem("pendingMsg", msgInput.value);
        }
    } catch(e) {}
    googleLogin();
}

/* ================= LOAD USER DATA ================= */

async function loadUserData(email) {
    try {
        // Fetch user_id (A1, C2, etc.) for profile and chat naming
        try {
            var infoRes = await fetch(API_BASE + "/user-info?email=" + encodeURIComponent(email));
            var info = await infoRes.json();
            userUserId = info.user_id || null;
            userIsAdmin = !!info.is_admin;
            var dispEl = document.getElementById("profileUserId");
            if (dispEl) dispEl.textContent = userUserId || "--";
            var adminSec = document.getElementById("adminSection");
            if (adminSec) adminSec.style.display = userIsAdmin ? "block" : "none";
        } catch (e) {
            console.error("Failed to load user info", e);
        }

        // Load chats
        showChatListLoader();
        const chatRes = await fetch(API_BASE + "/chats/" + encodeURIComponent(email));
        const chatData = await chatRes.json();
        chats = (chatData.chats || []).map(function (c) { return typeof c === "string" ? c : c.name; });
        renderChats();

        // Load global documents (only for personal mode) - backend returns only global (chat_id null)
        if (loginMode === "personal") {
            const docRes = await fetch(`${API_BASE}/documents/${email}`);
            const docData = await docRes.json();
            const docList = docData.documents || [];
            globalDocuments = docList.map(function (d) { return { id: d.id, name: d.name, file: null, has_preview: d.has_preview }; });
            renderGlobalDocs();
        }
        // Load company documents for HR (company mode, hr@...)
        if (loginMode === "company" && email && email.trim().toLowerCase().startsWith("hr@")) {
            try {
                const companyRes = await fetch(`${API_BASE}/documents/company/${encodeURIComponent(email)}`);
                const companyData = await companyRes.json();
                companyDocuments = (companyData.documents || []).map(function (d) { return { id: d.id, name: d.name, has_preview: d.has_preview }; });
                renderCompanyDocs();
                var setRes = await fetch(`${API_BASE}/company/settings?email=${encodeURIComponent(email)}`);
                var setData = await setRes.json().catch(function () { return {}; });
                var check = document.getElementById("companyShowCountCheck");
                if (check) check.checked = !!setData.show_doc_count_to_employees;
            } catch (e) {
                companyDocuments = [];
            }
        }
        // Load company document count for employees (when HR enabled "show count to employees")
        if (loginMode === "company" && email && !email.trim().toLowerCase().startsWith("hr@")) {
            try {
                const countRes = await fetch(`${API_BASE}/documents/company/count?email=${encodeURIComponent(email)}`);
                const countData = await countRes.json().catch(function () { return {}; });
                var countEl = document.getElementById("companyDocCountEmployee");
                if (countEl && countData.visible) {
                    countEl.textContent = "Company documents: " + (countData.count || 0);
                    countEl.style.display = "block";
                }
            } catch (e) {}
        }

        if (loginMode === "personal") {
            const chatNames = chats.slice();
            await Promise.all(
                chatNames.map(function (chatName) {
                    return fetch(`${API_BASE}/documents/${email}/${encodeURIComponent(chatName)}`)
                        .then(function (r) { return r.json(); })
                        .then(function (chatDocData) {
                            const chatDocList = chatDocData.documents || [];
                            chatDocuments[chatName] = chatDocList.map(function (d) {
                                return { id: d.id, name: d.name, file: null, has_preview: d.has_preview };
                            });
                        })
                        .catch(function (err) {
                            console.error("Error loading docs for chat " + chatName, err);
                            chatDocuments[chatName] = chatDocuments[chatName] || [];
                        });
                })
            );
        }

    } catch (error) {
        console.error("Error loading user data:", error);
    }
}


/* ================= PERSONAL / COMPANY LOGIN UI ================= */

function applyPersonalLoginUI(email) {
    document.getElementById("loginBtn").style.display = "none";
    document.getElementById("profileBox").style.display = "block";
    var nameEl = document.getElementById("profileName");
    nameEl.textContent = email;
    nameEl.title = email;
    document.getElementById("documentSection").style.display = "block";
    document.getElementById("documentSectionTitle").textContent = "Global Documents";
    document.getElementById("documentUploadWrap").style.display = "block";
    document.getElementById("globalDocsBlock").style.display = "block";
    var companyDocsBlock = document.getElementById("companyDocsBlock");
    if (companyDocsBlock) companyDocsBlock.style.display = "none";
    var companyShowCountWrap = document.getElementById("companyShowCountWrap");
    if (companyShowCountWrap) companyShowCountWrap.style.display = "none";
    document.getElementById("companyDocCountEmployee").style.display = "none";
    document.getElementById("companyDocHintHr").style.display = "none";
    document.getElementById("companyDocHintEmployee").style.display = "none";
    var panel = document.getElementById("chatDocsPanel");
    if (panel) panel.style.display = "block";
    renderChatDocs();
}

function applyCompanyLoginUI(email) {
    document.getElementById("loginBtn").style.display = "none";
    document.getElementById("profileBox").style.display = "block";
    var nameEl = document.getElementById("profileName");
    nameEl.textContent = email;
    nameEl.title = email;
    document.getElementById("documentSection").style.display = "block";
    document.getElementById("documentSectionTitle").textContent = "Company Documents";
    document.getElementById("globalDocsBlock").style.display = "none";
    var isHr = email && String(email).trim().toLowerCase().startsWith("hr@");
    document.getElementById("documentUploadWrap").style.display = isHr ? "block" : "none";
    document.getElementById("companyDocHintHr").style.display = isHr ? "block" : "none";
    var companyShowCountWrap = document.getElementById("companyShowCountWrap");
    if (companyShowCountWrap) companyShowCountWrap.style.display = isHr ? "block" : "none";
    var companyDocsBlock = document.getElementById("companyDocsBlock");
    if (companyDocsBlock) companyDocsBlock.style.display = isHr ? "block" : "none";
    document.getElementById("companyDocCountEmployee").style.display = "none";
    document.getElementById("companyDocHintEmployee").style.display = isHr ? "none" : "block";
    var panel = document.getElementById("chatDocsPanel");
    if (panel) panel.style.display = "none";
}

function logout() {
    closeProfileDropdown();
    loginMode = "guest";
    userEmail = null;
    clearGuestSession();
try { localStorage.removeItem("currentChat"); } catch(e) {}

try { 
    localStorage.removeItem("userEmail"); 
    localStorage.removeItem("loginMode"); 
    localStorage.setItem("loggedOut", "1");
    sessionStorage.clear();
} catch(e) {}
history.replaceState({}, document.title, window.location.pathname || "/");
    document.getElementById("loginBtn").style.display = "block";
    document.getElementById("profileBox").style.display = "none";

    chats = [];
    globalDocuments = [];
    chatDocuments = {};
    companyDocuments = [];
    currentChat = null;

    document.getElementById("chatList").innerHTML = "";
    document.getElementById("chatArea").innerHTML = "";
    document.getElementById("chatTitle").innerText = "DocuMind";
    var panel = document.getElementById("chatDocsPanel");
    if (panel) panel.style.display = "block";
    /* Keep sidebar same as after login: show Global Documents section */
    document.getElementById("documentSection").style.display = "block";
    document.getElementById("documentSectionTitle").textContent = "Global Documents";
    document.getElementById("documentUploadWrap").style.display = "block";
    document.getElementById("globalDocsBlock").style.display = "block";
    var companyDocsBlock = document.getElementById("companyDocsBlock");
    if (companyDocsBlock) companyDocsBlock.style.display = "none";
    var companyShowCountWrap = document.getElementById("companyShowCountWrap");
    if (companyShowCountWrap) companyShowCountWrap.style.display = "none";
    document.getElementById("companyDocCountEmployee").style.display = "none";
    document.getElementById("companyDocHintHr").style.display = "none";
    document.getElementById("companyDocHintEmployee").style.display = "none";
    showStartView();
    userUserId = null;
    userIsAdmin = false;
    var dispEl = document.getElementById("profileUserId");
    if (dispEl) dispEl.textContent = "--";
    var adminSec = document.getElementById("adminSection");
    if (adminSec) adminSec.style.display = "none";
    closeDatabaseView();
    renderGlobalDocs();
}

/* ---------------- GUEST CHAT (2 messages without login) ---------------- */

var GUEST_CHAT_STORAGE_KEY = "documind_guest_chat_id";
var GUEST_COUNT_STORAGE_KEY = "documind_guest_msg_count";

function getOrCreateGuestChatId() {
    try {
        var id = localStorage.getItem(GUEST_CHAT_STORAGE_KEY);
        if (id) return id;
        var uuid = "guest-" + crypto.randomUUID();
        localStorage.setItem(GUEST_CHAT_STORAGE_KEY, uuid);
        return uuid;
    } catch (e) {
        return "guest-" + Date.now() + "-" + Math.random().toString(36).slice(2);
    }
}

function getGuestMessageCount() {
    try {
        var n = parseInt(localStorage.getItem(GUEST_COUNT_STORAGE_KEY), 10);
        return isNaN(n) ? 0 : n;
    } catch (e) {
        return 0;
    }
}

function setGuestMessageCount(n) {
    try {
        localStorage.setItem(GUEST_COUNT_STORAGE_KEY, String(n));
    } catch (e) {}
}

function clearGuestSession() {
    try {
        localStorage.removeItem(GUEST_CHAT_STORAGE_KEY);
        localStorage.removeItem(GUEST_COUNT_STORAGE_KEY);
    } catch (e) {}
}

/** If user had a guest chat, claim it so all messages get the user's display_id and chat is renamed to "Chat 1". No message reload to avoid refresh. Call after successful login. Returns true if a chat was claimed. */
async function claimGuestChatIfAny(email) {
    try {
        var guestChatId = localStorage.getItem(GUEST_CHAT_STORAGE_KEY);
        if (!guestChatId) return false;
        var res = await fetch(API_BASE + "/chats/claim", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ guest_chat_name: guestChatId, email: email })
        });
        if (!res.ok) return false;
        var data = await res.json().catch(function () { return {}; });
        clearGuestSession();
        var newName = (data.name && data.name.trim()) ? data.name.trim() : guestChatId;

        currentChat = newName;
        try { localStorage.setItem("currentChat", newName); } catch(e) {}
        document.getElementById("chatTitle").innerText = newName;
        // Keep existing messages in the DOM — no reload (server already has them after claim).
        var gi = chats.indexOf(guestChatId);
        if (gi !== -1) chats[gi] = newName;
        else if (chats.indexOf(newName) === -1) chats.unshift(newName);
        renderChats();

        try {
            var infoRes = await fetch(API_BASE + "/user-info?email=" + encodeURIComponent(email));
            var info = await infoRes.json();
            userUserId = info.user_id || null;
            userIsAdmin = !!info.is_admin;
            var dispEl = document.getElementById("profileUserId");
            if (dispEl) dispEl.textContent = userUserId || "--";
            var adminSec = document.getElementById("adminSection");
            if (adminSec) adminSec.style.display = userIsAdmin ? "block" : "none";
        } catch (e) {
            console.error("Failed to load user info after claim", e);
        }

        loadUserData(email).catch(function (err) {
            console.error("Error loading user data after guest claim", err);
        });
        return true;
    } catch (e) {
        console.error("Claim guest chat error", e);
        clearGuestSession();
        return false;
    }
}

/** Load messages for currentChat from server and re-render. Used after claiming guest chat so messages show under user. */
async function loadMessagesForCurrentChat() {
    if (!currentChat || !userEmail) return;
    var chatArea = document.getElementById("chatArea");
    if (!chatArea) return;
    chatArea.innerHTML = "";
    try {
        var res = await fetch(
            API_BASE + "/messages/" + encodeURIComponent(userEmail) + "/" + encodeURIComponent(currentChat)
        );
        var data = await res.json();
        var messages = data.messages || [];
        messages.forEach(function (msg) {
            addMessage(msg.content, msg.role);
        });
        if (messages.length > 0) {
            showChatView();
        } else {
            showStartView();
        }
    } catch (e) {
        console.error("Error loading messages for current chat", e);
        showStartView();
    }
}

/* ---------------- CHAT LOGIC ---------------- */

/** Creates a new chat on server and in local state. Returns the new chat name or null on failure. Does not select it. */
async function createNewChatAndReturnName() {
    if (!userEmail) return null;
    if (!userUserId) {
        try {
            var r = await fetch(API_BASE + "/user-info?email=" + encodeURIComponent(userEmail));
            var info = await r.json();
            userUserId = info.user_id || null;
            var dispEl = document.getElementById("profileUserId");
            if (dispEl) dispEl.textContent = userUserId || "--";
        } catch (e) {}
    }
    var n = 1;
    while (chats.indexOf("New Chat " + n) !== -1) n++;
    var chatName = "New Chat " + n;
    try {
        var createRes = await fetch(API_BASE + "/chats", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: userEmail, name: chatName, mode: loginMode || "personal" })
        });
        var createData = await createRes.json();
        if (!createRes.ok && createRes.status !== 200) return null;
    } catch (err) {
        console.error("Create chat error", err);
        return null;
    }
    chats.push(chatName);
    chatDocuments[chatName] = [];
    return chatName;
}

async function createChat() {
    if (!userEmail) {
        toast("Please sign in first.", "info");
        return;
    }
    var chatName = await createNewChatAndReturnName();
    if (!chatName) {
        toast("Could not create chat. Is the backend running?", "error");
        return;
    }
    renderChats();
    await selectChat(chatName);
}

function renderChats() {
    const chatList = document.getElementById("chatList");
    chatList.innerHTML = "";

    chats.forEach(chat => {
        const li = document.createElement("li");
        li.className = "chat-list-item" + (chat === currentChat ? " chat-list-item-active" : "");
        li.setAttribute("data-chat-name", chat);

        const nameWrap = document.createElement("span");
        nameWrap.className = "chat-name-wrap";
        const nameSpan = document.createElement("span");
        nameSpan.className = "chat-name-text";
        nameSpan.textContent = (chat && String(chat).indexOf("guest-") === 0) ? "Guest chat" : chat;
        nameWrap.appendChild(nameSpan);

        const actions = document.createElement("div");
        actions.className = "chat-item-actions";
        const menuBtn = document.createElement("button");
        menuBtn.type = "button";
        menuBtn.className = "chat-menu-btn";
        menuBtn.setAttribute("aria-label", "Chat options");
        menuBtn.innerHTML = "&#8942;";
        const dropdown = document.createElement("div");
        dropdown.className = "chat-menu-dropdown";
        dropdown.setAttribute("role", "menu");
        const renameBtn = document.createElement("button");
        renameBtn.type = "button";
        renameBtn.className = "chat-menu-rename";
        renameBtn.textContent = "Rename";
        renameBtn.setAttribute("role", "menuitem");
        dropdown.appendChild(renameBtn);
        actions.appendChild(menuBtn);
        actions.appendChild(dropdown);

        li.appendChild(nameWrap);
        li.appendChild(actions);

        nameWrap.onclick = function (e) { e.stopPropagation(); selectChat(chat); };
        menuBtn.onclick = function (e) {
            e.stopPropagation();
            closeAllChatMenus();
            dropdown.classList.toggle("open");
        };
        renameBtn.onclick = function (e) {
            e.stopPropagation();
            dropdown.classList.remove("open");
            startRenameChat(li, chat, nameSpan);
        };

        chatList.appendChild(li);
    });
}

function closeAllChatMenus() {
    document.querySelectorAll(".chat-menu-dropdown.open").forEach(function (el) { el.classList.remove("open"); });
}

function startRenameChat(li, oldName, nameSpan) {
    const input = document.createElement("input");
    input.type = "text";
    input.className = "chat-name-edit";
    input.value = oldName;
    const wrap = li.querySelector(".chat-name-wrap");
    wrap.replaceChild(input, nameSpan);
    input.focus();
    input.select();

    function finishRename() {
        const newName = input.value.trim();
        wrap.removeChild(input);
        const span = document.createElement("span");
        span.className = "chat-name-text";
        span.textContent = newName ? newName : oldName;
        wrap.appendChild(span);
        span.onclick = function (e) { e.stopPropagation(); selectChat(newName || oldName); };

        if (newName && newName !== oldName) {
            renameChatOnServer(oldName, newName);
        }
        input.removeEventListener("blur", finishRename);
        input.removeEventListener("keydown", onKey);
    }

    function onKey(e) {
        if (e.key === "Enter") { e.preventDefault(); finishRename(); }
        if (e.key === "Escape") {
            e.preventDefault();
            input.value = oldName;
            finishRename();
        }
    }

    input.addEventListener("blur", finishRename);
    input.addEventListener("keydown", onKey);
}

async function renameChatOnServer(oldName, newName) {
    if (!userEmail) return;
    try {
        const res = await fetch(API_BASE + "/chats/rename", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: userEmail, old_name: oldName, new_name: newName })
        });
        const data = await res.json();
        if (res.ok && data.ok) {
            const idx = chats.indexOf(oldName);
            if (idx !== -1) chats[idx] = newName;
            if (currentChat === oldName) {
                currentChat = newName;
                document.getElementById("chatTitle").innerText = newName;
            }
            if (chatDocuments[oldName] !== undefined) {
                chatDocuments[newName] = chatDocuments[oldName];
                delete chatDocuments[oldName];
            }
            renderChats();
        } else {
            const msg = Array.isArray(data.detail) ? data.detail.map(function (x) { return x.msg || x; }).join(" ") : (data.detail || "Rename failed");
            toast(msg, "error");
        }
    } catch (err) {
        console.error("Rename error", err);
        toast("Rename failed. Is the backend running?", "error");
    }
}

async function selectChat(chatName) {
    closeSidebar();
    closeDatabaseView();
    currentChat = chatName;
    try { localStorage.setItem("currentChat", chatName); } catch(e) {}
    document.getElementById("chatTitle").innerText = chatName;
    document.getElementById("chatArea").innerHTML = "";
    renderChats();

    // Show chat documents panel (header right) for guest and personal; hide for company
    var panel = document.getElementById("chatDocsPanel");
    if (panel) panel.style.display = (loginMode === "company") ? "none" : "block";
    if (loginMode === "personal" && panel) {
        // If we don't have this chat's docs yet (e.g. new chat), fetch from API
        if (!chatDocuments[chatName]) {
            try {
                const chatDocRes = await fetch(`${API_BASE}/documents/${userEmail}/${encodeURIComponent(chatName)}`);
                const chatDocData = await chatDocRes.json();
                const chatDocList = chatDocData.documents || [];
                chatDocuments[chatName] = chatDocList.map(function (d) { return { id: d.id, name: d.name, file: null, has_preview: d.has_preview }; });
            } catch (err) {
                console.error("Error loading docs for chat", err);
                chatDocuments[chatName] = [];
            }
        }
        renderChatDocs();
    }

    try {
        const res = await fetch(
            API_BASE + "/messages/" + encodeURIComponent(userEmail) + "/" + encodeURIComponent(chatName)
        );

        const data = await res.json();
        var messages = data.messages || [];

        messages.forEach(msg => {
            addMessage(msg.content, msg.role);
        });

        if (messages.length > 0) {
            showChatView();
        } else {
            showStartView();
        }
    } catch (error) {
        console.error("Error loading messages:", error);
        showStartView();
    }
}

/* ---------------- DOCUMENTS (PERSONAL MODE ONLY) ---------------- */

function uploadGlobal() {
    if (loginMode !== "personal") return;
    const file = document.getElementById("globalUpload").files[0];
    if (!file) return;
    globalDocuments.push({ name: file.name, file: file });
    renderGlobalDocs();
    document.getElementById("globalUpload").value = "";
}

async function uploadChatDoc() {
    if (!userEmail) {
        toast("Please sign in to upload documents.", "info");
        return;
    }
    if (loginMode !== "personal") return;
    if (!currentChat) {
        toast("Select a chat first.", "info");
        return;
    }
    const fileInput = document.getElementById("chatUpload");
    const file = fileInput.files[0];
    if (!file) return;
    var ok = file.type === "application/pdf" || (file.type && file.type.indexOf("image/") === 0);
    if (!ok) {
        toast("Only PDF and images (JPG, PNG, GIF, etc.) are supported.", "warning");
        return;
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append("email", userEmail || "guest");
    formData.append("chat", currentChat);
    formData.append("mode", loginMode === "company" ? "company" : "personal");

    try {
        const response = await fetch(API_BASE + "/upload", {
            method: "POST",
            body: formData
        });
        const data = await response.json();
        if (data.error) {
            toast(data.error, "error");
            return;
        }
        chatDocuments[currentChat] = chatDocuments[currentChat] || [];
        chatDocuments[currentChat].push({ id: data.document_id, name: file.name, file: file, has_preview: true });
        renderChatDocs();
        fileInput.value = "";
        if (data.message) toast(data.message, "success");
    } catch (err) {
        console.error("Chat document upload error:", err);
        toast("Upload failed. Is the backend running?", "error");
    }
}

function openDocPreview(doc) {
    if (!doc) return;
    if ((doc.id && doc.has_preview !== false) && userEmail) {
        var url = API_BASE + "/documents/file/" + doc.id + "?email=" + encodeURIComponent(userEmail);
        window.open(url, "_blank", "noopener");
        return;
    }
    if (doc.file) {
        var blobUrl = URL.createObjectURL(doc.file);
        window.open(blobUrl, "_blank", "noopener");
        setTimeout(function () { URL.revokeObjectURL(blobUrl); }, 60000);
        return;
    }
    toast("Preview is not available for this document.", "info");
}

function toggleGlobalDocsList() {
    var list = document.getElementById("globalDocs");
    list.classList.toggle("doc-list-collapsed");
}

function toggleChatDocsList() {
    var list = document.getElementById("chatDocs");
    list.classList.toggle("doc-list-collapsed");
}

function renderGlobalDocs() {
    var list = document.getElementById("globalDocs");
    var toggleBtn = document.getElementById("globalDocsToggle");
    if (!list || !toggleBtn) return;
    var n = globalDocuments.length;
    toggleBtn.textContent = "Documents uploaded " + n;
    list.innerHTML = "";
    list.classList.add("doc-list-collapsed");
    globalDocuments.forEach(function (doc) {
        var li = document.createElement("li");
        li.className = "doc-item";
        var link = document.createElement("a");
        link.className = "doc-link";
        link.textContent = doc.name;
        link.title = (doc.has_preview || doc.file || (doc.id && doc.has_preview !== false)) ? "Open preview" : "Preview not available";
        link.href = "#";
        link.onclick = function (e) {
            e.preventDefault();
            openDocPreview(doc);
        };
        var removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "doc-remove-btn";
        removeBtn.innerHTML = "&times;";
        removeBtn.title = "Remove document";
        removeBtn.onclick = function (e) {
            e.stopPropagation();
            removeGlobalDoc(doc.id);
        };
        li.appendChild(link);
        li.appendChild(removeBtn);
        list.appendChild(li);
    });
}

async function removeGlobalDoc(docId) {
    if (!(await confirmDialog("Remove this document from your library?", { confirmLabel: "Remove", cancelLabel: "Cancel", danger: true }))) return;
    if (!userEmail) return;
    try {
        var res = await fetch(API_BASE + "/documents/" + docId + "?email=" + encodeURIComponent(userEmail), { method: "DELETE" });
        if (!res.ok) {
            var data = await res.json().catch(function () { return {}; });
            toast(data.detail || "Could not delete document.", "error");
            return;
        }
    } catch (e) {
        console.error(e);
        toast("Could not delete document.", "error");
        return;
    }
    globalDocuments = globalDocuments.filter(function (d) { return d.id !== docId; });
    renderGlobalDocs();
    toast("Document removed.", "success");
}

function toggleCompanyDocsList() {
    var list = document.getElementById("companyDocsList");
    if (list) list.classList.toggle("doc-list-collapsed");
}

function renderCompanyDocs() {
    var list = document.getElementById("companyDocsList");
    var toggleBtn = document.getElementById("companyDocsToggle");
    if (!list || !toggleBtn) return;
    var n = companyDocuments.length;
    toggleBtn.textContent = "Documents uploaded " + n;
    list.innerHTML = "";
    list.classList.add("doc-list-collapsed");
    companyDocuments.forEach(function (doc) {
        var li = document.createElement("li");
        li.className = "doc-item";
        var link = document.createElement("a");
        link.className = "doc-link";
        link.textContent = doc.name;
        link.title = (doc.has_preview !== false) ? "Open preview" : "Preview not available";
        link.href = "#";
        link.onclick = function (e) {
            e.preventDefault();
            openDocPreview(doc);
        };
        var removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "doc-remove-btn";
        removeBtn.innerHTML = "&times;";
        removeBtn.title = "Remove document";
        removeBtn.onclick = function (e) {
            e.stopPropagation();
            removeCompanyDoc(doc.id);
        };
        li.appendChild(link);
        li.appendChild(removeBtn);
        list.appendChild(li);
    });
}

async function removeCompanyDoc(docId) {
    if (!(await confirmDialog("Remove this company document?", { confirmLabel: "Remove", cancelLabel: "Cancel", danger: true }))) return;
    if (!userEmail) return;
    try {
        var res = await fetch(API_BASE + "/documents/" + docId + "?email=" + encodeURIComponent(userEmail), { method: "DELETE" });
        if (!res.ok) {
            var data = await res.json().catch(function () { return {}; });
            toast(data.detail || "Could not delete document.", "error");
            return;
        }
    } catch (e) {
        console.error(e);
        toast("Could not delete document.", "error");
        return;
    }
    companyDocuments = companyDocuments.filter(function (d) { return d.id !== docId; });
    renderCompanyDocs();
    toast("Document removed.", "success");
}

async function toggleCompanyShowCountToEmployees() {
    var check = document.getElementById("companyShowCountCheck");
    if (!check || !userEmail) return;
    try {
        var res = await fetch(API_BASE + "/company/settings", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: userEmail, show_doc_count_to_employees: check.checked })
        });
        if (!res.ok) {
            var data = await res.json().catch(function () { return {}; });
            toast(data.detail || "Could not update setting.", "error");
            check.checked = !check.checked;
        }
    } catch (e) {
        console.error(e);
        check.checked = !check.checked;
        toast("Could not update setting.", "error");
    }
}

function toggleChatDocsUploadDropdown() {
    var dropdown = document.getElementById("chatDocsMobileDropdown");
    var plus = document.getElementById("chatDocsMobilePlus");
    if (!dropdown || !plus) return;
    var isOpen = dropdown.classList.toggle("open");
    plus.setAttribute("aria-expanded", isOpen);
    if (isOpen) {
        document.addEventListener("click", closeChatDocsUploadDropdownOnClickOutside);
    } else {
        document.removeEventListener("click", closeChatDocsUploadDropdownOnClickOutside);
    }
}

function closeChatDocsUploadDropdown() {
    var dropdown = document.getElementById("chatDocsMobileDropdown");
    var plus = document.getElementById("chatDocsMobilePlus");
    if (dropdown) dropdown.classList.remove("open");
    if (plus) plus.setAttribute("aria-expanded", "false");
    document.removeEventListener("click", closeChatDocsUploadDropdownOnClickOutside);
}

function closeChatDocsUploadDropdownOnClickOutside(e) {
    var panel = document.getElementById("chatDocsPanel");
    if (panel && !panel.contains(e.target)) {
        closeChatDocsUploadDropdown();
    }
}

function renderChatDocs() {
    if (loginMode !== "personal") return;
    var list = document.getElementById("chatDocs");
    var toggleBtn = document.getElementById("chatDocsToggle");
    var mobileCount = document.getElementById("chatDocsMobileCount");
    if (!toggleBtn || !list) return;
    var docs = currentChat ? chatDocuments[currentChat] || [] : [];
    var n = docs.length;
    toggleBtn.textContent = (window.innerWidth <= 768) ? (n + " docs") : ("Documents uploaded " + n);
    toggleBtn.setAttribute("data-count", n);
    if (mobileCount) mobileCount.textContent = n + " docs";
    list.innerHTML = "";
    list.classList.add("doc-list-collapsed");
    if (!currentChat) return;
    docs.forEach(function (doc) {
        var li = document.createElement("li");
        li.className = "doc-item chat-doc-item";
        var link = document.createElement("a");
        link.className = "doc-link";
        link.textContent = doc.name;
        link.title = (doc.has_preview || doc.file || (doc.id && doc.has_preview !== false)) ? "Open preview" : "Preview not available";
        link.href = "#";
        link.onclick = function (e) {
            e.preventDefault();
            openDocPreview(doc);
        };
        var removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "doc-remove-btn";
        removeBtn.innerHTML = "&times;";
        removeBtn.title = "Remove document";
        removeBtn.onclick = function (e) {
            e.stopPropagation();
            removeChatDoc(doc.id);
        };
        li.appendChild(link);
        li.appendChild(removeBtn);
        list.appendChild(li);
    });
}

async function removeChatDoc(docId) {
    if (!(await confirmDialog("Remove this document from the current chat?", { confirmLabel: "Remove", cancelLabel: "Cancel", danger: true }))) return;
    if (!currentChat || !userEmail) return;
    try {
        var res = await fetch(API_BASE + "/documents/" + docId + "?email=" + encodeURIComponent(userEmail), { method: "DELETE" });
        if (!res.ok) {
            var data = await res.json().catch(function () { return {}; });
            toast(data.detail || "Could not delete document.", "error");
            return;
        }
    } catch (e) {
        console.error(e);
        toast("Could not delete document.", "error");
        return;
    }
    chatDocuments[currentChat] = (chatDocuments[currentChat] || []).filter(function (d) { return d.id !== docId; });
    renderChatDocs();
    toast("Document removed from chat.", "success");
}

/* ---------------- SEND MESSAGE ---------------- */

function showStartView() {
    var container = document.getElementById("chatContainer");
    if (container) container.classList.remove("has-messages");
}

function showChatView() {
    var container = document.getElementById("chatContainer");
    if (container) container.classList.add("has-messages");
}

(function setupEnterToSend() {
    var input = document.getElementById("messageInput");
    if (input) {
        input.addEventListener("keydown", function (e) {
            if (e.key === "Enter") {
                e.preventDefault();
                sendMessage();
            }
        });
    }
})();

async function sendMessage() {
    var input = document.getElementById("messageInput");
    if (!input) return;
    const message = input.value;

    if (!message || !message.trim()) return;

    if (!currentChat) {
        if (!userEmail) {
            currentChat = getOrCreateGuestChatId();
            document.getElementById("chatTitle").innerText = "Guest chat";
        } else {
            var newName = await createNewChatAndReturnName();
            if (!newName) {
                toast("Could not create chat. Is the backend running?", "error");
                return;
            }
            currentChat = newName;
            document.getElementById("chatTitle").innerText = currentChat;
            var panel = document.getElementById("chatDocsPanel");
            if (loginMode === "personal" && panel) {
                panel.style.display = "block";
                renderChatDocs();
            }
            renderChats();
        }
    }

    if (!userEmail && getGuestMessageCount() >= 2) {
        openLoginPopup();
        toast("Please sign in to continue chatting.", "info");
        return;
    }

    addMessage(message, "user");
    input.value = "";
    if (!document.getElementById("chatContainer").classList.contains("has-messages")) {
        showChatView();
        requestAnimationFrame(function () {
            scrollChatToBottomSmooth();
        });
    }
    addTypingIndicator();

    fetch(API_BASE + "/chat", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            mode: userEmail ? loginMode : "personal",
            email: userEmail || "guest",
            chat: currentChat,
            message: message
        })
    })
    .then(function (res) {
        var ct = res.headers.get("Content-Type") || "";
        if (!ct.includes("application/json")) {
            if (!res.ok) {
                return res.text().then(function (t) {
                    throw new Error(res.status + " " + (t || res.statusText));
                });
            }
            throw new Error("Server did not return JSON.");
        }
        return res.json().then(function (data) {
            if (!res.ok) {
                var msg = data.message || res.status + " " + res.statusText;
                if (Array.isArray(data.detail)) {
                    msg = data.detail.map(function (d) { return d.msg || JSON.stringify(d); }).join("; ");
                } else if (data.detail) {
                    msg = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail);
                }
                throw new Error(msg);
            }
            return data;
        });
    })
    .then(function (data) {
        removeTypingIndicator();
        var reply = (data && data.reply != null) ? String(data.reply) : "No reply from server.";
        addMessage(reply, "bot");
        if (!userEmail) setGuestMessageCount(getGuestMessageCount() + 1);
    })
    .catch(function (error) {
        console.error("Error:", error);
        removeTypingIndicator();
        addMessage("Error: " + (error.message || "Server unreachable. Is the backend running?"), "bot");
    });
}

function addTypingIndicator() {
    var chatArea = document.getElementById("chatArea");
    if (!chatArea) return;
    var wrapper = document.createElement("div");
    wrapper.className = "typing-indicator-wrapper message-row";
    wrapper.setAttribute("data-typing", "1");
    wrapper.style.display = "flex";
    wrapper.style.alignItems = "flex-start";
    wrapper.style.marginBottom = "10px";
    var avatar = document.createElement("img");
    avatar.className = "message-avatar";
    avatar.src = "https://cdn-icons-png.flaticon.com/512/4712/4712027.png";
    var messageDiv = document.createElement("div");
    messageDiv.className = "message bot typing-indicator";
    messageDiv.innerText = "typing...";
    wrapper.appendChild(avatar);
    wrapper.appendChild(messageDiv);
    chatArea.appendChild(wrapper);
    scrollChatToBottomSmooth();
}

function removeTypingIndicator() {
    var el = document.querySelector(".typing-indicator-wrapper");
    if (el) el.remove();
}

function addMessage(text, role) {
    const chatArea = document.getElementById("chatArea");

    const wrapper = document.createElement("div");
    wrapper.className = "message-row";
    wrapper.style.display = "flex";
    wrapper.style.alignItems = "flex-start";
    wrapper.style.marginBottom = "10px";

    const avatar = document.createElement("img");
    avatar.className = "message-avatar";

    if (role === "user") {
        const profileImg = document.getElementById("profilePhoto");
        avatar.src = profileImg ? profileImg.src : "https://api.dicebear.com/7.x/avataaars/svg?seed=guest";
        wrapper.style.justifyContent = "flex-end";
    } else {
        avatar.src = "https://cdn-icons-png.flaticon.com/512/4712/4712027.png";
    }

    const messageDiv = document.createElement("div");
    messageDiv.className = "message " + role;
    messageDiv.innerText = text;

    if (role === "user") {
        wrapper.appendChild(messageDiv);
        wrapper.appendChild(avatar);
    } else {
        wrapper.appendChild(avatar);
        wrapper.appendChild(messageDiv);
    }

    chatArea.appendChild(wrapper);
    scrollChatToBottomSmooth();
}

async function uploadDocument() {

    const fileInput = document.getElementById("globalUpload");
    const file = fileInput.files[0];

    if (!file) {
        toast("Please select a file first.", "info");
        return;
    }

    if (!userEmail) {
        toast("Please sign in to upload documents.", "info");
        return;
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append("email", userEmail);
    formData.append("mode", loginMode === "company" ? "company" : "personal");
    // Global/company uploads: no chat. (Chat-specific docs use the Chat Documents panel in personal mode.)

    try {
        const response = await fetch(API_BASE + "/upload", {
            method: "POST",
            body: formData
        });

        var data = {};
        try {
            var ct = response.headers.get("Content-Type") || "";
            if (ct.includes("application/json")) {
                data = await response.json();
            }
        } catch (e) {
            console.error("Upload response parse error", e);
        }

        if (!response.ok) {
            toast(data.detail || data.error || "Upload failed.", "error");
            fileInput.value = "";
            return;
        }
        if (data.error) {
            toast(data.error, "error");
            fileInput.value = "";
            return;
        }
        if (loginMode === "personal" && data.message) {
            globalDocuments.push({ id: data.document_id, name: file.name, file: file, has_preview: true });
            renderGlobalDocs();
        }
        if (loginMode === "company") {
            if (data.document_id != null) {
                companyDocuments.push({ id: data.document_id, name: file.name, has_preview: true });
                renderCompanyDocs();
            }
            toast("Document uploaded and processed. Colleagues on your company domain can ask about it in chat.", "success");
        } else {
            toast(data.message || "Document uploaded and processed.", "success");
        }
        fileInput.value = "";
    } catch (error) {
        console.error("Upload error:", error);
        toast("Upload failed. Check the console and that the backend is running.", "error");
    }
}

/* ---------------- ADMIN DATABASE VIEW ---------------- */

function openDatabaseView() {
    if (!userEmail || !userIsAdmin) return;
    var mainPanel = document.getElementById("mainChatPanel");
    var dbView = document.getElementById("databaseView");
    if (mainPanel) mainPanel.style.display = "none";
    if (dbView) dbView.style.display = "flex";
    fetchDatabaseAndAdmins();
}

function closeDatabaseView() {
    var mainPanel = document.getElementById("mainChatPanel");
    var dbView = document.getElementById("databaseView");
    if (mainPanel) mainPanel.style.display = "flex";
    if (dbView) dbView.style.display = "none";
}

async function fetchDatabaseAndAdmins() {
    if (!userEmail) return;
    try {
        var dbRes = await fetch(API_BASE + "/admin/database?email=" + encodeURIComponent(userEmail));
        if (!dbRes.ok) {
            toast("Admin access denied or error loading data.", "error");
            return;
        }
        dbData = await dbRes.json();
        var superAdmin = isSuperAdmin();
        var addSection = document.getElementById("adminAddAdminSection");
        if (addSection) addSection.style.display = superAdmin ? "block" : "none";
        if (superAdmin) {
            var adminsRes = await fetch(API_BASE + "/admin/admins?email=" + encodeURIComponent(userEmail));
            if (adminsRes.ok) {
                var adminsData = await adminsRes.json();
                renderAdminListWithRemove(adminsData.admins || [], true);
            } else {
                renderAdminListWithRemove([], true);
            }
        } else {
            var toggleBtn = document.getElementById("adminListToggle");
            var listEl = document.getElementById("adminListCollapsible");
            if (toggleBtn) toggleBtn.style.display = "none";
            if (listEl) listEl.innerHTML = "";
        }
        renderDbTab();
        setupDbTabs();
        setupDbSearch();
    } catch (e) {
        console.error("Error loading admin data", e);
        toast("Could not load database. Is the backend running?", "error");
    }
}

function setupDbTabs() {
    document.querySelectorAll(".db-tab").forEach(function (btn) {
        btn.onclick = function () {
            document.querySelectorAll(".db-tab").forEach(function (b) { b.classList.remove("active"); });
            btn.classList.add("active");
            renderDbTab();
        };
    });
}

function renderDbTab() {
    var active = document.querySelector(".db-tab.active");
    var tableName = active ? active.getAttribute("data-table") : "users";
    var container = document.getElementById("dbTableContent");
    var searchInput = document.getElementById("dbSearchInput");
    var searchTerm = (searchInput && searchInput.value) ? searchInput.value.trim().toLowerCase() : "";
    if (!container || !dbData) return;
    var rows = dbData[tableName] || [];
    if (searchTerm) {
        rows = rows.filter(function (row) {
            return Object.keys(row).some(function (k) {
                var v = row[k];
                if (v === null || v === undefined) return false;
                return String(v).toLowerCase().indexOf(searchTerm) !== -1;
            });
        });
    }
    if (rows.length === 0) {
        container.innerHTML = "<p class=\"db-empty\">No rows" + (searchTerm ? " matching search" : "") + "</p>";
        return;
    }
    var keys = Object.keys(rows[0]);
    var html = "<table class=\"db-table\"><thead><tr>";
    keys.forEach(function (k) {
        html += "<th>" + escapeHtml(k) + "</th>";
    });
    if (tableName === "documents") html += "<th>Actions</th>";
    html += "</tr></thead><tbody>";
    rows.forEach(function (row) {
        html += "<tr>";
        keys.forEach(function (k) {
            var v = row[k];
            if (v === null || v === undefined) v = "";
            var str = typeof v === "object" ? JSON.stringify(v) : String(v);
            if (str.length > 200) str = str.substring(0, 200) + "...";
            html += "<td>" + escapeHtml(str) + "</td>";
        });
        if (tableName === "documents" && row.id != null) {
            var docUrl = API_BASE + "/documents/file/" + row.id + "?email=" + encodeURIComponent(userEmail || "");
            html += "<td><a href=\"" + escapeHtml(docUrl) + "\" target=\"_blank\" rel=\"noopener\" class=\"db-doc-link\">View / Download</a></td>";
        }
        html += "</tr>";
    });
    html += "</tbody></table>";
    container.innerHTML = html;
}

function setupDbSearch() {
    var searchInput = document.getElementById("dbSearchInput");
    if (!searchInput) return;
    searchInput.value = "";
    searchInput.oninput = function () { renderDbTab(); };
}

function escapeHtml(s) {
    if (s === null || s === undefined) return "";
    var div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
}

async function addAdminEmail() {
    var input = document.getElementById("newAdminEmail");
    if (!input || !userEmail) return;
    var newEmail = (input.value || "").trim();
    if (!newEmail || !newEmail.includes("@")) {
        toast("Enter a valid email address.", "warning");
        return;
    }
    try {
        var res = await fetch(API_BASE + "/admin/admins", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: userEmail, new_admin_email: newEmail })
        });
        var data = await res.json().catch(function () { return {}; });
        if (!res.ok) {
            toast(data.detail || "Failed to add admin.", "error");
            return;
        }
        input.value = "";
        renderAdminListWithRemove(data.admins || [], true);
        toast(data.message || "Admin added.", "success");
    } catch (e) {
        console.error("Add admin error", e);
        toast("Failed to add admin.", "error");
    }
}

function toggleAdminList() {
    var list = document.getElementById("adminListCollapsible");
    if (list) list.classList.toggle("doc-list-collapsed");
}

function renderAdminListWithRemove(admins, showRemoveButtons) {
    var toggleBtn = document.getElementById("adminListToggle");
    var listEl = document.getElementById("adminListCollapsible");
    if (!toggleBtn || !listEl) return;
    var superAdmin = showRemoveButtons === true;
    var n = (admins && admins.length) || 0;
    toggleBtn.textContent = "Admins (" + n + ")";
    toggleBtn.style.display = "block";
    if (n === 0) {
        listEl.innerHTML = "<li class=\"admin-list-li admin-list-empty\">No admins listed.</li>";
        listEl.classList.add("doc-list-collapsed");
        return;
    }
    var html = "";
    admins.forEach(function (email) {
        html += "<li class=\"admin-list-li\"><span class=\"admin-email\">" + escapeHtml(email) + "</span>";
        if (superAdmin) {
            var safeEmail = escapeHtml(email).replace(/"/g, "&quot;");
            html += " <button type=\"button\" class=\"admin-remove-btn\" data-remove-email=\"" + safeEmail + "\">Remove</button>";
        }
        html += "</li>";
    });
    listEl.innerHTML = html;
    if (superAdmin) {
        listEl.querySelectorAll(".admin-remove-btn").forEach(function (btn) {
            btn.onclick = function () { removeAdminEmail(btn.getAttribute("data-remove-email")); };
        });
    }
}

async function removeAdminEmail(emailToRemove) {
    if (!userEmail || !emailToRemove) return;
    if (!(await confirmDialog("Remove " + emailToRemove + " from admins?", { confirmLabel: "Remove", cancelLabel: "Cancel", danger: true }))) return;
    try {
        var res = await fetch(API_BASE + "/admin/admins/remove", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: userEmail, remove_admin_email: emailToRemove })
        });
        var data = await res.json().catch(function () { return {}; });
        if (!res.ok) {
            toast(data.detail || "Failed to remove admin.", "error");
            return;
        }
        renderAdminListWithRemove(data.admins || [], true);
        toast(data.message || "Admin removed.", "success");
        if ((data.admins || []).indexOf(userEmail) === -1) {
            userIsAdmin = false;
            var adminSec = document.getElementById("adminSection");
            if (adminSec) adminSec.style.display = "none";
            closeDatabaseView();
        }
    } catch (e) {
        console.error("Remove admin error", e);
        toast("Failed to remove admin.", "error");
    }
}

// Close chat dropdowns when clicking outside
document.addEventListener("click", function () {
    closeAllChatMenus();
});


function googleLogin() {
    window.location.href = API_BASE + "/login/google";
}

(function checkGoogleLoginCallback() {
    var params = new URLSearchParams(window.location.search);
    var error = params.get("error");
    var message = params.get("message");
    if (error === "oauth" && message) {
        try { message = decodeURIComponent(message); } catch (e) {}
        toast(message, "error");
        history.replaceState({}, document.title, window.location.pathname || "/");
        return;
    }
    var email = params.get("email");
    if (!email) return;
    userEmail = email;
    loginMode = "personal";
    try { localStorage.setItem("userEmail", email); localStorage.setItem("loginMode", "personal"); } catch(e) {}
    document.getElementById("loginBtn").style.display = "none";
    document.getElementById("profileBox").style.display = "block";
    document.getElementById("profileName").textContent = email;
    document.getElementById("profileName").title = email;
    document.getElementById("documentSection").style.display = "block";
    document.getElementById("documentSectionTitle").textContent = "Global Documents";
    document.getElementById("documentUploadWrap").style.display = "block";
    document.getElementById("globalDocsBlock").style.display = "block";
    var companyDocsBlock = document.getElementById("companyDocsBlock");
    if (companyDocsBlock) companyDocsBlock.style.display = "none";
    var companyShowCountWrap = document.getElementById("companyShowCountWrap");
    if (companyShowCountWrap) companyShowCountWrap.style.display = "none";
    document.getElementById("companyDocCountEmployee").style.display = "none";
    document.getElementById("companyDocHintHr").style.display = "none";
    document.getElementById("companyDocHintEmployee").style.display = "none";
    var panel = document.getElementById("chatDocsPanel");
    if (panel) panel.style.display = "block";
    renderChatDocs();
    loadSavedProfilePhoto();
    claimGuestChatIfAny(email).then(function (claimed) {
    if (!claimed) loadUserData(email).catch(function (e) { console.error("Error loading user data after Google login", e); });
    // Restore pending message
    try {
        var pending = localStorage.getItem("pendingMsg");
        if (pending) {
            var msgInput = document.getElementById("messageInput");
            if (msgInput) msgInput.value = pending;
            localStorage.removeItem("pendingMsg");
        }
    } catch(e) {}
});
    history.replaceState({}, document.title, window.location.pathname || "/");
})();

/* Mobile: auto-focus chat input so keyboard opens when user opens the site */
(function setupMobileAutoFocus() {
    function tryFocusInput() {
        if (!window.matchMedia || !window.matchMedia("(max-width: 768px)").matches) return;
        var input = document.getElementById("messageInput");
        if (input) {
            setTimeout(function () { input.focus(); }, 400);
        }
    }
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", tryFocusInput);
    } else {
        tryFocusInput();
    }
})();

/* Update Chat Documents toggle text and mobile count on resize */
(function setupChatDocsToggleResize() {
    function updateChatDocsToggleText() {
        var toggleBtn = document.getElementById("chatDocsToggle");
        var mobileCount = document.getElementById("chatDocsMobileCount");
        if (toggleBtn) {
            var n = toggleBtn.getAttribute("data-count");
            if (n === null) {
                var m = toggleBtn.textContent.match(/Documents uploaded (\d+)/);
                n = m ? m[1] : "0";
                toggleBtn.setAttribute("data-count", n);
            }
            toggleBtn.textContent = (window.innerWidth <= 768) ? (n + " docs") : ("Documents uploaded " + n);
            if (mobileCount) mobileCount.textContent = n + " docs";
        }
    }
    window.addEventListener("resize", updateChatDocsToggleText);
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", updateChatDocsToggleText);
    } else {
        updateChatDocsToggleText();
    }
})();