




"use strict";

// ==== Compatibility shim (ensures other scripts won't throw) ====
window.coverClickHandler = window.coverClickHandler || null;
window.goNextPage = window.goNextPage || null;
window.goPrevPage = window.goPrevPage || null;
window.safeStartReading = window.safeStartReading || null;
window.safeStopReading = window.safeStopReading || null;

// Safe call helpers
function safeCallGlobal(fn, ...args) {
    try {
        if (typeof fn === "function") return fn(...args);
    } catch (err) {
        console.warn("safeCallGlobal: function threw", err);
    }
    return undefined;
}
function safeCallGlobalAsync(fn, ...args) {
    try {
        if (typeof fn === "function") {
            return Promise.resolve(fn(...args)).catch(err => {
                console.warn("safeCallGlobalAsync: function rejected", err);
            });
        }
    } catch (err) {
        console.warn("safeCallGlobalAsync: function threw", err);
    }
    return Promise.resolve(undefined);
}

// ---------------- Configuration & state ----------------
const EPUB_PATH = "books/CleanSource-Paged.epub";

const SHORT_CLICK_MS = 300;
const TTS_TOGGLE_DEBOUNCE_MS = 350;
const tocSelect = document.getElementById("tocSelect");
const pageIndicator = document.getElementById("pageIndicator");
let epubZip = null;
let epubOpfPath = null;
async function renderInitialSpinePage() {
    let spineItem = spine[currentSpineIndex]; // or however you're selecting the spine item
    let htmlText = await zip.file(spineItem.href).async("string");

    if (pageContainer) {
        pageContainer.innerHTML = htmlText;
        pageContainer.scrollTop = 0;
        pageContainer.style.overflowY = (currentSpineIndex === firstTextSpineIndex) ? "hidden" : "scroll";
    }
}

// ✅ Call the function
renderInitialSpinePage();


// strip standalone asterisk separators of 3 or more characters (safer, general)
try {
    const parser = new DOMParser();
    // wrap so we have a container to operate on
    const doc = parser.parseFromString('<div id="__tmp">' + htmlText + '</div>', 'text/html');
    const container = doc.getElementById('__tmp');
    if (container) {
        Array.from(container.querySelectorAll('p, div')).forEach(node => {
            // skip nodes inside pre/code/blockquote/figure/figcaption (preserve code/figures)
            if (node.closest && node.closest('pre, code, blockquote, figure, figcaption')) return;
            const txt = (node.textContent || '').trim();
            if (/^\*{3,}$/.test(txt)) {
                const hr = doc.createElement('hr');
                hr.className = 'reader-sep-asterisks';
                node.parentNode.replaceChild(hr, node);
            }
        });
        htmlText = container.innerHTML;
    }
} catch (e) {
    console.warn('strip-asterisks failed:', e);
}

  // ==== small style-fix to ensure rendered pages are visible ====
      try {
            const bookFrameEl = document.getElementById('bookFrame');
            if (bookFrameEl) {
                  // remove any full-black frame background that can block text
                      bookFrameEl.style.background = bookFrameEl.style.background || 'transparent';
                  bookFrameEl.style.zIndex = bookFrameEl.style.zIndex || '0';
                }
        
                const pc = document.getElementById('pageContainer');
            if (pc) {
                  pc.style.background = pc.style.background || '#f7f3e8'; // cream reader background
                  pc.style.color = pc.style.color || '#111';             // dark text
                  pc.style.zIndex = pc.style.zIndex || '1';
                  pc.querySelectorAll('a, h1, h2, h3, p, li').forEach(e => {
                        if (!e.style.color) e.style.color = '#111';
                      });
                }
          } catch (e) {
                console.warn("style-fix failed:", e);
              }

let currentSpineIndex = 0;
let showingStaticCover = true;
let firstTextSpineIndex = 0;
let epubToc = [];
let _pointerDownTs = 0;

// Exposed flags
window.openCoverFlag = 0;
window.openTitleFlag = 0;
window.TTSon = 0;
window.endnoteFlag = 0;

// ---------------- Utility helpers ----------------
function resolveZipPath(opfPath, href) {
    const lastSlash = opfPath ? opfPath.lastIndexOf("/") : -1;
    const base = (lastSlash >= 0) ? opfPath.substring(0, lastSlash + 1) : "";
    return (base + href).replace(/\\/g, "/");
}

// strip standalone asterisk separators of 3 or more characters (safer, general)
try {
    const parser = new DOMParser();
    // wrap so we have a container to operate on
    const container = doc.getElementById('__tmp');
    if (container) {
        Array.from(container.querySelectorAll('p, div')).forEach(node => {
            // skip nodes inside pre/code/blockquote/figure/figcaption (preserve code/figures)
            if (node.closest && node.closest('pre, code, blockquote, figure, figcaption')) return;
            const txt = (node.textContent || '').trim();
            if (/^\*{3,}$/.test(txt)) {
                const hr = doc.createElement('hr');
                hr.className = 'reader-sep-asterisks';
                node.parentNode.replaceChild(hr, node);
            }
        });
    }
} catch (e) {
    console.warn('strip-asterisks failed:', e);
}

function isErrorPageHtml(doc) {
    if (!doc || !doc.body) return false;
    const rawText = (doc.body.textContent || "").replace(/\s+/g, " ").trim();
    const text = rawText.toLowerCase();

    if (!text || text.length < 80) {
        const imgs = doc.body.querySelectorAll("img");
        if (imgs.length === 0) return true;
        if ((doc.body.innerText || "").trim().length < 60) return true;
    }

    const strongMarkers = [
        "this page contains the following errors",
        "below is a rendering of the page up to the first error",
        "calibre, version",
        "epub parsing error",
        "error on line",
        "xml parsing error",
        "syntax error",
        "this file is corrupt",
        "could not be rendered"
    ];
    if (strongMarkers.some(m => text.includes(m))) return true;

    const mildMarkers = [
        "epub error",
        "could not be displayed",
        "could not be rendered",
        "unexpected token"
    ];
    if (mildMarkers.some(m => text.includes(m)) && text.length < 1500) return true;

    const onlySvg = doc.body.querySelectorAll("svg").length > 0 && (doc.body.innerText || "").trim().length < 60;
    if (onlySvg) return true;

    const imageTags = doc.body.querySelectorAll("img");
    if (imageTags.length > 0 && (doc.body.innerText || "").trim().length < 60) return true;

    const wordChars = (rawText.match(/\w/g) || []).length;
    const totalChars = rawText.length || 1;
    if ((wordChars / totalChars) < 0.02 && totalChars < 2000) return true;

    return false;


    Copy
    /* reader.js
       Integrated reader script (merged reader + reader-paged behavior)
       - Combines the core reader logic with the paged-reader enhancements.
       - Self-contained: drop this into your served reader.js (overwrite the existing).
       - Defensive: exposes/uses globals consistently and logs helpful messages.
    */

    "use strict";

    // ==== Compatibility shim (ensures other scripts won't throw) ====
    window.coverClickHandler = window.coverClickHandler || null;
    window.goNextPage = window.goNextPage || null;
    window.goPrevPage = window.goPrevPage || null;
    window.safeStartReading = window.safeStartReading || null;
    window.safeStopReading = window.safeStopReading || null;

    // Safe call helpers
    function safeCallGlobal(fn, ...args) {
        try {
            if (typeof fn === "function") return fn(...args);
        } catch (err) {
            console.warn("safeCallGlobal: function threw", err);
        }
        return undefined;
    }
    function safeCallGlobalAsync(fn, ...args) {
        try {
            if (typeof fn === "function") {
                return Promise.resolve(fn(...args)).catch(err => {
                    console.warn("safeCallGlobalAsync: function rejected", err);
                });
            }
        } catch (err) {
            console.warn("safeCallGlobalAsync: function threw", err);
        }
        return Promise.resolve(undefined);
    }

    // ---------------- Configuration & state ----------------


    const SHORT_CLICK_MS = 300;
    const TTS_TOGGLE_DEBOUNCE_MS = 350;
    const pageIndicator = document.getElementById("pageIndicator");
    const fontStatus = document.getElementById("fontStatus");


    // (PATCH APPLIED HERE)
    function applyHtmlAndFixes(htmlText) {
        if (pageContainer) {
            pageContainer.innerHTML = htmlText;
            pageContainer.scrollTop = 0;
            pageContainer.style.overflowY =
                (currentSpineIndex === firstTextSpineIndex) ? "hidden" : "scroll";
        }

        // strip standalone asterisk separators of 3 or more characters (safer, general)
        try {
            const parser = new DOMParser();
            const container = doc.getElementById('__tmp');
            if (container) {
                Array.from(container.querySelectorAll('p, div')).forEach(node => {
                    if (node.closest && node.closest('pre, code, blockquote, figure, figcaption')) return;
                    const txt = (node.textContent || '').trim();
                    if (/^\*{3,}$/.test(txt)) {
                        const hr = doc.createElement('hr');
                        hr.className = 'reader-sep-asterisks';
                        node.parentNode.replaceChild(hr, node);
                    }
                });
            }
        } catch (e) {
            console.warn('strip-asterisks failed:', e);
        }

        // ==== small style-fix to ensure rendered pages are visible ====
        try {
            const bookFrameEl = document.getElementById('bookFrame');
            if (bookFrameEl) {
                bookFrameEl.style.background = bookFrameEl.style.background || 'transparent';
                bookFrameEl.style.zIndex = bookFrameEl.style.zIndex || '0';
            }

            const pc = document.getElementById('pageContainer');
            if (pc) {
                pc.style.background = pc.style.background || '#f7f3e8';
                pc.style.color = pc.style.color || '#111';
                pc.style.zIndex = pc.style.zIndex || '1';
                pc.querySelectorAll('a, h1, h2, h3, p, li').forEach(e => {
                    if (!e.style.color) e.style.color = '#111';
                });
            }
        } catch (e) {
            console.warn("style-fix failed:", e);
        }

        return htmlText;
    }

    // ---------------- Remaining state ----------------

    window.openCoverFlag = 0;
    window.openTitleFlag = 0;
    window.TTSon = 0;
    window.endnoteFlag = 0;

    // ---------------- Utility helpers ----------------
    function resolveZipPath(opfPath, href) {
        const lastSlash = opfPath ? opfPath.lastIndexOf("/") : -1;
        const base = (lastSlash >= 0) ? opfPath.substring(0, lastSlash + 1) : "";
        return (base + href).replace(/\\/g, "/");
    }

    // (duplicate strip-asterisks block removed in cleaned version)

    // Error-page detector
    function isErrorPageHtml(doc) {
        if (!doc || !doc.body) return false;
        const rawText = (doc.body.textContent || "").replace(/\s+/g, " ").trim();
        const text = rawText.toLowerCase();

        if (!text || text.length < 80) {
            const imgs = doc.body.querySelectorAll("img");
            if (imgs.length === 0) return true;
            if ((doc.body.innerText || "").trim().length < 60) return true;
        }

        const strongMarkers = [
            "this page contains the following errors",
            "below is a rendering of the page up to the first error",
            "calibre, version",
            "epub parsing error",
            "error on line",
            "xml parsing error",
            "syntax error",
            "this file is corrupt",
            "could not be rendered"
        ];
        if (strongMarkers.some(m => text.includes(m))) return true;

        const mildMarkers = [
            "epub error",
            "could not be displayed",
            "could not be rendered",
            "unexpected token"
        ];
        if (mildMarkers.some(m => text.includes(m)) && text.length < 1500) return true;

        const onlySvg = doc.body.querySelectorAll("svg").length > 0 &&
            (doc.body.innerText || "").trim().length < 60;
        if (onlySvg) return true;

        const imageTags = doc.body.querySelectorAll("img");
        if (imageTags.length > 0 &&
            (doc.body.innerText || "").trim().length < 60) return true;

        const wordChars = (rawText.match(/\w/g) || []).length;
        const totalChars = rawText.length || 1;
        if ((wordChars / totalChars) < 0.02 && totalChars < 2000) return true;

        return false;
    }

}

