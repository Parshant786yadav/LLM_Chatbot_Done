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
/** @type {Record<string, number>} maps chat name -> server chat id (for API keys) */
let chatIdByName = {};
let cachedApiKeys = [];
let currentChat = null;
let globalDocuments = [];
let chatDocuments = {};
let companyDocuments = [];  // HR company docs (same-domain users access via chat only)
var API_BASE = (window.location.protocol === "http:" || window.location.protocol === "https:") ? "" : "http://localhost:8000";

/** Bot avatar — bump BOT_AVATAR_REVISION when you replace Backend/static/bot-avatar.png (avoids stale browser cache). */
var BOT_AVATAR_REVISION = "4";
var BOT_AVATAR_URL = API_BASE + "/static/bot-avatar.png?v=" + BOT_AVATAR_REVISION;

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

var TOAST_SPINNER_SVG = "<svg class=\"toast-spinner\" viewBox=\"0 0 24 24\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\" aria-hidden=\"true\"><circle cx=\"12\" cy=\"12\" r=\"9.5\" stroke=\"currentColor\" stroke-width=\"2.25\" stroke-linecap=\"round\" stroke-dasharray=\"14 50\"/></svg>";

function toast(message, type, opts) {
    type = type || "info";
    opts = opts || {};
    var container = document.getElementById("toastContainer");
    if (!container || message == null || message === "") return null;
    var el = document.createElement("div");
    el.className = "toast toast--" + type;
    el.setAttribute("role", "status");
    var iconEl = document.createElement("span");
    if (type === "loading") {
        iconEl.className = "toast-icon toast-icon--spinner";
        iconEl.innerHTML = TOAST_SPINNER_SVG;
    } else {
        iconEl.className = "toast-icon";
        iconEl.innerHTML = TOAST_ICONS[type] || TOAST_ICONS.info;
    }
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
    var duration;
    if (opts.persistent) {
        duration = null;
    } else if (opts.duration != null) {
        duration = opts.duration;
    } else if (type === "loading") {
        duration = null;
    } else {
        duration = type === "error" ? 6500 : 5000;
    }
    var timer = null;
    if (duration != null && duration > 0) {
        timer = setTimeout(function () { removeToast(el); }, duration);
    }
    dismiss.onclick = function () {
        if (timer) clearTimeout(timer);
        removeToast(el);
    };
    return el;
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
    if (hint) hint.textContent = "Didn’t get the OTP? Check spam";
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
        chatIdByName = {};
        chats = (chatData.chats || []).map(function (c) {
            if (typeof c === "string") return c;
            if (c && c.name != null) {
                if (c.id != null) chatIdByName[c.name] = c.id;
                return c.name;
            }
            return String(c);
        });
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

        if (loginMode === "personal") {
            await refreshApiKeys();
        } else {
            cachedApiKeys = [];
            renderGlobalApiKeysList();
            renderChatApiKeysList();
        }
        updateApiKeysSectionVisibility();

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
    updateApiKeysSectionVisibility();
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
    updateApiKeysSectionVisibility();
}

function logout() {
    closeProfileDropdown();
    loginMode = "guest";
    userEmail = null;
    chatIdByName = {};
    cachedApiKeys = [];
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

    var gar = document.getElementById("globalApiKeyReveal");
    if (gar) { gar.style.display = "none"; gar.textContent = ""; }
    var car = document.getElementById("chatApiKeyReveal");
    if (car) { car.style.display = "none"; car.textContent = ""; }
    closeChatApiKeyPopover();
    closeChatDocsUploadPopover();

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
        if (chatIdByName[guestChatId] !== undefined) {
            chatIdByName[newName] = chatIdByName[guestChatId];
            delete chatIdByName[guestChatId];
        }
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
        var createData = await createRes.json().catch(function () { return {}; });
        if (!createRes.ok && createRes.status !== 200) return null;
        if (createData.chat_id != null) chatIdByName[chatName] = createData.chat_id;
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
            if (chatIdByName[oldName] !== undefined) {
                chatIdByName[newName] = chatIdByName[oldName];
                delete chatIdByName[oldName];
            }
            renderChats();
            closeChatApiKeyPopover();
            closeChatDocsUploadPopover();
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
    closeChatApiKeyPopover();
    closeChatDocsUploadPopover();
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

    updateApiKeysSectionVisibility();
    renderChatApiKeysList();
}

/* ---------------- USER API KEYS (personal) ---------------- */

