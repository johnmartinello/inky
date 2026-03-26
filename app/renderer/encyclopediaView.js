const fs = require("fs");
const $ = window.jQuery = require("./jquery-2.2.3.min.js");
const i18n = require("./i18n.js");

const saveDebounceMs = 350;
const syncDebounceMs = 250;
const centeredCharacterRegex = /^\s*>>>\s*center\s+(.+?)\s*$/i;

let currentProject = null;
let loadedFilePath = null;
let data = createEmptyData();
let dataRevision = 0;
let dirty = false;

let activeSection = "chapters";
let selectedBySection = {
    chapters: null,
    characters: null
};

let saveTimeout = null;
let syncTimeout = null;

let $root = null;
let $storyNotesInput = null;
let $subtabs = null;
let $entryListTitle = null;
let $entryList = null;
let $entryEditorTitle = null;
let $entryNotesInput = null;
let $entryEditorEmpty = null;

function createEmptyData() {
    return {
        version: 1,
        storyNotes: "",
        chapters: {},
        characters: {}
    };
}

function normalizeEntryMap(map) {
    const out = {};
    const seen = new Set();

    if( !map || typeof map !== "object" )
        return out;

    Object.keys(map).forEach((rawName) => {
        const name = String(rawName || "").trim();
        if( !name )
            return;

        const lowerName = name.toLowerCase();
        if( seen.has(lowerName) )
            return;

        seen.add(lowerName);

        const entry = map[rawName];
        const note = (typeof entry === "string") ? entry :
            ((entry && typeof entry.note === "string") ? entry.note : "");
        out[name] = { note: note };
    });

    return out;
}

function normalizeData(raw) {
    const out = createEmptyData();
    if( !raw || typeof raw !== "object" )
        return out;

    out.version = 1;
    out.storyNotes = typeof raw.storyNotes === "string" ? raw.storyNotes : "";
    out.chapters = normalizeEntryMap(raw.chapters);
    out.characters = normalizeEntryMap(raw.characters);
    return out;
}

function buildSerializableData() {
    return {
        version: 1,
        storyNotes: data.storyNotes,
        chapters: data.chapters,
        characters: data.characters
    };
}

function getMainInkAbsolutePath() {
    if( !currentProject || !currentProject.mainInk )
        return null;
    return currentProject.mainInk.absolutePath();
}

function sidecarPathForMainInk(mainInkPath) {
    if( !mainInkPath )
        return null;

    if( mainInkPath.toLowerCase().endsWith(".ink") )
        return mainInkPath.substring(0, mainInkPath.length - 4) + ".encyclopedia.json";

    return mainInkPath + ".encyclopedia.json";
}

function currentSidecarPath() {
    return sidecarPathForMainInk(getMainInkAbsolutePath());
}

function clearTimers() {
    if( saveTimeout ) {
        clearTimeout(saveTimeout);
        saveTimeout = null;
    }
    if( syncTimeout ) {
        clearTimeout(syncTimeout);
        syncTimeout = null;
    }
}