async function fixImagesInHtml(htmlText, zip, basePath) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlText, "text/html");

    try {
        const links = Array.from(doc.querySelectorAll('link[rel="stylesheet"][href]'));
        for (const link of links) {
            try {
                let href = (link.getAttribute("href") || "").replace(/^\.?\//, "");
                let cssPath = (basePath ? basePath + href : href).replace(/\\/g, "/");
                let file = zip.file(cssPath);
                if (!file && epubOpfPath) {
                    const alt = resolveZipPath(epubOpfPath, href);
                    file = zip.file(alt);
                }
                if (file) {
                    const cssText = await file.async("text");
                    const style = doc.createElement("style");
                    style.textContent = cssText;
                    link.parentNode.insertBefore(style, link);
                    link.remove();
                    continue;
                }
                link.remove();
            } catch (err) {
                try { link.remove(); } catch (e) { }
            }
        }
    } catch (err) {
        console.warn("inlineCssFromDoc failed:", err);
    }

    doc.querySelectorAll('link[rel="icon"], link[href$="favicon.ico"], link[href$="page_styles.css"]').forEach(l => l.remove());

    const imgTags = doc.querySelectorAll("img[src]");
    for (const img of imgTags) {
        const origSrc = img.getAttribute("src") || "";
        if (!origSrc) continue;
        if (/^(https?:)?\/\//i.test(origSrc) || origSrc.startsWith("data:")) continue;

        const normalizedSrc = origSrc.replace(/^\.?\//, "");
        const zipPath = (basePath ? basePath + normalizedSrc : normalizedSrc).replace(/\\/g, "/");
        const fileInZip = zip.file(zipPath);
        if (!fileInZip) {
            const ph = doc.createElement("div");
            ph.className = "image-placeholder";
            img.replaceWith(ph);
            continue;
        }

        try {
            const blob = await fileInZip.async("blob");
            const localUrl = URL.createObjectURL(blob);
            img.src = localUrl;
        } catch (err) {
            const ph = doc.createElement("div");
            ph.className = "image-placeholder";
            img.replaceWith(ph);
        }
    }

    try {
        const body = doc.body;
        body.style.margin = "0";
        body.style.padding = "0.5rem 0.75rem";
        body.style.fontFamily = 'Georgia, "Times New Roman", serif';
        body.style.fontSize = "1rem";
        body.style.lineHeight = "1.5";
        body.style.backgroundColor = "#f7f3e8";
        body.querySelectorAll("p").forEach((p, idx) => {
            p.style.margin = "0.6rem 0";
            p.style.textAlign = "justify";
            if (idx === 0) p.style.textIndent = "0";
        });
    } catch (err) { }

    if (isErrorPageHtml(doc)) {
        const wrapper = document.createElement("div");
        wrapper.textContent = "[This EPUB page contained a rendering error and was skipped.]";
        return wrapper.outerHTML;
    }

    return doc.body ? doc.body.innerHTML : "";
}

// ---------------- EPUB loading & TOC ----------------
async function loadEpubFile() {
    try {
        const response = await fetch(EPUB_PATH);
        if (!response.ok) throw new Error("Failed to fetch EPUB file: " + response.status);
        const arrayBuffer = await response.arrayBuffer();
        const zip = await JSZip.loadAsync(arrayBuffer);

        const containerFile = zip.file("META-INF/container.xml");
        if (!containerFile) throw new Error("META-INF/container.xml not found in EPUB");

        const containerXml = await containerFile.async("text");
        const parser = new DOMParser();
        const containerDoc = parser.parseFromString(containerXml, "application/xml");
        const rootfileEl = containerDoc.querySelector("rootfile");
        if (!rootfileEl) throw new Error("<rootfile> not found in container.xml");

        const opfPath = rootfileEl.getAttribute("full-path");
        if (!opfPath) throw new Error("No OPF full-path in container.xml");

        const opfFile = zip.file(opfPath);
        if (!opfFile) throw new Error("OPF file not found at " + opfPath);

        const opfText = await opfFile.async("text");
        const opfDoc = parser.parseFromString(opfText, "application/xml");

        const manifestById = new Map();
        opfDoc.querySelectorAll("manifest > item").forEach(item => {
            const id = item.getAttribute("id");
            const href = item.getAttribute("href");
            if (id && href) manifestById.set(id, href);
        });

        const spinePaths = [];
        opfDoc.querySelectorAll("spine > itemref").forEach(itemref => {
            const idref = itemref.getAttribute("idref");
            const href = manifestById.get(idref);
            if (href) {
                const fullPath = resolveZipPath(opfPath, href);
                spinePaths.push(fullPath);
            }
        });

        if (!spinePaths.length) throw new Error("EPUB spine is empty");

        epubZip = zip;
        epubSpine = spinePaths;
        epubOpfPath = opfPath;

        // --- expose EPUB state to global scope (other scripts / diagnostics expect these) ---
        window.epubZip = epubZip;
        window.epubSpine = epubSpine;
        window.epubOpfPath = epubOpfPath;
        window.firstTextSpineIndex = (typeof firstTextSpineIndex === "number") ? firstTextSpineIndex : 0;
        window.currentSpineIndex = (typeof currentSpineIndex === "number") ? currentSpineIndex : 0;
        window.showingStaticCover = (typeof showingStaticCover !== "undefined") ? showingStaticCover : true;

        console.log("[v5] exposed globals:", { epubSpineLength: (window.epubSpine || []).length, epubOpfPath: window.epubOpfPath, showingStaticCover: window.showingStaticCover });

        console.log("[v5] EPUB loaded. OPF:", opfPath, "spine length:", spinePaths.length);
        return { zip, spine: spinePaths, opfPath };
    } catch (err) {
        console.error("EPUB load error:", err);
        return null;
    }


}

async function fixImagesInHtml(htmlText, zip, basePath) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlText, "text/html");

    try {
        const links = Array.from(doc.querySelectorAll('link[rel="stylesheet"][href]'));
        for (const link of links) {
            try {
                let href = (link.getAttribute("href") || "").replace(/^\.?\//, "");
                let cssPath = (basePath ? basePath + href : href).replace(/\\/g, "/");
                let file = zip.file(cssPath);
                if (!file && epubOpfPath) {
                    const alt = resolveZipPath(epubOpfPath, href);
                    file = zip.file(alt);
                }
                if (file) {
                    const cssText = await file.async("text");
                    const style = doc.createElement("style");
                    style.textContent = cssText;
                    link.parentNode.insertBefore(style, link);
                    link.remove();
                    continue;
                }
                link.remove();
            } catch (err) {
                try { link.remove(); } catch (e) { }
            }
        }
    } catch (err) {
        console.warn("inlineCssFromDoc failed:", err);
    }

    doc.querySelectorAll('link[rel="icon"], link[href$="favicon.ico"], link[href$="page_styles.css"]').forEach(l => l.remove());

    const imgTags = doc.querySelectorAll("img[src]");
    for (const img of imgTags) {
        const origSrc = img.getAttribute("src") || "";
        if (!origSrc) continue;
        if (/^(https?:)?\/\//i.test(origSrc) || origSrc.startsWith("data:")) continue;

        const normalizedSrc = origSrc.replace(/^\.?\//, "");
        const zipPath = (basePath ? basePath + normalizedSrc : normalizedSrc).replace(/\\/g, "/");
        const fileInZip = zip.file(zipPath);
        if (!fileInZip) {
            const ph = doc.createElement("div");
            ph.className = "image-placeholder";
            img.replaceWith(ph);
            continue;
        }

        try {
            const blob = await fileInZip.async("blob");
            const localUrl = URL.createObjectURL(blob);
            img.src = localUrl;
        } catch (err) {
            const ph = doc.createElement("div");
            ph.className = "image-placeholder";
            img.replaceWith(ph);
        }
    }

    try {
        const body = doc.body;
        body.style.margin = "0";
        body.style.padding = "0.5rem 0.75rem";
        body.style.fontFamily = 'Georgia, "Times New Roman", serif';
        body.style.fontSize = "1rem";
        body.style.lineHeight = "1.5";
        body.style.backgroundColor = "#f7f3e8";
        body.querySelectorAll("p").forEach((p, idx) => {
            p.style.margin = "0.6rem 0";
            p.style.textAlign = "justify";
            if (idx === 0) p.style.textIndent = "0";
        });
    } catch (err) { }

    if (isErrorPageHtml(doc)) {
        const wrapper = document.createElement("div");
        wrapper.textContent = "[This EPUB page contained a rendering error and was skipped.]";
        return wrapper.outerHTML;
    }

    return doc.body ? doc.body.innerHTML : "";
}

// ---------------- EPUB loading & TOC ----------------
async function loadEpubFile() {
    try {
        const response = await fetch(EPUB_PATH);
        if (!response.ok) throw new Error("Failed to fetch EPUB file: " + response.status);
        const arrayBuffer = await response.arrayBuffer();
        const zip = await JSZip.loadAsync(arrayBuffer);

        const containerFile = zip.file("META-INF/container.xml");
        if (!containerFile) throw new Error("META-INF/container.xml not found in EPUB");

        const containerXml = await containerFile.async("text");
        const parser = new DOMParser();
        const containerDoc = parser.parseFromString(containerXml, "application/xml");
        const rootfileEl = containerDoc.querySelector("rootfile");
        if (!rootfileEl) throw new Error("<rootfile> not found in container.xml");

        const opfPath = rootfileEl.getAttribute("full-path");
        if (!opfPath) throw new Error("No OPF full-path in container.xml");

        const opfFile = zip.file(opfPath);
        if (!opfFile) throw new Error("OPF file not found at " + opfPath);

        const opfText = await opfFile.async("text");
        const opfDoc = parser.parseFromString(opfText, "application/xml");

        const manifestById = new Map();
        opfDoc.querySelectorAll("manifest > item").forEach(item => {
            const id = item.getAttribute("id");
            const href = item.getAttribute("href");
            if (id && href) manifestById.set(id, href);
        });

        const spinePaths = [];
        opfDoc.querySelectorAll("spine > itemref").forEach(itemref => {
            const idref = itemref.getAttribute("idref");
            const href = manifestById.get(idref);
            if (href) {
                const fullPath = resolveZipPath(opfPath, href);
                spinePaths.push(fullPath);
            }
        });

        if (!spinePaths.length) throw new Error("EPUB spine is empty");

        epubZip = zip;
        epubSpine = spinePaths;
        epubOpfPath = opfPath;

        // --- expose EPUB state to global scope (other scripts / diagnostics expect these) ---
        window.epubZip = epubZip;
        window.epubSpine = epubSpine;
        window.epubOpfPath = epubOpfPath;
        window.firstTextSpineIndex = (typeof firstTextSpineIndex === "number") ? firstTextSpineIndex : 0;
        window.currentSpineIndex = (typeof currentSpineIndex === "number") ? currentSpineIndex : 0;
        window.showingStaticCover = (typeof showingStaticCover !== "undefined") ? showingStaticCover : true;

        console.log("[v5] exposed globals:", {
            epubSpineLength: (window.epubSpine || []).length,
            epubOpfPath: window.epubOpfPath,
            showingStaticCover: window.showingStaticCover
        });

        console.log("[v5] EPUB loaded. OPF:", opfPath, "spine length:", spinePaths.length);
        return { zip, spine: spinePaths, opfPath };
    } catch (err) {
        console.error("EPUB load error:", err);
        return null;
    }
}


async function buildToc() {
    if (!epubZip || !epubSpine) return;
    for (let i = 0; i < epubSpine.length; i++) {
        const spinePath = epubSpine[i];
        const file = epubZip.file(spinePath);
        if (!file) continue;
        try {
            const html = await file.async("text");
            const doc = new DOMParser().parseFromString(html, "text/html");
            const headings = doc.querySelectorAll("h1, h2, h3");
            if (!headings.length) continue;
            const levelCounters = { h1: 0, h2: 0, h3: 0 };
            headings.forEach(h => {
                const level = h.tagName.toLowerCase();
                const label = h.textContent.trim();
                const idxInLevel = levelCounters[level] ?? 0;
                levelCounters[level] = idxInLevel + 1;
                epubToc.push({
                    spineIndex: i,
                    level,
                    headingIndex: idxInLevel,
                    label
                });
            });
        } catch (err) {
            console.warn("buildToc: failed to parse spine", i, err);
        }
    }
    populateTocDropdown();
}

function populateTocDropdown() {
    if (!tocSelect) return;
    tocSelect.innerHTML = "";
    epubToc.forEach((entry, idx) => {
        const opt = document.createElement("option");
        opt.value = String(idx);
        let prefix = "";
        if (entry.level === "h2") prefix = "  • ";
        if (entry.level === "h3") prefix = "    ▸ ";
        opt.textContent = prefix + entry.label;
        tocSelect.appendChild(opt);
    });
}

// ---------------- Rendering & navigation ----------------
async function renderSpinePage(spineIndex) {
    if (!epubZip || !epubSpine.length) throw new Error("EPUB not initialised");
    if (spineIndex < 0) spineIndex = 0;
    if (spineIndex >= epubSpine.length) spineIndex = epubSpine.length - 1;
    currentSpineIndex = spineIndex;
    const spinePath = epubSpine[spineIndex];
    const file = epubZip.file(spinePath);
    if (!file) throw new Error("Spine item not found in ZIP: " + spinePath);

    let htmlText = await file.async("text");
    const lastSlash = spinePath.lastIndexOf("/");
    const basePath = (lastSlash >= 0) ? spinePath.substring(0, lastSlash + 1) : "";
    htmlText = await fixImagesInHtml(htmlText, epubZip, basePath);

    // strip standalone asterisk separators of 3 or more characters (safer, general)
    try {
        const parser = new DOMParser();
        // wrap so we have a container to operate on
        const container = doc.getElementById('__tmp');
        if (container) {
            Array.from(container.querySelectorAll('p, div')).forEach(node => {
                // skip nodes inside pre/code/blockquote/figure/figcaption (preserve code/figures)
                if (node.closest && node.closest('pre, code, blockquote, figure, figcaption')) return;
                const txt = (node.textContent || '').trim();
                if (/^\*{3,}$/.test(txt)) {
                    const hr = doc.createElement('hr');
                    hr.className = 'reader-sep-asterisks';
                    node.parentNode.replaceChild(hr, node);
                }
            });
        }
    } catch (e) {
        console.warn('strip-asterisks failed:', e);
    }

    // strip standalone asterisk separators of 3 or more characters (safer, general)
    try {
        const parser = new DOMParser();
        // wrap so we have a container to operate on
        const container = doc.getElementById('__tmp');
        if (container) {
            Array.from(container.querySelectorAll('p, div')).forEach(node => {
                // skip nodes inside pre/code/blockquote/figure/figcaption (preserve code/figures)
                if (node.closest && node.closest('pre, code, blockquote, figure, figcaption')) return;
                const txt = (node.textContent || '').trim();
                if (/^\*{3,}$/.test(txt)) {
                    const hr = doc.createElement('hr');
                    hr.className = 'reader-sep-asterisks';
                    node.parentNode.replaceChild(hr, node);
                }
            });
        }
    } catch (e) {
        console.warn('strip-asterisks failed:', e);
    }

    if (pageContainer) {
        pageContainer.innerHTML = htmlText;
        pageContainer.scrollTop = 0;
        pageContainer.style.overflowY = (currentSpineIndex === firstTextSpineIndex) ? "hidden" : "scroll";
    }

    // ==== small style-fix to ensure rendered pages are visible ====
    try {
        const bookFrameEl = document.getElementById('bookFrame');
        if (bookFrameEl) {
            // remove any full-black frame background that can block text
            bookFrameEl.style.background = bookFrameEl.style.background || 'transparent';
            bookFrameEl.style.zIndex = bookFrameEl.style.zIndex || '0';
        }

        const pc = document.getElementById('pageContainer');
        if (pc) {
            pc.style.background = pc.style.background || '#f7f3e8'; // cream reader background
            pc.style.color = pc.style.color || '#111';             // dark text
            pc.style.zIndex = pc.style.zIndex || '1';
            pc.querySelectorAll('a, h1, h2, h3, p, li').forEach(e => {
                if (!e.style.color) e.style.color = '#111';
            });
        }
    } catch (e) {
        console.warn("style-fix failed:", e);
    }

    if (!showingStaticCover && pageIndicator) {
        pageIndicator.textContent = `Page ${spineIndex + 1} / ${epubSpine.length}`;
    }
}

async function buildToc() {
    if (!epubZip || !epubSpine) return;
    for (let i = 0; i < epubSpine.length; i++) {
        const spinePath = epubSpine[i];
        const file = epubZip.file(spinePath);
        if (!file) continue;
        try {
            const html = await file.async("text");
            const doc = new DOMParser().parseFromString(html, "text/html");
            const headings = doc.querySelectorAll("h1, h2, h3");
            if (!headings.length) continue;
            const levelCounters = { h1: 0, h2: 0, h3: 0 };
            headings.forEach(h => {
                const level = h.tagName.toLowerCase();
                const label = h.textContent.trim();
                const idxInLevel = levelCounters[level] ?? 0;
                levelCounters[level] = idxInLevel + 1;
                epubToc.push({
                    spineIndex: i,
                    level,
                    headingIndex: idxInLevel,
                    label
                });
            });
        } catch (err) {
            console.warn("buildToc: failed to parse spine", i, err);
        }
    }
    populateTocDropdown();
}

function populateTocDropdown() {
    if (!tocSelect) return;
    tocSelect.innerHTML = "";
    epubToc.forEach((entry, idx) => {
        const opt = document.createElement("option");
        opt.value = String(idx);
        let prefix = "";
        if (entry.level === "h2") prefix = "  • ";
        if (entry.level === "h3") prefix = "    ▸ ";
        opt.textContent = prefix + entry.label;
        tocSelect.appendChild(opt);
    });
}

// ---------------- Rendering & navigation ----------------

async function goNextPage() {
    if (showingStaticCover) {
        hideStaticCoverIfNeeded();
        return;
    }
    if (currentSpineIndex === firstTextSpineIndex) {
        if (currentSpineIndex < epubSpine.length - 1) {
            safeStopReading();
            await renderSpinePage(currentSpineIndex + 1);
        }
        return;
    }
    if (pageContainer) {
        const visible = pageContainer.clientHeight;
        const top = pageContainer.scrollTop;
        const total = pageContainer.scrollHeight;
        const remaining = total - (top + visible);
        const THRESHOLD = 10;
        if (remaining > THRESHOLD) {
            pageContainer.scrollBy({ top: visible * 0.9, behavior: "smooth" });
            return;
        }
    }
    if (!epubSpine.length) return;
    if (currentSpineIndex >= epubSpine.length - 1) return;
    safeStopReading();
    await renderSpinePage(currentSpineIndex + 1);
}

async function goPrevPage() {
    if (showingStaticCover) return;
    if (currentSpineIndex === firstTextSpineIndex) {
        const cover = document.getElementById("staticCover");
        const pageInner = document.getElementById("pageInner");
        if (cover) cover.style.display = "flex";
        if (pageInner) pageInner.style.display = "none";
        showingStaticCover = true;
        if (pageIndicator) pageIndicator.textContent = "Cover";
        return;
    }
    if (pageContainer) {
        const visible = pageContainer.clientHeight;
        const top = pageContainer.scrollTop;
        const THRESHOLD = 10;
        if (top > THRESHOLD) {
            pageContainer.scrollBy({ top: -visible * 0.9, behavior: "smooth" });
            return;
        }
    }
    if (!epubSpine.length) return;
    if (currentSpineIndex <= 0) return;
    safeStopReading();
    await renderSpinePage(currentSpineIndex - 1);
}

// ---------------- TTS wrappers ----------------
function safeStartReading() {
    if (typeof window.startReading === "function") {
        try { window.startReading(); window.TTSon = 1; return; } catch (e) { console.warn("startReading threw", e); }
    }
    if (!window.speechSynthesis) { console.warn("No speechSynthesis available"); return; }
    try {
        const text = pageContainer ? pageContainer.innerText.trim() : "";
        if (!text) return;
        window.speechSynthesis.cancel();
        const utt = new SpeechSynthesisUtterance(text);
        utt.rate = (typeof window.ttsRate === "number") ? window.ttsRate : 1.0;
        utt.onend = () => { window.TTSon = 0; };
        window.speechSynthesis.speak(utt);
        window.TTSon = 1;
    } catch (err) {
        console.error("safeStartReading error:", err);
    }
}

function safeStopReading() {
    if (typeof window.stopReading === "function") {
        try { window.stopReading(); window.TTSon = 0; return; } catch (e) { console.warn("stopReading threw", e); }
    }
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    window.TTSon = 0;
}

// ---------------- Cover & click behaviors ----------------
function hideStaticCoverIfNeeded() {
    if (!showingStaticCover) return;
    const cover = document.getElementById("staticCover");
    const pageInner = document.getElementById("pageInner");
    if (cover) cover.style.display = "none";
    if (pageInner) pageInner.style.display = "flex";
    showingStaticCover = false;
    if (epubSpine && epubSpine.length && pageIndicator) {
        pageIndicator.textContent = `Page ${currentSpineIndex + 1} / ${epubSpine.length}`;
    }
}

async function coverClickHandlerImpl(e) {
    try {
        if (!showingStaticCover) return;
        if (window.endnoteFlag) return;
        window.openCoverFlag = 1;

        if (typeof window.hideStaticCoverIfNeeded === "function") {
            try { window.hideStaticCoverIfNeeded(); } catch (e) { log("hideStaticCoverIfNeeded threw", e); }
        } else {
            hideStaticCoverIfNeeded();
        }

        if (!epubZip || !epubSpine || !epubSpine.length) return;

        const startIdx = (typeof firstTextSpineIndex === "number") ? firstTextSpineIndex : 0;
        for (let i = startIdx; i < epubSpine.length; i++) {
            try {
                const spinePath = epubSpine[i];
                const file = epubZip.file(spinePath);
                if (!file) continue;
                const html = await file.async("text");
                const lastSlash = spinePath.lastIndexOf("/");
                const basePath = (lastSlash >= 0) ? spinePath.substring(0, lastSlash + 1) : "";
                const fixed = (typeof window.fixImagesInHtml === "function")
                    ? await window.fixImagesInHtml(html, epubZip, basePath)
                    : await fixImagesInHtml(html, epubZip, basePath);

                const parser = new DOMParser();
                const doc = parser.parseFromString(fixed, "text/html");
                if (isErrorPageHtml(doc)) {
                    console.warn("[reader] skipping broken spine", i, spinePath);
                    continue;
                }

                await renderSpinePage(i);
                window.openTitleFlag = (i === startIdx) ? 1 : 0;
                return;
            } catch (err) {
                console.warn("coverClickHandler: skipping spine due to error", err);
                continue;
            }
        }

        await renderSpinePage(startIdx);
        window.openTitleFlag = 1;
    } catch (err) {
        console.error("coverClickHandler error:", err);
    }
}

function attachCoverClick() {
    const coverEl = document.getElementById("staticCover");
    if (!coverEl) return;
    try { coverEl.removeEventListener("click", window.coverClickHandler || coverClickHandlerImpl); } catch (e) { }
    coverEl.addEventListener("click", async (ev) => {
        if (typeof window.coverClickHandler === "function" && window.coverClickHandler !== coverClickHandlerImpl) {
            try { await window.coverClickHandler(ev); return; } catch (e) { log("coverClickHandler threw", e); }
        }
        await coverClickHandlerImpl(ev);
    }, { passive: true });
}

function attachPageClickBehavior() {
    const pageEl = document.getElementById("pageContainer");
    if (!pageEl) { log("attachPageClickBehavior: #pageContainer not found"); return; }

    if (pageEl._readerPagedAttached) return;
    pageEl._readerPagedAttached = true;

    pageEl.addEventListener("pointerdown", () => {
        _pointerDownTs = Date.now();
    }, { passive: true });

    pageEl.addEventListener("pointerup", async (ev) => {
        const down = _pointerDownTs || 0;
        const dt = Date.now() - down;
        if (dt <= 0 || dt > SHORT_CLICK_MS) return;
        if (window.endnoteFlag) return;
        if (ev.target && ev.target.closest && ev.target.closest("a, button, input, textarea, select")) return;

        if (showingStaticCover) {
            await coverClickHandlerImpl();
            return;
        }

        if (currentSpineIndex === firstTextSpineIndex) {
            await goNextPage();
            return;
        }

        const now = Date.now();
        if (now - _lastTtsToggleAt < TTS_TOGGLE_DEBOUNCE_MS) return;
        _lastTtsToggleAt = now;

        if (window.TTSon) safeStopReading(); else safeStartReading();
    }, { passive: true });

    pageEl.addEventListener("dblclick", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
    }, { passive: true });
}

// ---------------- Initialization ----------------
async function initReader() {
    try {
        const loaded = await loadEpubFile();
        if (!loaded) {
            console.error("Failed to load EPUB. Check EPUB_PATH and /lib/jszip.min.js availability.");
            return;
        }

        const coverCandidate = (typeof findCoverForEpub === "function") ? findCoverForEpub(EPUB_PATH) : null;
        if (coverCandidate && staticCoverImg) {
            try { staticCoverImg.src = coverCandidate; } catch (err) { console.warn("setting static cover src failed:", err); }
        }

        if (pageIndicator) pageIndicator.textContent = "Cover";

        buildToc().catch(err => console.warn("buildToc failed:", err));

        attachCoverClick();
        attachPageClickBehavior();

        window.safeStartReading = safeStartReading;
        window.safeStopReading = safeStopReading;
        window.renderSpinePage = renderSpinePage;
        window.goNextPage = goNextPage;
        window.goPrevPage = goPrevPage;
        window.coverClickHandler = coverClickHandlerImpl;
        window.readerPagedInit = initReader;

        console.log("[v5] reader.js loaded");
        console.log("[v5] spine length =", epubSpine.length);
        console.log("[v5] TOC entries:", epubToc.length);
    } catch (err) {
        console.error("initReader error:", err);
    }
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initReader);
} else {
    setTimeout(initReader, 0);
}

// Utility: findCoverForEpub (keeps previous behavior)
function findCoverForEpub(epubPath) {
    const base = epubPath.replace(/^.*[\\/]/, "").replace(/\.epub$/i, "");
    return `covers/${base}_cover.png`;
}

async function goNextPage() {
    if (showingStaticCover) {
        hideStaticCoverIfNeeded();
        return;
    }
    if (currentSpineIndex === firstTextSpineIndex) {
        if (currentSpineIndex < epubSpine.length - 1) {
            safeStopReading();
            await renderSpinePage(currentSpineIndex + 1);
        }
        return;
    }
    if (pageContainer) {
        const visible = pageContainer.clientHeight;
        const top = pageContainer.scrollTop;
        const total = pageContainer.scrollHeight;
        const remaining = total - (top + visible);
        const THRESHOLD = 10;
        if (remaining > THRESHOLD) {
            pageContainer.scrollBy({ top: visible * 0.9, behavior: "smooth" });
            return;
        }
    }
    if (!epubSpine.length) return;
    if (currentSpineIndex >= epubSpine.length - 1) return;
    safeStopReading();
    await renderSpinePage(currentSpineIndex + 1);
}

async function goPrevPage() {
    if (showingStaticCover) return;
    if (currentSpineIndex === firstTextSpineIndex) {
        const cover = document.getElementById("staticCover");
        const pageInner = document.getElementById("pageInner");
        if (cover) cover.style.display = "flex";
        if (pageInner) pageInner.style.display = "none";
        if (pageIndicator) pageIndicator.textContent = "Cover";
        return;
    }
    if (pageContainer) {
        const visible = pageContainer.clientHeight;
        const top = pageContainer.scrollTop;
        const THRESHOLD = 10;
        if (top > THRESHOLD) {
            pageContainer.scrollBy({ top: -visible * 0.9, behavior: "smooth" });
            return;
        }
    }
    if (!epubSpine.length) return;
    if (currentSpineIndex <= 0) return;
    safeStopReading();
    await renderSpinePage(currentSpineIndex - 1);
}

// ---------------- TTS wrappers ----------------
function safeStartReading() {
    if (typeof window.startReading === "function") {
        try { window.startReading(); window.TTSon = 1; return; } catch (e) { console.warn("startReading threw", e); }
    }
    if (!window.speechSynthesis) { console.warn("No speechSynthesis available"); return; }
    try {
        const text = pageContainer ? pageContainer.innerText.trim() : "";
        if (!text) return;
        window.speechSynthesis.cancel();
        const utt = new SpeechSynthesisUtterance(text);
        utt.rate = (typeof window.ttsRate === "number") ? window.ttsRate : 1.0;
        utt.onend = () => { window.TTSon = 0; };
        window.speechSynthesis.speak(utt);
        window.TTSon = 1;
    } catch (err) {
        console.error("safeStartReading error:", err);
    }
}

function safeStopReading() {
    if (typeof window.stopReading === "function") {
        try { window.stopReading(); window.TTSon = 0; return; } catch (e) { console.warn("stopReading threw", e); }
    }
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    window.TTSon = 0;
}

// ---------------- Cover & click behaviors ----------------
function hideStaticCoverIfNeeded() {
    if (!showingStaticCover) return;
    const cover = document.getElementById("staticCover");
    const pageInner = document.getElementById("pageInner");
    if (cover) cover.style.display = "none";
    if (pageInner) pageInner.style.display = "flex";
    showingStaticCover = false;
    if (epubSpine && epubSpine.length && pageIndicator) {
        pageIndicator.textContent = `Page ${currentSpineIndex + 1} / ${epubSpine.length}`;
    }
}

async function coverClickHandlerImpl(e) {
    try {
        if (!showingStaticCover) return;
        if (window.endnoteFlag) return;
        window.openCoverFlag = 1;

        if (typeof window.hideStaticCoverIfNeeded === "function") {
            try { window.hideStaticCoverIfNeeded(); } catch (e) { log("hideStaticCoverIfNeeded threw", e); }
        } else {
            hideStaticCoverIfNeeded();
        }

        if (!epubZip || !epubSpine || !epubSpine.length) return;

        const startIdx = (typeof firstTextSpineIndex === "number") ? firstTextSpineIndex : 0;
        for (let i = startIdx; i < epubSpine.length; i++) {
            try {
                const spinePath = epubSpine[i];
                const file = epubZip.file(spinePath);
                if (!file) continue;
                const html = await file.async("text");
                const lastSlash = spinePath.lastIndexOf("/");
                const basePath = (lastSlash >= 0) ? spinePath.substring(0, lastSlash + 1) : "";
                const fixed = (typeof window.fixImagesInHtml === "function")
                    ? await window.fixImagesInHtml(html, epubZip, basePath)
                    : await fixImagesInHtml(html, epubZip, basePath);

                const parser = new DOMParser();
                const doc = parser.parseFromString(fixed, "text/html");
                if (isErrorPageHtml(doc)) {
                    console.warn("[reader] skipping broken spine", i, spinePath);
                    continue;
                }

                await renderSpinePage(i);
                window.openTitleFlag = (i === startIdx) ? 1 : 0;
                return;
            } catch (err) {
                console.warn("coverClickHandler: skipping spine due to error", err);
                continue;
            }
        }

        await renderSpinePage(startIdx);
        window.openTitleFlag = 1;
    } catch (err) {
        console.error("coverClickHandler error:", err);
    }
}

function attachCoverClick() {
    const coverEl = document.getElementById("staticCover");
    if (!coverEl) return;
    try { coverEl.removeEventListener("click", window.coverClickHandler || coverClickHandlerImpl); } catch (e) { }
    coverEl.addEventListener("click", async (ev) => {
        if (typeof window.coverClickHandler === "function" && window.coverClickHandler !== coverClickHandlerImpl) {
            try { await window.coverClickHandler(ev); return; } catch (e) { log("coverClickHandler threw", e); }
        }
        await coverClickHandlerImpl(ev);
    }, { passive: true });
}

function attachPageClickBehavior() {
    const pageEl = document.getElementById("pageContainer");
    if (!pageEl) { log("attachPageClickBehavior: #pageContainer not found"); return; }

    if (pageEl._readerPagedAttached) return;
    pageEl._readerPagedAttached = true;

    pageEl.addEventListener("pointerdown", () => {
        _pointerDownTs = Date.now();
    }, { passive: true });

    pageEl.addEventListener("pointerup", async (ev) => {
        const down = _pointerDownTs || 0;
        const dt = Date.now() - down;
        if (dt <= 0 || dt > SHORT_CLICK_MS) return;
        if (window.endnoteFlag) return;
        if (ev.target && ev.target.closest && ev.target.closest("a, button, input, textarea, select")) return;

        if (showingStaticCover) {
            await coverClickHandlerImpl();
            return;
        }

        if (currentSpineIndex === firstTextSpineIndex) {
            await goNextPage();
            return;
        }

        const now = Date.now();
        if (now - _lastTtsToggleAt < TTS_TOGGLE_DEBOUNCE_MS) return;
        _lastTtsToggleAt = now;

        if (window.TTSon) safeStopReading(); else safeStartReading();
    }, { passive: true });

    pageEl.addEventListener("dblclick", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
    }, { passive: true });
}