function updateApiKeysSectionVisibility() {
    var g = document.getElementById("globalApiKeysSection");
    var tbar = document.getElementById("chatApiKeyToolbar");
    var personal = loginMode === "personal" && !!userEmail;
    if (g) g.style.display = personal ? "block" : "none";
    if (tbar) tbar.style.display = personal && currentChat ? "block" : "none";
    if (!personal || !currentChat) {
        closeChatApiKeyPopover();
        closeChatDocsUploadPopover();
    }
}

function closeChatApiKeyPopover() {
    var pop = document.getElementById("chatApiKeyPopover");
    var btn = document.getElementById("chatApiKeyPopoverBtn");
    if (pop) {
        pop.classList.remove("chat-api-key-popover--open");
        pop.setAttribute("aria-hidden", "true");
    }
    if (btn) btn.setAttribute("aria-expanded", "false");
    document.removeEventListener("click", closeChatApiKeyPopoverOnOutside);
}

function closeChatApiKeyPopoverOnOutside(e) {
    var wrap = document.querySelector(".chat-api-key-toolbar-inner");
    if (wrap && !wrap.contains(e.target)) {
        closeChatApiKeyPopover();
    }
}

function toggleChatApiKeyPopover(e) {
    if (e) e.stopPropagation();
    var pop = document.getElementById("chatApiKeyPopover");
    var btn = document.getElementById("chatApiKeyPopoverBtn");
    if (!pop || !btn) return;
    if (pop.classList.contains("chat-api-key-popover--open")) {
        closeChatApiKeyPopover();
        return;
    }
    closeChatDocsUploadPopover();
    pop.classList.add("chat-api-key-popover--open");
    pop.setAttribute("aria-hidden", "false");
    btn.setAttribute("aria-expanded", "true");
    setTimeout(function () {
        document.addEventListener("click", closeChatApiKeyPopoverOnOutside);
    }, 0);
}

function closeChatDocsUploadPopover() {
    var pop = document.getElementById("chatDocsUploadPopover");
    var btn = document.getElementById("chatDocsUploadPopoverBtn");
    if (pop) {
        pop.classList.remove("chat-docs-upload-popover--open");
        pop.setAttribute("aria-hidden", "true");
    }
    if (btn) btn.setAttribute("aria-expanded", "false");
    document.removeEventListener("click", closeChatDocsUploadPopoverOnOutside);
}

function closeChatDocsUploadPopoverOnOutside(e) {
    var wrap = document.querySelector(".chat-docs-upload-toolbar-inner");
    if (wrap && !wrap.contains(e.target)) {
        closeChatDocsUploadPopover();
    }
}

function toggleChatDocsUploadPopover(e) {
    if (e) e.stopPropagation();
    var pop = document.getElementById("chatDocsUploadPopover");
    var btn = document.getElementById("chatDocsUploadPopoverBtn");
    if (!pop || !btn) return;
    if (pop.classList.contains("chat-docs-upload-popover--open")) {
        closeChatDocsUploadPopover();
        return;
    }
    closeChatApiKeyPopover();
    pop.classList.add("chat-docs-upload-popover--open");
    pop.setAttribute("aria-hidden", "false");
    btn.setAttribute("aria-expanded", "true");
    setTimeout(function () {
        document.addEventListener("click", closeChatDocsUploadPopoverOnOutside);
    }, 0);
}

async function refreshApiKeys() {
    if (!userEmail || loginMode !== "personal") return;
    try {
        var res = await fetch(API_BASE + "/api-keys/list?email=" + encodeURIComponent(userEmail));
        var data = await res.json().catch(function () { return {}; });
        cachedApiKeys = data.keys || [];
        if (data.warning) console.warn(data.warning);
        renderGlobalApiKeysList();
        renderChatApiKeysList();
    } catch (e) {
        console.error("refreshApiKeys", e);
    }
}

function renderGlobalApiKeysList() {
    var ul = document.getElementById("globalApiKeysList");
    if (!ul) return;
    ul.innerHTML = "";
    cachedApiKeys.filter(function (k) { return k.scope === "global"; }).forEach(function (k) {
        var li = document.createElement("li");
        var span = document.createElement("span");
        span.className = "api-key-meta";
        span.textContent = (k.label || "—") + " · " + (k.key_hint || "••••");
        li.appendChild(span);
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "api-keys-revoke";
        btn.textContent = "Revoke";
        btn.onclick = function () { revokeApiKey(k.id); };
        li.appendChild(btn);
        ul.appendChild(li);
    });
}