function sortedKeysInsensitive(map) {
    return Object.keys(map).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

function ensureSelectionFor(section) {
    const sectionMap = data[section];
    const keys = sortedKeysInsensitive(sectionMap);

    if( keys.length === 0 ) {
        selectedBySection[section] = null;
        return;
    }

    const currentSelection = selectedBySection[section];
    if( !currentSelection ) {
        selectedBySection[section] = keys[0];
        return;
    }

    const exactMatch = keys.find((k) => k === currentSelection);
    if( exactMatch ) {
        selectedBySection[section] = exactMatch;
        return;
    }

    const lower = currentSelection.toLowerCase();
    const caseInsensitiveMatch = keys.find((k) => k.toLowerCase() === lower);
    selectedBySection[section] = caseInsensitiveMatch || keys[0];
}

function renderEntryEditor() {
    const selected = selectedBySection[activeSection];
    const sectionMap = data[activeSection];

    if( selected && sectionMap[selected] ) {
        $entryEditorTitle.text(selected);
        $entryNotesInput.prop("disabled", false);
        $entryNotesInput.val(sectionMap[selected].note || "");
        $entryEditorEmpty.addClass("hidden");
    } else {
        $entryEditorTitle.text("");
        $entryNotesInput.prop("disabled", true);
        $entryNotesInput.val("");
        $entryEditorEmpty.removeClass("hidden");
    }
}

function renderEntryList() {
    const sectionMap = data[activeSection];
    const keys = sortedKeysInsensitive(sectionMap);
    const selected = selectedBySection[activeSection];

    $entryList.empty();
    keys.forEach((key) => {
        const $item = $("<li></li>").text(key);
        $item.data("entryKey", key);
        if( key === selected )
            $item.addClass("selected");
        $entryList.append($item);
    });

    $entryListTitle.text(activeSection === "chapters" ? i18n._("Chapters") : i18n._("Characters"));
}

function renderSubtabs() {
    $subtabs.removeClass("selected");
    $subtabs.filter(`[data-encyclopedia-tab='${activeSection}']`).addClass("selected");
}

function render() {
    if( !$root )
        return;

    ensureSelectionFor("chapters");
    ensureSelectionFor("characters");

    renderSubtabs();
    $storyNotesInput.val(data.storyNotes);
    renderEntryList();
    renderEntryEditor();
}

function markDirty() {
    dirty = true;
    dataRevision++;

    if( loadedFilePath )
        scheduleSave();
}

function saveToDisk(force = false) {
    if( !loadedFilePath )
        return;
    if( !force && !dirty )
        return;

    const revisionAtSaveStart = dataRevision;
    const payload = JSON.stringify(buildSerializableData(), null, 2);
    fs.writeFile(loadedFilePath, payload, "utf8", (err) => {
        if( err ) {
            console.error("Failed to save encyclopedia file:", err);
            return;
        }

        if( dataRevision === revisionAtSaveStart ) {
            dirty = false;
        }
    });
}

function scheduleSave(delayMs = saveDebounceMs) {
    if( !loadedFilePath )
        return;

    if( saveTimeout )
        clearTimeout(saveTimeout);

    saveTimeout = setTimeout(() => {
        saveTimeout = null;
        saveToDisk();
    }, delayMs);
}

function loadFromFile(filePath) {
    loadedFilePath = filePath || null;
    data = createEmptyData();
    dirty = false;
    dataRevision = 0;
    selectedBySection = {
        chapters: null,
        characters: null
    };

    if( !filePath ) {
        render();
        return;
    }

    if( !fs.existsSync(filePath) ) {
        render();
        return;
    }

    try {
        const content = fs.readFileSync(filePath, "utf8");
        const parsed = JSON.parse(content);
        data = normalizeData(parsed);
    } catch(err) {
        console.error("Failed to read encyclopedia file:", err);
    }

    render();
}

function uniqueNames(names) {
    const seen = new Set();
    const out = [];

    names.forEach((rawName) => {
        const name = String(rawName || "").trim();
        if( !name )
            return;

        const lower = name.toLowerCase();
        if( seen.has(lower) )
            return;

        seen.add(lower);
        out.push(name);
    });

    return out;
}

function collectChapterNames(project) {
    const names = [];
    if( !project || !Array.isArray(project.files) )
        return names;

    project.files.forEach((inkFile) => {
        if( !inkFile || !inkFile.symbols || !inkFile.symbols.getSymbols )
            return;

        const symbols = inkFile.symbols.getSymbols() || {};
        Object.keys(symbols).forEach((symbolName) => {
            const symbol = symbols[symbolName];
            const isKnot = symbol && symbol.flowType && symbol.flowType.name === "Knot";
            if( isKnot && !symbol.isfunc ) {
                names.push(symbol.name || symbolName);
            }
        });
    });

    return uniqueNames(names);
}

function collectCharacterNames(project) {
    const names = [];
    if( !project || !Array.isArray(project.files) )
        return names;

    project.files.forEach((inkFile) => {
        if( !inkFile || !inkFile.getValue )
            return;

        const text = inkFile.getValue() || "";
        const lines = text.split(/\r?\n/);
        lines.forEach((line) => {
            const match = line.match(centeredCharacterRegex);
            if( match && match[1] ) {
                names.push(match[1].trim());
            }
        });
    });

    return uniqueNames(names);
}

function addMissingEntries(sectionMap, inferredNames) {
    let addedAny = false;
    const existing = new Set(Object.keys(sectionMap).map((name) => name.toLowerCase()));

    inferredNames.forEach((name) => {
        const lower = name.toLowerCase();
        if( existing.has(lower) )
            return;

        existing.add(lower);
        sectionMap[name] = { note: "" };
        addedAny = true;
    });

    return addedAny;
}

function syncInferredEntriesNow() {
    if( !currentProject )
        return;

    const inferredChapters = collectChapterNames(currentProject);
    const inferredCharacters = collectCharacterNames(currentProject);

    const chaptersAdded = addMissingEntries(data.chapters, inferredChapters);
    const charactersAdded = addMissingEntries(data.characters, inferredCharacters);

    if( chaptersAdded || charactersAdded )
        markDirty();

    render();
}

function scheduleInferenceSync() {
    if( syncTimeout )
        clearTimeout(syncTimeout);

    syncTimeout = setTimeout(() => {
        syncTimeout = null;
        syncInferredEntriesNow();
    }, syncDebounceMs);
}

function setActiveSection(sectionName) {
    if( sectionName !== "chapters" && sectionName !== "characters" )
        return;

    if( activeSection === sectionName )
        return;

    activeSection = sectionName;
    render();
}

$(document).ready(() => {
    $root = $("#encyclopedia");
    $storyNotesInput = $root.find(".story-notes-input");
    $subtabs = $root.find(".encyclopedia-subtab");
    $entryListTitle = $root.find(".entry-list-title");
    $entryList = $root.find(".entry-list");
    $entryEditorTitle = $root.find(".entry-editor-title");
    $entryNotesInput = $root.find(".entry-notes-input");
    $entryEditorEmpty = $root.find(".entry-editor-empty");

    $storyNotesInput.on("input", () => {
        data.storyNotes = $storyNotesInput.val();
        markDirty();
    });

    $subtabs.on("click", (event) => {
        const sectionName = $(event.currentTarget).attr("data-encyclopedia-tab");
        setActiveSection(sectionName);
    });

    $entryList.on("click", "li", (event) => {
        const key = $(event.currentTarget).data("entryKey");
        if( !key )
            return;

        selectedBySection[activeSection] = key;
        render();
    });

    $entryNotesInput.on("input", () => {
        const selected = selectedBySection[activeSection];
        if( !selected )
            return;

        const entry = data[activeSection][selected];
        if( !entry )
            return;

        entry.note = $entryNotesInput.val();
        markDirty();
    });

    render();
});

exports.EncyclopediaView = {
    setProject: (project) => {
        currentProject = project;
        clearTimers();
        loadFromFile(currentSidecarPath());
        syncInferredEntriesNow();
    },

    queueInferenceSync: () => {
        scheduleInferenceSync();
    },

    projectSaved: () => {
        const newSidecarPath = currentSidecarPath();
        if( !newSidecarPath )
            return;

        const pathChanged = loadedFilePath !== newSidecarPath;
        loadedFilePath = newSidecarPath;

        if( pathChanged ) {
            saveToDisk(true);
            return;
        }

        if( dirty )
            saveToDisk();
    }
};