// ---------------- Initialization ----------------
async function initReader() {
    try {
        const loaded = await loadEpubFile();
        if (!loaded) {
            console.error("Failed to load EPUB. Check EPUB_PATH and /lib/jszip.min.js availability.");
            return;
        }

        const coverCandidate = (typeof findCoverForEpub === "function") ? findCoverForEpub(EPUB_PATH) : null;
        if (coverCandidate && staticCoverImg) {
            try { staticCoverImg.src = coverCandidate; } catch (err) { console.warn("setting static cover src failed:", err); }
        }

        if (pageIndicator) pageIndicator.textContent = "Cover";

        buildToc().catch(err => console.warn("buildToc failed:", err));

        attachCoverClick();
        attachPageClickBehavior();

        window.safeStartReading = safeStartReading;
        window.safeStopReading = safeStopReading;
        window.renderSpinePage = renderSpinePage;
        window.goNextPage = goNextPage;
        window.goPrevPage = goPrevPage;
        window.coverClickHandler = coverClickHandlerImpl;
        window.readerPagedInit = initReader;

        console.log("[v5] reader.js loaded");
        console.log("[v5] spine length =", epubSpine.length);
    } catch (err) {
        console.error("initReader error:", err);
    }
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initReader);
} else {
    setTimeout(initReader, 0);
}

