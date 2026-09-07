/*
 * VAA runtime — the only JSFL that ever runs inside Adobe Animate.
 *
 * generate_jsfl.py appends a VAA.run(...) call with a JSON op list; everything
 * below just executes those primitives. Keep it ES3: JSFL has no let/const,
 * no arrow functions and no JSON.parse in older versions.
 *
 * Frame numbers in the op list are 1-based (what the Animate UI shows, per PRD
 * 7.4). The JSFL API is 0-based, so every frame goes through api().
 */
var VAA = (function () {
    var doc = null;
    var tl = null;
    var cfg = {};
    var stats = { ops: 0, warnings: 0 };

    function log(message) {
        fl.trace("[VAA] " + message);
    }

    function warn(message) {
        stats.warnings++;
        fl.trace("[VAA] WARNING: " + message);
    }

    function api(frame) {
        return Math.max(0, frame - 1);
    }

    function init(options) {
        cfg = options || {};
        doc = fl.getDocumentDOM();
        if (!doc) {
            throw new Error("No .fla is open. Open the Master Library document first.");
        }
        tl = doc.getTimeline();
        if (cfg.fps && doc.frameRate != cfg.fps) {
            warn(
                "document fps is " + doc.frameRate + " but the timeline JSON was built for " +
                cfg.fps + " — every frame number is wrong. Fix one of them and re-run."
            );
        }
    }

    function layerIndex(name) {
        for (var i = 0; i < tl.layers.length; i++) {
            if (tl.layers[i].name === name) {
                return i;
            }
        }
        return -1;
    }

    function ensureLayer(name) {
        var index = layerIndex(name);
        if (index === -1) {
            tl.addNewLayer(name, "normal", false);
            index = layerIndex(name);
        }
        return index;
    }

    /* Extend a layer so `frame` exists before we try to select it. */
    function ensureFrames(index, frame) {
        var layer = tl.layers[index];
        var needed = api(frame) - layer.frames.length + 1;
        if (needed > 0) {
            tl.currentLayer = index;
            tl.setSelectedLayers(index);
            tl.insertFrames(needed, false, Math.max(layer.frames.length - 1, 0));
        }
    }

    function select(index, frame) {
        ensureFrames(index, frame);
        tl.currentLayer = index;
        tl.setSelectedLayers(index);
        tl.currentFrame = api(frame);
        tl.setSelectedFrames(api(frame), api(frame) + 1, true);
    }

    function elementAt(index, frame) {
        var frameObject = tl.layers[index].frames[api(frame)];
        if (!frameObject || !frameObject.elements || !frameObject.elements.length) {
            return null;
        }
        return frameObject.elements[frameObject.elements.length - 1];
    }

    function applyProps(element, op) {
        if (!element) {
            return;
        }
        var matrix = element.matrix;
        var scaleX = (op.scale_x === undefined) ? null : op.scale_x;
        var scaleY = (op.scale_y === undefined) ? null : op.scale_y;
        var next = {
            a: (scaleX === null) ? matrix.a : scaleX,
            b: matrix.b,
            c: matrix.c,
            d: (scaleY === null) ? matrix.d : scaleY,
            tx: (op.x === undefined || op.x === null) ? matrix.tx : op.x,
            ty: (op.y === undefined || op.y === null) ? matrix.ty : op.y
        };
        element.matrix = next;
        if (op.alpha !== undefined && op.alpha !== null) {
            element.colorMode = "alpha";
            element.colorAlphaPercent = op.alpha;
        }
    }

    /* Frame number of a named label inside a library symbol's own timeline. */
    function labelFrame(symbolName, label) {
        var item = findLibraryItem(symbolName);
        if (!item || !item.timeline) {
            return -1;
        }
        var layers = item.timeline.layers;
        for (var i = 0; i < layers.length; i++) {
            var frames = layers[i].frames;
            for (var f = 0; f < frames.length; f++) {
                if (frames[f].startFrame === f && frames[f].name === label) {
                    return f;
                }
            }
        }
        return -1;
    }

    function findLibraryItem(name) {
        var items = doc.library.items;
        for (var i = 0; i < items.length; i++) {
            if (items[i].name === name || items[i].name.split("/").pop() === name) {
                return items[i];
            }
        }
        return null;
    }

    /* --- primitives ----------------------------------------------------- */

    function opPlace(op) {
        var index = ensureLayer(op.layer);
        if (!findLibraryItem(op.symbol)) {
            warn("library has no symbol '" + op.symbol + "' — line skipped");
            return;
        }
        select(index, op.frame);
        tl.insertBlankKeyframe(api(op.frame));
        select(index, op.frame);
        if (!doc.library.addItemToDocument({ x: op.x, y: op.y }, op.symbol)) {
            warn("could not place '" + op.symbol + "' at frame " + op.frame);
            return;
        }
        applyProps(elementAt(index, op.frame), op);
    }

    function opSetProps(op) {
        var index = ensureLayer(op.layer);
        select(index, op.frame);
        tl.convertToKeyframes(api(op.frame));
        applyProps(elementAt(index, op.frame), op);
    }

    function opTween(op) {
        var index = ensureLayer(op.layer);
        select(index, op.start_frame);
        var frame = tl.layers[index].frames[api(op.start_frame)];
        frame.tweenType = op.type || "motion";
        if (op.easing !== undefined) {
            frame.tweenEasing = op.easing;
        }
    }

    function opHold(op) {
        var index = ensureLayer(op.layer);
        ensureFrames(index, op.through_frame);
    }

    function opLoopLabel(op) {
        var index = ensureLayer(op.layer);
        var element = elementAt(index, op.frame);
        if (!element) {
            return;
        }
        var frame = labelFrame(element.libraryItem ? element.libraryItem.name : "", op.label);
        if (frame < 0) {
            warn(
                "symbol on layer '" + op.layer + "' has no frame label '" + op.label +
                "' — build the pose labels in the library (PRD 6.2)"
            );
            return;
        }
        element.firstFrame = frame;
        element.loop = "loop";
    }

    function opRigParent(op) {
        var child = ensureLayer(op.layer);
        var parent = ensureLayer(op.parent_layer);
        if (typeof tl.setRigParentAtFrame !== "function") {
            warn("this Animate build has no setRigParentAtFrame — parent '" +
                op.layer + "' to '" + op.parent_layer + "' by hand");
            return;
        }
        tl.setRigParentAtFrame(child, parent, api(op.frame));
    }

    /* PRD 9: JSFL cannot set a null rig parent, so parent to a scratch layer
       and delete it — the parenting goes with it. */
    function opRigUnparent(op) {
        var child = ensureLayer(op.layer);
        if (typeof tl.setRigParentAtFrame !== "function") {
            return;
        }
        var temp = ensureLayer("__vaa_scratch");
        tl.setRigParentAtFrame(child, temp, api(op.frame));
        tl.deleteLayer(layerIndex("__vaa_scratch"));
    }

    function opText(op) {
        var index = ensureLayer(op.layer);
        select(index, op.frame);
        tl.insertBlankKeyframe(api(op.frame));
        select(index, op.frame);
        doc.addNewText({ left: op.x, top: op.y, right: op.x + 900, bottom: op.y + 90 }, op.text);
        ensureFrames(index, op.end_frame);
    }

    function importAudio(uri, layerName, position) {
        if (!uri) {
            return;
        }
        if (!doc.importFile(uri, true)) {
            warn("could not import the voice-over: " + uri);
            return;
        }
        var items = doc.library.items;
        var sound = null;
        for (var i = 0; i < items.length; i++) {
            if (items[i].itemType === "sound") {
                sound = items[i];
            }
        }
        if (!sound) {
            warn("voice-over imported but no sound item found in the library");
            return;
        }
        var index = ensureLayer(layerName || "VO");
        tl.reorderLayer(index, position === "top" ? 0 : tl.layers.length - 1, position === "top");
        index = layerIndex(layerName || "VO");
        select(index, 1);
        var frame = tl.layers[index].frames[0];
        frame.soundLibraryItem = sound;
        frame.soundSync = "stream"; /* stream keeps audio locked to the timeline */
        log("voice-over on layer '" + tl.layers[index].name + "'");
    }

    var HANDLERS = {
        comment: function (op) { log(op.text); },
        ensure_layer: function (op) { ensureLayer(op.layer); },
        place: opPlace,
        set_props: opSetProps,
        tween: opTween,
        hold: opHold,
        loop_label: opLoopLabel,
        rig_parent: opRigParent,
        rig_unparent: opRigUnparent,
        text: opText
    };

    function run(options, ops) {
        init(options);
        if (options.audio_uri) {
            importAudio(options.audio_uri, options.audio_layer, options.audio_position);
        }
        for (var i = 0; i < ops.length; i++) {
            var op = ops[i];
            var handler = HANDLERS[op.op];
            if (!handler) {
                warn("unknown op '" + op.op + "'");
                continue;
            }
            try {
                handler(op);
                stats.ops++;
            } catch (error) {
                warn("op " + op.op + " on layer '" + op.layer + "' failed: " + error);
            }
        }
        if (options.save) {
            fl.saveDocument(doc);
        }
        log("batch " + (options.batch || 1) + "/" + (options.batches || 1) +
            " done — " + stats.ops + " ops, " + stats.warnings + " warnings");
    }

    return { run: run, init: init, ensureLayer: ensureLayer, importAudio: importAudio };
})();