function renderChatApiKeysList() {
    var ul = document.getElementById("chatApiKeysList");
    if (!ul) return;
    ul.innerHTML = "";
    if (!currentChat) return;
    var cid = chatIdByName[currentChat];
    if (cid == null) {
        var miss = document.createElement("li");
        miss.className = "api-keys-li-muted";
        miss.style.color = "#94a3b8";
        miss.textContent = "Chat id not loaded — switch chat or refresh the page.";
        ul.appendChild(miss);
        return;
    }
    cachedApiKeys.filter(function (k) { return k.scope === "chat" && Number(k.chat_id) === Number(cid); }).forEach(function (k) {
        var li = document.createElement("li");
        var span = document.createElement("span");
        span.className = "api-key-meta";
        span.textContent = (k.label || "—") + " · " + (k.key_hint || "••••");
        li.appendChild(span);
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "api-keys-revoke";
        btn.textContent = "Revoke";
        btn.onclick = function () { revokeApiKey(k.id); };
        li.appendChild(btn);
        ul.appendChild(li);
    });
}

async function createGlobalApiKey() {
    if (!userEmail || loginMode !== "personal") return;
    var labelIn = document.getElementById("globalApiKeyLabel");
    var label = labelIn ? labelIn.value.trim() : "";
    var reveal = document.getElementById("globalApiKeyReveal");
    try {
        var res = await fetch(API_BASE + "/api-keys/create", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: userEmail, scope: "global", label: label || null })
        });
        var data = await res.json().catch(function () { return {}; });
        if (!res.ok) {
            toast((data.detail && (typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail))) || "Could not create key", "error");
            return;
        }
        if (reveal) {
            reveal.style.display = "block";
            reveal.textContent = "Save this key now (shown once): " + (data.api_key || "");
        }
        if (labelIn) labelIn.value = "";
        await refreshApiKeys();
        toast("Global API key created.", "success");
    } catch (e) {
        console.error(e);
        toast("Could not create API key.", "error");
    }
}

async function createChatApiKey() {
    if (!userEmail || !currentChat || loginMode !== "personal") return;
    var labelIn = document.getElementById("chatApiKeyLabel");
    var label = labelIn ? labelIn.value.trim() : "";
    var reveal = document.getElementById("chatApiKeyReveal");
    try {
        var res = await fetch(API_BASE + "/api-keys/create", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                email: userEmail,
                scope: "chat",
                chat_name: currentChat,
                label: label || null
            })
        });
        var data = await res.json().catch(function () { return {}; });
        if (!res.ok) {
            toast((data.detail && (typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail))) || "Could not create key", "error");
            return;
        }
        if (reveal) {
            reveal.style.display = "block";
            reveal.textContent = "Save this key now (shown once): " + (data.api_key || "");
        }
        if (labelIn) labelIn.value = "";
        await refreshApiKeys();
        toast("Chat API key created.", "success");
    } catch (e) {
        console.error(e);
        toast("Could not create API key.", "error");
    }
}

async function revokeApiKey(keyId) {
    if (!userEmail) return;
    if (!(await confirmDialog("Revoke this API key? Apps using it will stop working.", { confirmLabel: "Revoke", cancelLabel: "Cancel", danger: true }))) return;
    try {
        var res = await fetch(API_BASE + "/api-keys/revoke", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: userEmail, key_id: keyId })
        });
        var data = await res.json().catch(function () { return {}; });
        if (!res.ok) {
            toast(data.detail || "Could not revoke.", "error");
            return;
        }
        await refreshApiKeys();
        toast("Key revoked.", "success");
    } catch (e) {
        console.error(e);
        toast("Could not revoke key.", "error");
    }
}

/* ---------------- DOCUMENTS (PERSONAL MODE ONLY) ---------------- */