// Utility: findCoverForEpub (keeps previous behavior)
function findCoverForEpub(epubPath) {
    const base = epubPath.replace(/^.*[\\/]/, "").replace(/\.epub$/i, "");
    return `covers/${base}_cover.png`;
}

/* reader.js (modular layout)
   1. Globals & configuration
   2. Utility helpers
   3. EPUB loading module
   4. HTML rendering module
   5. Navigation module (next/prev)
   6. TTS module
   7. Cover module
   8. Click/touch interaction module
   9. TOC module
   10. Initialization
*/

/* ============================================================
   MODULE: EPUB LOADING
   Handles: ZIP parsing, OPF parsing, spine extraction
   ============================================================ */

/**
 * Module: Navigation
 * Functions: goNextPage, goPrevPage
 * Description: Handles scrolling and spine transitions
 */

/* === Globals & Config === */
/* === Utility Helpers === */
/* === EPUB Loader === */
/* === HTML Renderer === */
/* === Navigation === */
/* === TTS === */
/* === Cover Logic === */
/* === Click Interaction === */
/* === TOC (placeholder) === */
/* === Spine Rendering (placeholder) === */
/* === Initialization === */

/* TODO: implement renderSpinePage() */

/* TODO: implement buildToc() */

/* reader.js
   Integrated, polished, modular reader script
   - Combines core reader logic with paged-reader behavior.
   - Self-contained: drop this into your served reader.js.
   - Globals are exposed carefully for other scripts/diagnostics.
*/

