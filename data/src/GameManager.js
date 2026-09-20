class EJS_GameManager {
    constructor(Module, EJS) {
        this.EJS = EJS;
        this.Module = Module;
        this.FS = this.Module.FS;
        this.functions = {
            restart: this.Module.cwrap("system_restart", "", []),
            //saveStateInfo: this.Module.cwrap("save_state_info", "string", []),
            loadState: this.Module.cwrap("load_state", "number", ["string", "number"]),
            screenshot: this.Module.cwrap("cmd_take_screenshot", "", []),
            simulateInput: this.Module.cwrap("simulate_input", "null", ["number", "number", "number"]),
            toggleMainLoop: this.Module.cwrap("toggleMainLoop", "null", ["number"]),
            getCoreOptions: this.Module.cwrap("get_core_options", "string", []),
            getCoreOptionsJSON: this.Module.cwrap("get_core_options_json", "string", []),
            setVariable: this.Module.cwrap("ejs_set_variable", "null", ["string", "string"]),
            setCheat: this.Module.cwrap("set_cheat", "null", ["number", "number", "string"]),
            resetCheat: this.Module.cwrap("reset_cheat", "null", []),
            toggleShader: this.Module.cwrap("shader_enable", "null", ["number"]),
            getDiskCount: this.Module.cwrap("get_disk_count", "number", []),
            getCurrentDisk: this.Module.cwrap("get_current_disk", "number", []),
            setCurrentDisk: this.Module.cwrap("set_current_disk", "null", ["number"]),
            getSaveFilePath: this.Module.cwrap("save_file_path", "string", []),
            saveSaveFiles: this.Module.cwrap("cmd_savefiles", "", []),
            supportsStates: this.Module.cwrap("supports_states", "number", []),
            loadSaveFiles: this.Module.cwrap("refresh_save_files", "null", []),
            toggleFastForward: this.Module.cwrap("toggle_fastforward", "null", ["number"]),
            setFastForwardRatio: this.Module.cwrap("set_ff_ratio", "null", ["number"]),
            toggleRewind: this.Module.cwrap("toggle_rewind", "null", ["number"]),
            setRewindGranularity: this.Module.cwrap("set_rewind_granularity", "null", ["number"]),
            toggleSlowMotion: this.Module.cwrap("toggle_slow_motion", "null", ["number"]),
            setSlowMotionRatio: this.Module.cwrap("set_sm_ratio", "null", ["number"]),
            getFrameNum: this.Module.cwrap("get_current_frame_count", "number", [""]),
            setVSync: this.Module.cwrap("set_vsync", "null", ["number"]),
            setVideoRoation: this.Module.cwrap("set_video_rotation", "null", ["number"]),
            getVideoDimensions: this.Module.cwrap("get_video_dimensions", "number", ["string"]),
            setKeyboardEnabled: this.Module.cwrap("ejs_set_keyboard_enabled", "null", ["number"]),
            setControllerPortDevice: this.Module.cwrap("ejs_set_controller_port_device", "null", ["number", "number"]),
            getControllerPortInfo: this.Module.cwrap("ejs_get_controller_port_info", "string", [])
        }

        this.writeFile("/home/web_user/.config/retroarch/retroarch.cfg", this.getRetroArchCfg());

        this.writeConfigFile();
        this.initShaders();
        this.setupPreLoadSettings();

        this.EJS.on("exit", () => {
            if (!this.EJS.failedToStart) {
                this.saveSaveFiles();
                this.functions.restart();
                this.saveSaveFiles();
            }
            this.toggleMainLoop(0);
            this.FS.unmount("/data/saves");
            setTimeout(() => {
                try {
                    this.Module.abort();
                } catch(e) {
                    console.warn(e);
                };
            }, 1000);
        })
    }
    setupPreLoadSettings() {
        this.Module.callbacks.setupCoreSettingFile = (filePath) => {
            if (this.EJS.debug) console.log("Setting up core settings with path:", filePath);
            this.writeFile(filePath, this.EJS.getCoreSettings());
        }
    }
    mountFileSystems() {
        return new Promise(async resolve => {
            this.mkdir("/data");
            this.mkdir("/data/saves");
            this.FS.mount(this.FS.filesystems.IDBFS, { autoPersist: true }, "/data/saves");
            this.FS.syncfs(true, resolve);
        });
    }
    writeConfigFile() {
        if (!this.EJS.defaultCoreOpts.file || !this.EJS.defaultCoreOpts.settings) {
            return;
        }
        let output = "";
        for (const k in this.EJS.defaultCoreOpts.settings) {
            output += k + ' = "' + this.EJS.defaultCoreOpts.settings[k] + '"\n';
        }

        this.writeFile("/home/web_user/retroarch/userdata/config/" + this.EJS.defaultCoreOpts.file, output);
    }
    loadExternalFiles() {
        return new Promise(async (resolve, reject) => {
            if (this.EJS.config.externalFiles && this.EJS.config.externalFiles.constructor.name === "Object") {
                for (const key in this.EJS.config.externalFiles) {
                    await new Promise(async (done) => {
                        try {
                            const url = this.EJS.config.externalFiles[key];
                            
                            const cacheItem = await this.EJS.downloadFile(
                                url,
                                this.EJS.downloadType.support.name,
                                null,          // progress callback
                                true,          // notWithPath (URL is already absolute)
                                { responseType: "arraybuffer" },  // opts (was null → causes crash)
                                false,         // forceExtract
                                this.EJS.downloadType.support.dontCache,
                                false          // dontExtract
                            );
                            
                            let path = key;
                            if (key.trim().endsWith("/")) {
                                // Extract to directory
                                for (let i = 0; i < cacheItem.data.files.length; i++) {
                                    const file = cacheItem.data.files[i];
                                    this.writeFile(path + file.filename, file.bytes);
                                }
                            } else {
                                // Write single file (or first file from archive)
                                if (cacheItem.data.files.length > 0) {
                                    this.writeFile(path, cacheItem.data.files[0].bytes);
                                }
                            }
                            done();
                        } catch (e) {
                            if (this.EJS.debug) console.warn("Failed to fetch file from '" + this.EJS.config.externalFiles[key] + "'. Make sure the file exists.", e);
                            done();
                        }
                    })
                }
            }
            resolve();
        });
    }
    writeFile(path, data) {
        const parts = path.split("/");
        let current = "/";
        for (let i = 0; i < parts.length - 1; i++) {
            if (!parts[i].trim()) continue;
            current += parts[i] + "/";
            this.mkdir(current);
        }
        this.FS.writeFile(path, data);
    }
    mkdir(path) {
        try {
            this.FS.mkdir(path);
        } catch(e) {}
    }
    getRetroArchCfg() {
        let cfg = "autosave_interval = 60\n" +
            "screenshot_directory = \"/\"\n" +
            "block_sram_overwrite = false\n" +
            "video_gpu_screenshot = false\n" +
            "audio_latency = 64\n" +
            "video_top_portrait_viewport = true\n" +
            "video_vsync = true\n" +
            "video_smooth = false\n" +
            "fastforward_ratio = 3.0\n" +
            "slowmotion_ratio = 3.0\n" +
            (this.EJS.rewindEnabled ? "rewind_enable = true\n" : "") +
            (this.EJS.rewindEnabled ? "rewind_granularity = 6\n" : "") +
            "savefile_directory = \"/data/saves\"\n";

        if (this.EJS.retroarchOpts && Array.isArray(this.EJS.retroarchOpts)) {
            this.EJS.retroarchOpts.forEach(option => {
                let selected = this.EJS.preGetSetting(option.name);
                console.log(selected);
                if (!selected) {
                    selected = option.default;
                }
                const value = option.isString === false ? selected : '"' + selected + '"';
                cfg += option.name + " = " + value + "\n"
            })
        }
        return cfg;
    }
    writeBootupBatchFile() {
        const data = `
SET BLASTER=A220 I7 D1 H5 T6

@ECHO OFF
mount A / -t floppy
SET PATH=Z:\;A:\
mount c /emulator/c
c:
IF EXIST AUTORUN.BAT CALL AUTORUN.BAT
`;
        const filename = "BOOTUP.BAT";
        this.FS.writeFile("/" + filename, data);
        return filename;
    }
    initShaders() {
        if (!this.EJS.shaders) return;
        this.mkdir("/shader");
        for (const shaderFileName in this.EJS.shaders) {
            const shader = this.EJS.shaders[shaderFileName];
            if (typeof shader === "string") {
                this.FS.writeFile(`/shader/${shaderFileName}`, shader);
            }
        }
    }
    clearEJSResetTimer() {
        if (this.EJS.resetTimeout) {
            clearTimeout(this.EJS.resetTimeout);
            delete this.EJS.resetTimeout;
        }
    }
    restart() {
        this.clearEJSResetTimer();
        this.functions.restart();
    }
    getState() {
        return this.Module.EmulatorJSGetState();
    }
    // The core leaves its reason here: first line "permanent" or "temporary",
    // the rest is what to show.
    savestateRefusal() {
        try {
            const text = this.FS.readFile("/savestate_error.txt", { encoding: "utf8" });
            const nl = text.indexOf("\n");
            if (nl < 0) return null;
            return { permanent: text.slice(0, nl).trim() === "permanent", message: text.slice(nl + 1).trim() };
        } catch(e) { return null; }
    }
    clearSavestateRefusal() {
        try {
            this.FS.unlink("/savestate_error.txt");
        } catch(e) {}
    }
    // Waiting lives here, not in the core: the core owns the main thread while
    // it blocks, so nothing would be drawn. Returns null having already said
    // why.
    async retryGetState() {
        const waitMs = (typeof window !== "undefined" && typeof window.EJS_saveStateWaitMs === "number")
            ? window.EJS_saveStateWaitMs : 10000;
        const retryUntil = Date.now() + waitMs;
        let lastSaid = null;
        let attempts = 0;
        if (this.EJS.debug) console.log(`[save] budget: waitMs=${waitMs}`);
        for (;;) {
            this.clearSavestateRefusal();
            attempts++;
            try {
                const state = this.getState();
                if (this.EJS.debug) console.log(`[save] accepted on attempt ${attempts}`);
                return state;
            } catch(e) {}
            const reason = this.savestateRefusal();
            // A refusal the engine will never lift -- an SCI game with save
            // states switched off -- must not be retried to arrive at the same
            // answer.
            if (reason && reason.permanent) {
                this.EJS.displayMessage(reason.message, 6000, "error");
                return null;
            }
            if (Date.now() >= retryUntil) {
                this.EJS.displayMessage(reason ? reason.message : this.EJS.localization("FAILED TO SAVE STATE"), 6000, "error");
                return null;
            }
            // As above: prefer the engine's reason over a generic one. Shown
            // only when it changes: the host may stack notices rather than
            // replace them, and one refusal repeated is one thing to say.
            if (this.EJS.debug) console.log(`[save] attempt ${attempts} refused (${reason && reason.permanent ? "permanent" : "temporary"}), ${Math.max(0, retryUntil - Date.now())}ms of ${waitMs} left`);
            const waiting = (reason && reason.message) || this.EJS.localization("WAITING FOR THE SCENE TO END");
            if (waiting !== lastSaid) {
                lastSaid = waiting;
                this.EJS.displayMessage(waiting);
            }
            await new Promise((resolve) => setTimeout(resolve, 400));
        }
    }
    async retryLoadState(name, options) {
        const opts = options || {};
        const refusal = () => this.savestateRefusal();
        const clearRefusal = () => this.clearSavestateRefusal();

        // A launch load is capped by count, not by the clock: it races the
        // game's own opening, which can outlast any budget worth sitting
        // through. Each attempt stutters the tab, so they are not free.
        const maxAttempts = typeof opts.maxAttempts === "number" ? opts.maxAttempts : 0;
        const waitMs = (typeof window !== "undefined" && typeof window.EJS_loadStateWaitMs === "number")
            ? window.EJS_loadStateWaitMs : 10000;
        const retryUntil = Date.now() + waitMs;
        let attempts = 0;
        let lastSaid = null;
        // The budget has never been observed enforced: a launch load ran 35
        // attempts against a 5-attempt cap and a 10s clock. Log what the call
        // actually resolved to, so the next log says which of the two is wrong.
        if (this.EJS.debug) console.log(`[load] budget: maxAttempts=${maxAttempts || "none"}, waitMs=${waitMs}`);
        for (;;) {
            // Cleared before every attempt: the file is the only signal, so a
            // stale one from the previous attempt would stop the loop ending.
            clearRefusal();
            // An absent refusal only means success if the payload survived: a
            // zero-byte load writes nothing and reads back as accepted.
            let stateSize = 0;
            try {
                stateSize = this.FS.stat("/" + name).size;
            } catch(e) {}
            if (!stateSize) {
                this.EJS.displayMessage(this.EJS.localization("FAILED TO LOAD STATE"), 6000, "error");
                return false;
            }
            this.functions.loadState(name, 0);
            attempts++;
            // content_load_state() queues a task rather than running inline, so
            // the reason is not there the instant this returns.
            await new Promise((resolve) => setTimeout(resolve, 1000));
            const reason = refusal();
            if (!reason) {
                if (this.EJS.debug) console.log(`[load] accepted on attempt ${attempts}`);
                return true;
            }
            const spent = maxAttempts ? attempts >= maxAttempts : Date.now() >= retryUntil;
            if (this.EJS.debug) console.log(`[load] attempt ${attempts} refused (${reason.permanent ? "permanent" : "temporary"}), maxAttempts=${maxAttempts || "none"}, ${Math.max(0, retryUntil - Date.now())}ms of ${waitMs} left, spent=${spent}`);
            if (reason.permanent || spent) {
                const message = (spent && !reason.permanent && opts.giveUpMessage)
                    ? opts.giveUpMessage : reason.message;
                this.EJS.displayMessage(message, 8000, "error");
                return false;
            }
            // The engine's wording when it gave one: "waiting for the scene to
            // end" is wrong for a refusal that is not about a scene at all.
            // Shown only when it changes, as above.
            const waiting = reason.message || this.EJS.localization("WAITING FOR THE SCENE TO END");
            if (waiting !== lastSaid) {
                lastSaid = waiting;
                this.EJS.displayMessage(waiting, 1500);
            }
        }
    }
    async loadState(state, options) {
        // Loads share one path, so an earlier call's cleanup timer could remove
        // the file a later call is still retrying against. Only the newest load
        // is allowed to clear it.
        const generation = (this.loadStateGeneration = (this.loadStateGeneration || 0) + 1);
        try {
            this.FS.unlink("game.state");
        } catch(e) {}
        this.FS.writeFile("/game.state", state);
        this.clearEJSResetTimer();
        // Returned, so a caller does not announce a load the engine refused.
        const loaded = await this.retryLoadState("game.state", options);
        setTimeout(() => {
            if (this.loadStateGeneration !== generation) return;
            try {
                this.FS.unlink("game.state");
            } catch(e) {}
        }, 5000)
        return loaded;
    }
    screenshot() {
        try {
            this.FS.unlink("/screenshot.png");
        } catch(e) {}
        this.functions.screenshot();
        return new Promise(async resolve => {
            while (1) {
                try {
                    this.FS.stat("/screenshot.png");
                    return resolve(this.FS.readFile("/screenshot.png"));
                } catch(e) {}
                await new Promise(res => setTimeout(res, 50));
            }
        })
    }
    async quickSave(slot) {
        if (!slot) slot = 1;
        const name = slot + "-quick.state";
        try {
            this.FS.unlink(name);
        } catch(e) {}
        const data = await this.retryGetState();
        // retryGetState() has already said why.
        if (data === null) return false;
        this.FS.writeFile("/" + name, data);
        // Offer it to the host as an ordinary save state, so a quick save is
        // kept wherever the Save State button's are and survives the tab. With
        // no listener it stays in the in-memory filesystem, as it always did.
        let screenshot, format;
        try {
            ({ screenshot, format } = await this.EJS.takeScreenshot(this.EJS.capture.photo.source,
                this.EJS.capture.photo.format, this.EJS.capture.photo.upscale));
        } catch(e) {}
        this.EJS.callEvent("saveState", { screenshot: screenshot, format: format, state: data });
        return true;
    }
    // Returns true when the local copy was used, so the caller knows whether to
    // announce the slot: a host that takes this over reports for itself, and
    // may have nothing to load.
    async quickLoad(slot) {
        if (!slot) slot = 1;
        this.clearEJSResetTimer();
        // Ask the host for its most recent state first, so a quick load reaches
        // the ones a quick save sent it -- including from another machine.
        // Nothing listening means there is only the local copy.
        if (this.EJS.callEvent("quickLoadState", { slot: slot }) > 0) return false;
        // Same refusal handling as loadState(): a core may decline for as long
        // as it likes, and calling the wrap once just loses the load.
        await this.retryLoadState(slot + "-quick.state");
        return true;
    }
    simulateInput(player, index, value) {
        if (this.EJS.isNetplay) {
            this.EJS.netplay.simulateInput(player, index, value);
            return;
        }
        if ([24, 25, 26, 27, 28, 29].includes(index)) {
            if (index === 24 && value === 1) {
                const slot = this.EJS.settings["save-state-slot"] ? this.EJS.settings["save-state-slot"] : "1";
                this.quickSave(slot).then((ok) => {
                    if (ok) this.EJS.displayMessage(this.EJS.localization("SAVED STATE TO SLOT") + " " + slot, null, "success");
                });
            }
            if (index === 25 && value === 1) {
                const slot = this.EJS.settings["save-state-slot"] ? this.EJS.settings["save-state-slot"] : "1";
                this.quickLoad(slot).then((local) => {
                    if (local) this.EJS.displayMessage(this.EJS.localization("LOADED STATE FROM SLOT") + " " + slot, null, "success");
                });
            }
            if (index === 26 && value === 1) {
                let newSlot;
                try {
                    newSlot = parseFloat(this.EJS.settings["save-state-slot"] ? this.EJS.settings["save-state-slot"] : "1") + 1;
                } catch(e) {
                    newSlot = 1;
                }
                if (newSlot > 9) newSlot = 1;
                this.EJS.displayMessage(this.EJS.localization("SET SAVE STATE SLOT TO") + " " + newSlot);
                this.EJS.changeSettingOption("save-state-slot", newSlot.toString());
            }
            if (index === 27) {
                this.functions.toggleFastForward(this.EJS.isFastForward ? !value : value);
            }
            if (index === 29) {
                this.functions.toggleSlowMotion(this.EJS.isSlowMotion ? !value : value);
            }
            if (index === 28) {
                if (this.EJS.rewindEnabled) {
                    this.functions.toggleRewind(value);
                }
            }
            return;
        }
        this.functions.simulateInput(player, index, value);
    }
    getFileNames() {
        if (this.EJS.getCore() === "picodrive") {
            return ["bin", "gen", "smd", "md", "32x", "cue", "iso", "sms", "68k", "chd"];
        } else {
            return ["toc", "ccd", "exe", "pbp", "chd", "img", "bin", "iso"];
        }
    }
    createCueFile(fileNames) {
        try {
            if (fileNames.length > 1) {
                fileNames = fileNames.filter((item) => {
                    return this.getFileNames().includes(item.split(".").pop().toLowerCase());
                })
                fileNames = fileNames.sort((a, b) => {
                    if (isNaN(a.charAt()) || isNaN(b.charAt())) throw new Error("Incorrect file name format");
                    return (parseInt(a.charAt()) > parseInt(b.charAt())) ? 1 : -1;
                })
            }
        } catch(e) {
            if (fileNames.length > 1) {
                console.warn("Could not auto-create cue file(s).");
                return null;
            }
        }
        for (let i = 0; i < fileNames.length; i++) {
            if (fileNames[i].split(".").pop().toLowerCase() === "ccd") {
                console.warn("Did not auto-create cue file(s). Found a ccd.");
                return null;
            }
        }
        if (fileNames.length === 0) {
            console.warn("Could not auto-create cue file(s).");
            return null;
        }
        let baseFileName = fileNames[0].split("/").pop();
        if (baseFileName.includes(".")) {
            baseFileName = baseFileName.substring(0, baseFileName.length - baseFileName.split(".").pop().length - 1);
        }
        for (let i = 0; i < fileNames.length; i++) {
            const contents = " FILE \"" + fileNames[i] + "\" BINARY\n  TRACK 01 MODE1/2352\n   INDEX 01 00:00:00";
            this.FS.writeFile("/" + baseFileName + "-" + i + ".cue", contents);
        }
        if (fileNames.length > 1) {
            let contents = "";
            for (let i = 0; i < fileNames.length; i++) {
                contents += "/" + baseFileName + "-" + i + ".cue\n";
            }
            this.FS.writeFile("/" + baseFileName + ".m3u", contents);
        }
        return (fileNames.length === 1) ? baseFileName + "-0.cue" : baseFileName + ".m3u";
    }
    loadPpssppAssets() {
        return new Promise(async (resolve, reject) => {
            try {
                const res = await this.EJS.downloadFile("cores/ppsspp-assets.zip", this.EJS.downloadType.core.name, null, false, { responseType: "arraybuffer", method: "GET" }, true, this.EJS.downloadType.core.dontCache);
                if (res === -1) {
                    throw new Error("Failed to download PPSSPP assets");
                }
                const cacheItem = res.data;

                this.mkdir("/PPSSPP");

                for (let i = 0; i < cacheItem.files.length; i++) {
                    const file = cacheItem.files[i];
                    const path = "/PPSSPP/" + file.filename;
                    const paths = path.split("/");
                    let cp = "";
                    for (let j = 0; j < paths.length - 1; j++) {
                        if (paths[j] === "") continue;
                        cp += "/" + paths[j];
                        if (!this.FS.analyzePath(cp).exists) {
                            this.FS.mkdir(cp);
                        }
                    }
                    if (!path.endsWith("/")) {
                        this.FS.writeFile(path, file.bytes);
                    }
                }
                resolve();
            } catch (error) {
                this.EJS.textElem.innerText = this.EJS.localization("Network Error");
                this.EJS.textElem.style.color = "red";
                reject(error);
            }
        })
    }
    setVSync(enabled) {
        this.functions.setVSync(enabled);
    }
    toggleMainLoop(playing) {
        this.functions.toggleMainLoop(playing);
    }
    getCoreOptions() {
        return this.functions.getCoreOptions();
    }
    // Core options with the data the libretro core options v2 interface provides:
    // human readable descriptions, value labels, info text and visibility.
    // Returns null on cores built before get_core_options_json was exported.
    getCoreOptionsJSON() {
        if (!this.Module["_get_core_options_json"]) return null;
        try {
            const data = JSON.parse(this.functions.getCoreOptionsJSON());
            return (data && Array.isArray(data.options) && data.options.length) ? data : null;
        } catch(e) {
            if (this.EJS.debug) console.warn("Failed to read core options:", e);
            return null;
        }
    }
    setVariable(option, value) {
        this.functions.setVariable(option, value);
    }
    setCheat(index, enabled, code) {
        this.functions.setCheat(index, enabled, code);
    }
    resetCheat() {
        this.functions.resetCheat();
    }
    toggleShader(active) {
        this.functions.toggleShader(active);
    }
    getDiskCount() {
        return this.functions.getDiskCount();
    }
    getCurrentDisk() {
        return this.functions.getCurrentDisk();
    }
    setCurrentDisk(disk) {
        this.functions.setCurrentDisk(disk);
    }
    getSaveFilePath() {
        return this.functions.getSaveFilePath();
    }
    saveSaveFiles() {
        this.functions.saveSaveFiles();
        this.EJS.callEvent("saveSaveFiles", this.getSaveFile(false));
        //this.FS.syncfs(false, () => {});
    }
    supportsStates() {
        return !!this.functions.supportsStates();
    }
    setControllerPortDevice(port, device) {
        this.functions.setControllerPortDevice(port, device);
    }
    getControllerPortInfo() {
        return this.functions.getControllerPortInfo();
    }
    getSaveFile(save) {
        if (save !== false) {
            this.saveSaveFiles();
        }
        const exists = this.FS.analyzePath(this.getSaveFilePath()).exists;
        return (exists ? this.FS.readFile(this.getSaveFilePath()) : null);
    }
    loadSaveFiles() {
        this.clearEJSResetTimer();
        this.functions.loadSaveFiles();
    }
    setFastForwardRatio(ratio) {
        this.functions.setFastForwardRatio(ratio);
    }
    toggleFastForward(active) {
        this.functions.toggleFastForward(active);
    }
    setSlowMotionRatio(ratio) {
        this.functions.setSlowMotionRatio(ratio);
    }
    toggleSlowMotion(active) {
        this.functions.toggleSlowMotion(active);
    }
    setRewindGranularity(value) {
        this.functions.setRewindGranularity(value);
    }
    getFrameNum() {
        return this.functions.getFrameNum();
    }
    setVideoRotation(rotation) {
        this.functions.setVideoRoation(rotation);
    }
    getVideoDimensions(type) {
        try {
            return this.functions.getVideoDimensions(type);
        } catch(e) {
            console.warn(e);
        }
    }
    setKeyboardEnabled(enabled) {
        this.functions.setKeyboardEnabled(enabled === true ? 1 : 0);
    }
    setAltKeyEnabled(enabled) {
        this.functions.setKeyboardEnabled(enabled === true ? 3 : 2);
    }
    listDir(path, indent = "") {
        const skipPaths = ["/dev", "/proc", "/sys"];
        if (skipPaths.includes(path)) {
            console.warn(`Skipping directory listing for ${path}`);
            return;
        }
        try {
            const entries = this.FS.readdir(path);
            for (const entry of entries) {
                if (entry === "." || entry === "..") continue;
                const fullPath = path === "/" ? `/${entry}` : `${path}/${entry}`;
                if (skipPaths.some(skip => fullPath.startsWith(skip))) continue;
                const stat = this.FS.stat(fullPath);
                if (this.FS.isDir(stat.mode)) {
                    console.log(`${indent}[DIR] ${fullPath}`);
                    this.listDir(fullPath, indent + "  ");
                } else {
                    console.log(`${indent}${fullPath}`);
                }
            }
        } catch (e) {
            console.warn("Error reading directory:", path, e);
        }
    }
}

export { EJS_GameManager };
