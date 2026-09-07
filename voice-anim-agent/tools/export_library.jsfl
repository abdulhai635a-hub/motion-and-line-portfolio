/*
 * Run this once in Animate (Commands > Run Command) with the Master Library
 * .fla open. It writes library_manifest.txt next to the .fla so the Python
 * side can flag missing assets before generating anything (PRD goal 6).
 */
(function () {
    var doc = fl.getDocumentDOM();
    if (!doc) {
        alert("Open the Master Library .fla first.");
        return;
    }
    var names = [];
    var items = doc.library.items;
    for (var i = 0; i < items.length; i++) {
        if (items[i].itemType === "movie clip" || items[i].itemType === "graphic") {
            names.push(items[i].name);
        }
    }
    names.sort();
    var uri = doc.pathURI.replace(/[^\/]+$/, "") + "library_manifest.txt";
    FLfile.write(uri, "# exported by tools/export_library.jsfl\n" + names.join("\n") + "\n");
    fl.trace("wrote " + uri + " (" + names.length + " symbols)");
})();