"use strict";

// Exposed flags
window.openCoverFlag = 0;
window.openTitleFlag = 0;
window.TTSon = 0;
window.endnoteFlag = 0;

/* === Compatibility Shim === */
/* Ensures other scripts that expect these globals won't throw */

window.coverClickHandler = window.coverClickHandler || null;
window.goNextPage = window.goNextPage || null;
window.goPrevPage = window.goPrevPage || null;
window.safeStartReading = window.safeStartReading || null;
window.safeStopReading = window.safeStopReading || null;

/* === Utility Helpers === */

const log = (...args) => {
    try {
        console.log("[reader]", ...args);
    } catch (e) {
        // ignore logging failures
    }
};

function safeCallGlobal(fn, ...args) {
    try {
        if (typeof fn === "function") return fn(...args);
    } catch (err) {
        console.warn("safeCallGlobal: function threw", err);
    }
    return undefined;
}

function safeCallGlobalAsync(fn, ...args) {
    try {
        if (typeof fn === "function") {
            return Promise.resolve(fn(...args)).catch(err => {
                console.warn("safeCallGlobalAsync: function rejected", err);
            });
        }
    } catch (err) {
        console.warn("safeCallGlobalAsync: function threw", err);
    }
    return Promise.resolve(undefined);
}

function resolveZipPath(opfPath, href) {
    const lastSlash = opfPath ? opfPath.lastIndexOf("/") : -1;
    const base = (lastSlash >= 0) ? opfPath.substring(0, lastSlash + 1) : "";
    return (base + href).replace(/\\/g, "/");
}

