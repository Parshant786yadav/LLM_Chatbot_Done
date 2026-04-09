(function () {
    function initTerminal(root) {
        var tabs = root.querySelectorAll(".how-tab[data-h-tab]");
        var snippets = root.querySelectorAll(".how-snippet[data-h-snippet]");
        var copyBtn = root.querySelector(".how-copy-btn");
        var subTabs = root.querySelectorAll(".how-sub-tab[data-h-sub]");

        function showSnippet(id) {
            snippets.forEach(function (s) {
                s.classList.toggle("how-snippet--active", s.getAttribute("data-h-snippet") === id);
            });
        }

        function activateMainTab(btn) {
            var t = btn.getAttribute("data-h-tab");
            tabs.forEach(function (b) {
                b.classList.toggle("how-tab--active", b === btn);
            });
            root.querySelectorAll(".how-terminal-sub").forEach(function (r) {
                var forTab = r.getAttribute("data-for-tab");
                r.style.display = forTab === t ? "flex" : "none";
            });
            var subRow = root.querySelector(".how-terminal-sub[data-for-tab='" + t + "']");
            if (subRow) {
                var activeSub = subRow.querySelector(".how-sub-tab.how-tab--active");
                if (!activeSub) {
                    activeSub = subRow.querySelector(".how-sub-tab");
                    if (activeSub) {
                        subRow.querySelectorAll(".how-sub-tab").forEach(function (b) {
                            b.classList.remove("how-tab--active");
                        });
                        activeSub.classList.add("how-tab--active");
                    }
                }
                showSnippet(activeSub ? activeSub.getAttribute("data-h-sub") : t);
            } else {
                showSnippet(t);
            }
        }

        tabs.forEach(function (btn) {
            btn.addEventListener("click", function () {
                activateMainTab(btn);
            });
        });

        subTabs.forEach(function (btn) {
            btn.addEventListener("click", function () {
                var parent = btn.closest(".how-terminal-sub");
                if (!parent) return;
                parent.querySelectorAll(".how-sub-tab").forEach(function (b) {
                    b.classList.toggle("how-tab--active", b === btn);
                });
                showSnippet(btn.getAttribute("data-h-sub"));
            });
        });

        if (copyBtn) {
            copyBtn.addEventListener("click", function () {
                var active = root.querySelector(".how-snippet.how-snippet--active");
                if (!active || !navigator.clipboard) return;
                var t = active.textContent || "";
                navigator.clipboard.writeText(t).then(function () {
                    copyBtn.classList.add("copied");
                    var o = copyBtn.textContent;
                    copyBtn.textContent = "Copied!";
                    setTimeout(function () {
                        copyBtn.classList.remove("copied");
                        copyBtn.textContent = o;
                    }, 1600);
                });
            });
        }
    }

    document.querySelectorAll(".how-terminal").forEach(initTerminal);
})();