function checkLoginBeforeUpload(event) {
    if (!userEmail) {
        event.preventDefault();
        toast("Please signin first.", "info");
    }
}

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

    var uploadNotice = null;
    try {
        uploadNotice = toast("Uploading…", "loading", { persistent: true });
        const response = await fetch(API_BASE + "/upload", {
            method: "POST",
            body: formData
        });
        const data = await response.json();
        if (uploadNotice) removeToast(uploadNotice);
        uploadNotice = null;
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
        if (uploadNotice) removeToast(uploadNotice);
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
    if (!list) return;
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

/** Reserved for resize hooks; chat docs list lives in the upload popover (no DOM reparenting). */
function layoutChatDocsPanelForViewport() {}

function renderChatDocs() {
    if (loginMode !== "personal") return;
    var list = document.getElementById("chatDocs");
    var toggleBtn = document.getElementById("chatDocsToggle");
    if (!toggleBtn || !list) return;
    var docs = currentChat ? chatDocuments[currentChat] || [] : [];
    var n = docs.length;
    toggleBtn.textContent = "Documents uploaded " + n;
    toggleBtn.setAttribute("data-count", n);
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

    fetch(API_BASE + "/chat/stream", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream"
        },
        body: JSON.stringify({
            mode: userEmail ? loginMode : "personal",
            email: userEmail || "guest",
            chat: currentChat,
            message: message
        })
    })
    .then(function (res) {
        return consumeChatStreamResponse(res);
    })
    .then(function (result) {
        if (result && result.ok && !userEmail) {
            setGuestMessageCount(getGuestMessageCount() + 1);
        }
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
    wrapper.className = "typing-indicator-wrapper message-row message-row--assistant";
    wrapper.setAttribute("data-typing", "1");
    wrapper.style.display = "flex";
    wrapper.style.alignItems = "flex-start";
    wrapper.style.marginBottom = "10px";
    var avatar = document.createElement("img");
    avatar.className = "message-avatar message-avatar--bot";
    avatar.src = BOT_AVATAR_URL;
    avatar.alt = "DocuMind";
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

/** Empty bot bubble for SSE chunks (same layout as addMessage role bot). */
function createStreamingBotMessage() {
    var chatArea = document.getElementById("chatArea");
    var wrapper = document.createElement("div");
    wrapper.className = "message-row message-row--assistant";
    wrapper.style.display = "flex";
    wrapper.style.alignItems = "flex-start";
    wrapper.style.marginBottom = "10px";
    var avatar = document.createElement("img");
    avatar.className = "message-avatar message-avatar--bot";
    avatar.src = BOT_AVATAR_URL;
    avatar.alt = "DocuMind";
    var messageDiv = document.createElement("div");
    messageDiv.className = "message bot";
    messageDiv.innerText = "";
    wrapper.appendChild(avatar);
    wrapper.appendChild(messageDiv);
    chatArea.appendChild(wrapper);
    scrollChatToBottomSmooth();
    return {
        append: function (s) {
            messageDiv.innerText += s;
            scrollChatToBottomSmooth();
        }
    };
}

/**
 * Read POST /chat/stream SSE: JSON lines data: {"t":"d","c":"..."} | {"t":"done"} | {"t":"e","m":"..."}
 * @returns {Promise<{ ok: boolean, hadAssistantBubble: boolean }>}
 */
function consumeChatStreamResponse(res) {
    if (!res.ok) {
        return res.text().then(function (t) {
            throw new Error(res.status + " " + (t || res.statusText));
        });
    }
    if (!res.body || typeof res.body.getReader !== "function") {
        return Promise.reject(new Error("Streaming not supported in this browser."));
    }
    var reader = res.body.getReader();
    var dec = new TextDecoder();
    var buf = "";
    var streamBubble = null;
    var sawDone = false;
    var sawError = false;

    function parseSseBlocks(text) {
        var parts = text.split("\n\n");
        for (var i = 0; i < parts.length; i++) {
            var block = parts[i].trim();
            if (!block) continue;
            var lines = block.split("\n");
            for (var j = 0; j < lines.length; j++) {
                var ln = lines[j].trim();
                if (ln.indexOf("data:") !== 0) continue;
                var payload = ln.slice(5).trim();
                var ev;
                try {
                    ev = JSON.parse(payload);
                } catch (e) {
                    continue;
                }
                if (ev.t === "d" && ev.c != null) {
                    removeTypingIndicator();
                    if (!streamBubble) streamBubble = createStreamingBotMessage();
                    streamBubble.append(String(ev.c));
                } else if (ev.t === "done") {
                    removeTypingIndicator();
                    sawDone = true;
                } else if (ev.t === "e") {
                    removeTypingIndicator();
                    sawError = true;
                    var em = ev.m != null ? String(ev.m) : "Unknown error";
                    if (streamBubble) {
                        streamBubble.append("\n\n" + em);
                    } else {
                        addMessage("Error: " + em, "bot");
                    }
                }
            }
        }
    }

    function pump() {
        return reader.read().then(function (x) {
            if (x.value) {
                buf += dec.decode(x.value, { stream: !x.done });
            }
            if (x.done) {
                parseSseBlocks(buf);
                buf = "";
                removeTypingIndicator();
                if (!sawDone && !sawError && !streamBubble) {
                    addMessage("No reply from server.", "bot");
                }
                return { ok: sawDone && !sawError, hadAssistantBubble: !!streamBubble };
            }
            var lastSep = buf.lastIndexOf("\n\n");
            if (lastSep !== -1) {
                parseSseBlocks(buf.slice(0, lastSep + 2));
                buf = buf.slice(lastSep + 2);
            }
            return pump();
        });
    }
    return pump();
}

function addMessage(text, role) {
    const chatArea = document.getElementById("chatArea");

    const wrapper = document.createElement("div");
    wrapper.className = "message-row";
    wrapper.style.display = "flex";
    wrapper.style.alignItems = "flex-start";
    wrapper.style.marginBottom = "10px";

    const messageDiv = document.createElement("div");
    messageDiv.className = "message " + role;
    messageDiv.innerText = text;

    if (role === "user") {
        wrapper.style.justifyContent = "flex-end";
        wrapper.appendChild(messageDiv);
    } else {
        wrapper.classList.add("message-row--assistant");
        const avatar = document.createElement("img");
        avatar.className = "message-avatar message-avatar--bot";
        avatar.src = BOT_AVATAR_URL;
        avatar.alt = "DocuMind";
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
        toast("Please signin first.", "info");
        return;
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append("email", userEmail);
    formData.append("mode", loginMode === "company" ? "company" : "personal");
    // Global/company uploads: no chat. (Chat-specific docs use the Chat Documents panel in personal mode.)

    var uploadNotice = null;
    try {
        uploadNotice = toast("Uploading…", "loading", { persistent: true });
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

        if (uploadNotice) removeToast(uploadNotice);
        uploadNotice = null;

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
        if (uploadNotice) removeToast(uploadNotice);
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

/* Mobile: focus chat input on load so the on-screen keyboard can open (Android/WebView usually works; iOS may require a tap first). */
(function setupMobileAutoFocus() {
    function isMobileViewport() {
        try {
            return window.matchMedia("(max-width: 768px)").matches;
        } catch (e) {
            return window.innerWidth <= 768;
        }
    }

    function focusChatInput() {
        if (!isMobileViewport()) return;
        var input = document.getElementById("messageInput");
        if (!input) return;
        var box = input.closest(".input-box");
        try {
            if (box) {
                box.scrollIntoView({ block: "end", behavior: "smooth" });
            } else {
                input.scrollIntoView({ block: "end", behavior: "smooth" });
            }
        } catch (e) {
            input.scrollIntoView(false);
        }
        try {
            input.removeAttribute("readonly");
        } catch (e2) {}
        function attempt() {
            try {
                input.focus({ preventScroll: true });
            } catch (e3) {
                try {
                    input.focus();
                } catch (e4) {}
            }
        }
        attempt();
        setTimeout(attempt, 120);
        setTimeout(attempt, 450);
        setTimeout(attempt, 900);
    }

    function schedule() {
        setTimeout(focusChatInput, 0);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", schedule);
    } else {
        schedule();
    }
    window.addEventListener("load", function () {
        setTimeout(focusChatInput, 200);
    });
    window.addEventListener("pageshow", function (ev) {
        if (ev.persisted) setTimeout(focusChatInput, 100);
    });
})();

/* Update Chat Documents toggle text, mobile count, and input placeholder on resize */
(function setupChatDocsToggleResize() {
    function updateMessageInputPlaceholder() {
        var input = document.getElementById("messageInput");
        if (!input) return;
        var mobile = input.getAttribute("data-placeholder-mobile");
        var desktop = input.getAttribute("data-placeholder-desktop");
        if (mobile && desktop) {
            input.placeholder = window.innerWidth <= 768 ? mobile : desktop;
        }
    }
    function updateChatDocsToggleText() {
        var toggleBtn = document.getElementById("chatDocsToggle");
        if (toggleBtn) {
            var n = toggleBtn.getAttribute("data-count");
            if (n === null) {
                var m = toggleBtn.textContent.match(/Documents uploaded (\d+)/);
                n = m ? m[1] : "0";
                toggleBtn.setAttribute("data-count", n);
            }
            toggleBtn.textContent = "Documents uploaded " + n;
        }
        updateMessageInputPlaceholder();
        layoutChatDocsPanelForViewport();
    }
    window.addEventListener("resize", updateChatDocsToggleText);
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", updateChatDocsToggleText);
    } else {
        updateChatDocsToggleText();
    }
})();

/** Dismiss SEO footer strip; preference stored so it stays hidden on return visits */
(function initSeoFooterDismiss() {
    var STORAGE_KEY = "documind_seo_footer_hidden";
    function apply() {
        var footer = document.getElementById("siteSeoFooter");
        var btn = document.getElementById("siteSeoFooterClose");
        if (!footer || !btn) return;
        try {
            if (localStorage.getItem(STORAGE_KEY) === "1") {
                footer.style.display = "none";
                return;
            }
        } catch (e) {}
        btn.addEventListener("click", function () {
            try {
                localStorage.setItem(STORAGE_KEY, "1");
            } catch (e) {}
            footer.style.display = "none";
        });
    }
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", apply);
    } else {
        apply();
    }
})();