/* Detects if an HTML document is actually an error/rendering page instead of content */
function isErrorPageHtml(doc) {
    if (!doc || !doc.body) return false;
    const rawText = (doc.body.textContent || "").replace(/\s+/g, " ").trim();
    const text = rawText.toLowerCase();

    if (!text || text.length < 80) {
        const imgs = doc.body.querySelectorAll("img");
        if (imgs.length === 0) return true;
        if ((doc.body.innerText || "").trim().length < 60) return true;
    }

    const strongMarkers = [
        "this page contains the following errors",
        "below is a rendering of the page up to the first error",
        "calibre, version",
        "epub parsing error",
        "error on line",
        "xml parsing error",
        "syntax error",
        "this file is corrupt",
        "could not be rendered"
    ];
    if (strongMarkers.some(m => text.includes(m))) return true;

    const mildMarkers = [
        "epub error",
        "could not be displayed",
        "could not be rendered",
        "unexpected token"
    ];
    if (mildMarkers.some(m => text.includes(m)) && text.length < 1500) return true;

    const onlySvg = doc.body.querySelectorAll("svg").length > 0 &&
        (doc.body.innerText || "").trim().length < 60;
    if (onlySvg) return true;

    const imageTags = doc.body.querySelectorAll("img");
    if (imageTags.length > 0 &&
        (doc.body.innerText || "").trim().length < 60) return true;

    const wordChars = (rawText.match(/\w/g) || []).length;
    const totalChars = rawText.length || 1;
    if ((wordChars / totalChars) < 0.02 && totalChars < 2000) return true;

    return false;
}

/* === EPUB Loader === */

async function loadEpubFile() {
    try {
        const response = await fetch(EPUB_PATH);
        if (!response.ok) {
            throw new Error("Failed to fetch EPUB file: " + response.status);
        }

        const arrayBuffer = await response.arrayBuffer();
        const zip = await JSZip.loadAsync(arrayBuffer);

        const containerFile = zip.file("META-INF/container.xml");
        if (!containerFile) {
            throw new Error("META-INF/container.xml not found in EPUB");
        }

        const containerXml = await containerFile.async("text");
        const parser = new DOMParser();
        const containerDoc = parser.parseFromString(containerXml, "application/xml");
        const rootfileEl = containerDoc.querySelector("rootfile");
        if (!rootfileEl) {
            throw new Error("<rootfile> not found in container.xml");
        }

        const opfPath = rootfileEl.getAttribute("full-path");
        if (!opfPath) {
            throw new Error("No OPF full-path in container.xml");
        }

        const opfFile = zip.file(opfPath);
        if (!opfFile) {
            throw new Error("OPF file not found at " + opfPath);
        }

        const opfText = await opfFile.async("text");
        const opfDoc = parser.parseFromString(opfText, "application/xml");

        const manifestById = new Map();
        opfDoc.querySelectorAll("manifest > item").forEach(item => {
            const id = item.getAttribute("id");
            const href = item.getAttribute("href");
            if (id && href) manifestById.set(id, href);
        });

        const spinePaths = [];
        opfDoc.querySelectorAll("spine > itemref").forEach(itemref => {
            const idref = itemref.getAttribute("idref");
            const href = manifestById.get(idref);
            if (href) {
                const fullPath = resolveZipPath(opfPath, href);
                spinePaths.push(fullPath);
            }
        });

        if (!spinePaths.length) {
            throw new Error("EPUB spine is empty");
        }

        epubZip = zip;
        epubSpine = spinePaths;
        epubOpfPath = opfPath;

        // Expose EPUB state to global scope (other scripts / diagnostics expect these)
        window.epubZip = epubZip;
        window.epubSpine = epubSpine;
        window.epubOpfPath = epubOpfPath;
        window.firstTextSpineIndex = (typeof firstTextSpineIndex === "number") ? firstTextSpineIndex : 0;
        window.currentSpineIndex = (typeof currentSpineIndex === "number") ? currentSpineIndex : 0;
        window.showingStaticCover = (typeof showingStaticCover !== "undefined") ? showingStaticCover : true;

        console.log("[v5] exposed globals:", {
            epubSpineLength: (window.epubSpine || []).length,
            epubOpfPath: window.epubOpfPath,
            showingStaticCover: window.showingStaticCover
        });

        console.log("[v5] EPUB loaded. OPF:", opfPath, "spine length:", spinePaths.length);
        return { zip, spine: spinePaths, opfPath };
    } catch (err) {
        console.error("EPUB load error:", err);
        return null;
    }
}

/* === HTML Renderer === */

/* 
   fixImagesInHtml:
   - inlines CSS from link[rel="stylesheet"]
   - removes icon/favico/page_styles noise
   - resolves EPUB images from zip to blob URLs
   - applies base reading styles
   - checks for error pages
*/

async function loadSpineItem(zip, basePath) {
    let spineItem = spine[currentSpineIndex]; // or however you're selecting the spine item
    let htmlText = await zip.file(spineItem.href).async("string");
    fixImagesInHtml(htmlText, zip, basePath);
}
async function fixImagesInHtml(htmlText, zip, basePath) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlText, "text/html");

    // Inline CSS from linked stylesheets
    try {
        const links = Array.from(doc.querySelectorAll('link[rel="stylesheet"][href]'));
        for (const link of links) {
            try {
                let href = (link.getAttribute("href") || "").replace(/^\.?\//, "");
                let cssPath = (basePath ? basePath + href : href).replace(/\\/g, "/");
                let file = zip.file(cssPath);
                if (!file && epubOpfPath) {
                    const alt = resolveZipPath(epubOpfPath, href);
                    file = zip.file(alt);
                }
                if (file) {
                    const cssText = await file.async("text");
                    const style = doc.createElement("style");
                    style.textContent = cssText;
                    link.parentNode.insertBefore(style, link);
                    link.remove();
                    continue;
                }
                link.remove();
            } catch (err) {
                try { link.remove(); } catch (e) { /* ignore */ }
            }
        }
    } catch (err) {
        console.warn("inlineCssFromDoc failed:", err);
    }

    // Remove icons/favicons/page_styles noise
    doc.querySelectorAll(
        'link[rel="icon"], link[href$="favicon.ico"], link[href$="page_styles.css"]'
    ).forEach(l => l.remove());

    // Fix image src from zip
    const imgTags = doc.querySelectorAll("img[src]");
    for (const img of imgTags) {
        const origSrc = img.getAttribute("src") || "";
        if (!origSrc) continue;
        if (/^(https?:)?\/\//i.test(origSrc) || origSrc.startsWith("data:")) continue;

        const normalizedSrc = origSrc.replace(/^\.?\//, "");
        const zipPath = (basePath ? basePath + normalizedSrc : normalizedSrc).replace(/\\/g, "/");
        const fileInZip = zip.file(zipPath);
        if (!fileInZip) {
            const ph = doc.createElement("div");
            ph.className = "image-placeholder";
            img.replaceWith(ph);
            continue;
        }

        try {
            const blob = await fileInZip.async("blob");
            const localUrl = URL.createObjectURL(blob);
            img.src = localUrl;
        } catch (err) {
            const ph = doc.createElement("div");
            ph.className = "image-placeholder";
            img.replaceWith(ph);
        }
    }

    // Apply base typography / layout styling
    try {
        const body = doc.body;
        body.style.margin = "0";
        body.style.padding = "0.5rem 0.75rem";
        body.style.fontFamily = 'Georgia, "Times New Roman", serif';
        body.style.fontSize = "1rem";
        body.style.lineHeight = "1.5";
        body.style.backgroundColor = "#f7f3e8";
        body.querySelectorAll("p").forEach((p, idx) => {
            p.style.margin = "0.6rem 0";
            p.style.textAlign = "justify";
            if (idx === 0) p.style.textIndent = "0";
        });
    } catch (err) {
        // styling is best-effort
    }

    if (isErrorPageHtml(doc)) {
        const wrapper = document.createElement("div");
        wrapper.textContent = "[This EPUB page contained a rendering error and was skipped.]";
        return wrapper.outerHTML;
    }

    return doc.body ? doc.body.innerHTML : "";
}

/* 
   Applies final HTML into pageContainer and runs content/style fixes.
   Returns the (possibly transformed) htmlText for further use.
*/
function applyHtmlAndFixes(htmlText) {
    if (pageContainer) {
        pageContainer.innerHTML = htmlText;
        pageContainer.scrollTop = 0;
        pageContainer.style.overflowY =
            (currentSpineIndex === firstTextSpineIndex) ? "hidden" : "scroll";
    }

    // Strip standalone asterisk separators of 3+ characters (safer, general)
    try {
        const parser = new DOMParser();
        const container = doc.getElementById("__tmp");
        if (container) {
            Array.from(container.querySelectorAll("p, div")).forEach(node => {
                if (node.closest && node.closest("pre, code, blockquote, figure, figcaption")) return;
                const txt = (node.textContent || "").trim();
                if (/^\*{3,}$/.test(txt)) {
                    const hr = doc.createElement("hr");
                    hr.className = "reader-sep-asterisks";
                    node.parentNode.replaceChild(hr, node);
                }
            });
        }
    } catch (e) {
        console.warn("strip-asterisks failed:", e);
    }

    // Small style-fix to ensure rendered pages are visible
    try {
        const bookFrameEl = document.getElementById("bookFrame");
        if (bookFrameEl) {
            bookFrameEl.style.background = bookFrameEl.style.background || "transparent";
            bookFrameEl.style.zIndex = bookFrameEl.style.zIndex || "0";
        }

        const pc = document.getElementById("pageContainer");
        if (pc) {
            pc.style.background = pc.style.background || "#f7f3e8"; // cream reader background
            pc.style.color = pc.style.color || "#111";             // dark text
            pc.style.zIndex = pc.style.zIndex || "1";
            pc.querySelectorAll("a, h1, h2, h3, p, li").forEach(e => {
                if (!e.style.color) e.style.color = "#111";
            });
        }
    } catch (e) {
        console.warn("style-fix failed:", e);
    }

    return htmlText;
}

/* === Navigation === */

async function goNextPage() {
    if (showingStaticCover) {
        hideStaticCoverIfNeeded();
        return;
    }

    // If we're at the first text spine, a next click should move to the next spine item
    if (currentSpineIndex === firstTextSpineIndex) {
        if (currentSpineIndex < epubSpine.length - 1) {
            safeStopReading();
            await renderSpinePage(currentSpineIndex + 1);
        }
        return;
    }

    // Scroll within current page if content remains
    if (pageContainer) {
        const visible = pageContainer.clientHeight;
        const top = pageContainer.scrollTop;
        const total = pageContainer.scrollHeight;
        const remaining = total - (top + visible);
        const THRESHOLD = 10;
        if (remaining > THRESHOLD) {
            pageContainer.scrollBy({ top: visible * 0.9, behavior: "smooth" });
            return;
        }
    }

    // Move to next spine item
    if (!epubSpine.length) return;
    if (currentSpineIndex >= epubSpine.length - 1) return;
    safeStopReading();
    await renderSpinePage(currentSpineIndex + 1);
}

async function goPrevPage() {
    if (showingStaticCover) return;

    // If at first text spine, going back should reveal cover
    if (currentSpineIndex === firstTextSpineIndex) {
        const cover = document.getElementById("staticCover");
        const pageInner = document.getElementById("pageInner");
        if (cover) cover.style.display = "flex";
        if (pageInner) pageInner.style.display = "none";
        showingStaticCover = true;
        if (pageIndicator) pageIndicator.textContent = "Cover";
        return;
    }

    // Scroll upwards within current page if possible
    if (pageContainer) {
        const visible = pageContainer.clientHeight;
        const top = pageContainer.scrollTop;
        const THRESHOLD = 10;
        if (top > THRESHOLD) {
            pageContainer.scrollBy({ top: -visible * 0.9, behavior: "smooth" });
            return;
        }
    }

    // Move to previous spine item
    if (!epubSpine.length) return;
    if (currentSpineIndex <= 0) return;
    safeStopReading();
    await renderSpinePage(currentSpineIndex - 1);
}

/* === TTS === */

function safeStartReading() {
    if (typeof window.startReading === "function") {
        try {
            window.startReading();
            window.TTSon = 1;
            return;
        } catch (e) {
            console.warn("startReading threw", e);
        }
    }

    if (!window.speechSynthesis) {
        console.warn("No speechSynthesis available");
        return;
    }

    try {
        const text = pageContainer ? pageContainer.innerText.trim() : "";
        if (!text) return;

        window.speechSynthesis.cancel();
        const utt = new SpeechSynthesisUtterance(text);
        utt.rate = (typeof window.ttsRate === "number") ? window.ttsRate : 1.0;
        utt.onend = () => { window.TTSon = 0; };
        window.speechSynthesis.speak(utt);
        window.TTSon = 1;
    } catch (err) {
        console.error("safeStartReading error:", err);
    }
}

function safeStopReading() {
    if (typeof window.stopReading === "function") {
        try {
            window.stopReading();
            window.TTSon = 0;
            return;
        } catch (e) {
            console.warn("stopReading threw", e);
        }
    }
    if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
    }
    window.TTSon = 0;
}

/* === Cover Logic === */

function hideStaticCoverIfNeeded() {
    if (!showingStaticCover) return;

    const cover = document.getElementById("staticCover");
    const pageInner = document.getElementById("pageInner");

    if (cover) cover.style.display = "none";
    if (pageInner) pageInner.style.display = "flex";

    showingStaticCover = false;

    if (epubSpine && epubSpine.length && pageIndicator) {
        pageIndicator.textContent = `Page ${currentSpineIndex + 1} / ${epubSpine.length}`;
    }
}

async function coverClickHandlerImpl(e) {
    try {
        if (!showingStaticCover) return;
        if (window.endnoteFlag) return;

        window.openCoverFlag = 1;

        if (typeof window.hideStaticCoverIfNeeded === "function") {
            try {
                window.hideStaticCoverIfNeeded();
            } catch (err) {
                log("hideStaticCoverIfNeeded threw", err);
            }
        } else {
            hideStaticCoverIfNeeded();
        }

        if (!epubZip || !epubSpine || !epubSpine.length) return;

        const startIdx = (typeof firstTextSpineIndex === "number") ? firstTextSpineIndex : 0;

        for (let i = startIdx; i < epubSpine.length; i++) {
            try {
                const spinePath = epubSpine[i];
                const file = epubZip.file(spinePath);
                if (!file) continue;

                const html = await file.async("text");
                const lastSlash = spinePath.lastIndexOf("/");
                const basePath = (lastSlash >= 0) ? spinePath.substring(0, lastSlash + 1) : "";
                const fixed = (typeof window.fixImagesInHtml === "function")
                    ? await window.fixImagesInHtml(html, epubZip, basePath)
                    : await fixImagesInHtml(html, epubZip, basePath);

                const parser = new DOMParser();
                const doc = parser.parseFromString(fixed, "text/html");
                if (isErrorPageHtml(doc)) {
                    console.warn("[reader] skipping broken spine", i, spinePath);
                    continue;
                }

                await renderSpinePage(i);
                window.openTitleFlag = (i === startIdx) ? 1 : 0;
                return;
            } catch (err) {
                console.warn("coverClickHandler: skipping spine due to error", err);
                continue;
            }
        }

        await renderSpinePage(startIdx);
        window.openTitleFlag = 1;
    } catch (err) {
        console.error("coverClickHandler error:", err);
    }
}

/* === Click Interaction === */

function attachCoverClick() {
    const coverEl = document.getElementById("staticCover");
    if (!coverEl) return;

    try {
        coverEl.removeEventListener("click", window.coverClickHandler || coverClickHandlerImpl);
    } catch (e) {
        // ignore
    }

    coverEl.addEventListener("click", async (ev) => {
        if (typeof window.coverClickHandler === "function" &&
            window.coverClickHandler !== coverClickHandlerImpl) {
            try {
                await window.coverClickHandler(ev);
                return;
            } catch (err) {
                log("coverClickHandler threw", err);
            }
        }
        await coverClickHandlerImpl(ev);
    }, { passive: true });
}

function attachPageClickBehavior() {
    const pageEl = document.getElementById("pageContainer");
    if (!pageEl) {
        log("attachPageClickBehavior: #pageContainer not found");
        return;
    }

    if (pageEl._readerPagedAttached) return;
    pageEl._readerPagedAttached = true;

    pageEl.addEventListener("pointerdown", () => {
        _pointerDownTs = Date.now();
    }, { passive: true });

    pageEl.addEventListener("pointerup", async (ev) => {
        const down = _pointerDownTs || 0;
        const dt = Date.now() - down;

        if (dt <= 0 || dt > SHORT_CLICK_MS) return;
        if (window.endnoteFlag) return;
        if (ev.target && ev.target.closest &&
            ev.target.closest("a, button, input, textarea, select")) return;

        if (showingStaticCover) {
            await coverClickHandlerImpl();
            return;
        }

        if (currentSpineIndex === firstTextSpineIndex) {
            await goNextPage();
            return;
        }

        const now = Date.now();
        if (now - _lastTtsToggleAt < TTS_TOGGLE_DEBOUNCE_MS) return;
        _lastTtsToggleAt = now;

        if (window.TTSon) {
            safeStopReading();
        } else {
            safeStartReading();
        }
    }, { passive: true });

    pageEl.addEventListener("dblclick", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
    }, { passive: true });
}

/* === TOC (Placeholder) === */

async function buildToc() {
    // TODO: implement buildToc()
    // Expected responsibilities:
    // - Parse EPUB NCX or nav.xhtml via epubZip / epubOpfPath
    // - Populate global epubToc array
    // - Populate tocSelect <select> if present
    // - On selection change, call renderSpinePage() with corresponding spine index
}

/* === Spine Rendering (Placeholder) === */

async function renderSpinePage(spineIndex) {
    // TODO: implement renderSpinePage(spineIndex)
    // Suggested flow:
    // 1) Bound check spineIndex against epubSpine.length
    // 2) Load HTML from epubZip.file(epubSpine[spineIndex]).async("text")
    // 3) Compute basePath from spine path
    // 4) Run through fixImagesInHtml(htmlText, epubZip, basePath)
    // 5) Run through applyHtmlAndFixes()
    // 6) Update currentSpineIndex, pageIndicator, flags as needed
    // 7) Consider isErrorPageHtml() checks if you parse as DOM again
}

/* === Initialization === */

async function initReader() {
    try {
        const loaded = await loadEpubFile();
        if (!loaded) {
            console.error("Failed to load EPUB. Check EPUB_PATH and /lib/jszip.min.js availability.");
            return;
        }

        const coverCandidate = (typeof findCoverForEpub === "function")
            ? findCoverForEpub(EPUB_PATH)
            : null;
        if (coverCandidate && staticCoverImg) {
            try {
                staticCoverImg.src = coverCandidate;
            } catch (err) {
                console.warn("setting static cover src failed:", err);
            }
        }

        if (pageIndicator) {
            pageIndicator.textContent = "Cover";
        }

        buildToc().catch(err => console.warn("buildToc failed:", err));

        attachCoverClick();
        attachPageClickBehavior();

        window.safeStartReading = safeStartReading;
        window.safeStopReading = safeStopReading;
        window.renderSpinePage = renderSpinePage;
        window.goNextPage = goNextPage;
        window.goPrevPage = goPrevPage;
        window.coverClickHandler = coverClickHandlerImpl;
        window.readerPagedInit = initReader;

        console.log("[v5] reader.js loaded");
        console.log("[v5] spine length =", epubSpine.length);
    } catch (err) {
        console.error("initReader error:", err);
    }
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initReader);
} else {
    setTimeout(initReader, 0);
}

/* Utility: findCoverForEpub (keeps previous behavior) */
function findCoverForEpub(epubPath) {
    const base = epubPath.replace(/^.*[\\/]/, "").replace(/\.epub$/i, "");
    return `covers/${base}_cover.png`;
}
