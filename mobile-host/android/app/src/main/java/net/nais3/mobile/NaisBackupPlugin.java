package net.nais3.mobile;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.provider.DocumentsContract;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import org.json.JSONArray;
import org.json.JSONObject;

/** Stages PC archives without loading image assets across the WebView bridge. */
@CapacitorPlugin(name = "NaisBackup")
public class NaisBackupPlugin extends Plugin {
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private boolean pickerOpen;
    private static final Set<String> TABLES = new HashSet<>(Arrays.asList(
        "character_folders", "character_prompts", "fragment_folders", "fragments", "vibe_folders",
        "vibe_images", "charref_folders", "charref_images", "scene_presets", "gen_scenes",
        "prompt_presets", "library_stacks", "library_images"));

    @PluginMethod public void chooseArchive(PluginCall call) {
        if (pickerOpen) { call.reject("A backup picker is already open"); return; }
        pickerOpen = true;
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.setType("*/*");
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try { startActivityForResult(call, intent, "archiveSelected"); }
        catch (Exception error) { pickerOpen = false; call.reject("Cannot open backup picker", error); }
    }

    @ActivityCallback private void archiveSelected(PluginCall call, ActivityResult result) {
        pickerOpen = false;
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.resolve(new JSObject().put("cancelled", true)); return;
        }
        Uri uri = result.getData().getData();
        io.execute(() -> {
            File root = new File(getContext().getNoBackupFilesDir(), "backup-imports/" + UUID.randomUUID());
            try {
                if (!root.mkdirs()) throw new IOException("Cannot prepare backup staging");
                JSONObject entries = new JSONObject();
                long total = 0;
                int count = 0;
                InputStream input = getContext().getContentResolver().openInputStream(uri);
                if (input == null) throw new IOException("Cannot read selected backup");
                try (ZipInputStream zip = new ZipInputStream(input)) {
                    ZipEntry entry;
                    byte[] buffer = new byte[32768];
                    while ((entry = zip.getNextEntry()) != null) {
                        String name = entry.getName();
                        safePath(name);
                        if (++count > 100000 || entries.has(name)) throw new IOException("Too many or duplicate archive entries");
                        if (entry.isDirectory()) continue;
                        File file = new File(root, name);
                        File parent = file.getParentFile();
                        if (!parent.isDirectory() && !parent.mkdirs()) throw new IOException("Cannot stage backup entry");
                        MessageDigest digest = MessageDigest.getInstance("SHA-256");
                        long size = 0;
                        try (OutputStream output = new FileOutputStream(file)) {
                            int n;
                            while ((n = zip.read(buffer)) != -1) {
                                size += n; total += n;
                                if (size > 256L * 1024 * 1024 || total > 8L * 1024 * 1024 * 1024) throw new IOException("Backup exceeds supported size");
                                output.write(buffer, 0, n); digest.update(buffer, 0, n);
                            }
                        }
                        StringBuilder hash = new StringBuilder();
                        for (byte b : digest.digest()) hash.append(String.format(Locale.ROOT, "%02x", b & 255));
                        entries.put(name, new JSONObject().put("bytes", size).put("sha256", hash.toString()));
                    }
                }
                JSONObject manifest = readObject(new File(root, "manifest.json"));
                if (!manifest.getString("format").equals("NAIS") || !manifest.getString("app").equals("NAIS3") ||
                    manifest.getInt("formatVersion") != 1 || !manifest.getString("scope").equals("workspace")) throw new IOException("Unsupported workspace backup");
                JSONObject checksums = readObject(new File(root, "checksums.json"));
                // Validate every declared entry, not only the assets currently represented in UI.
                Iterator<String> keys = checksums.keys();
                while (keys.hasNext()) check(keys.next(), checksums, entries);
                check("data/settings.json", checksums, entries);
                JSONObject settings = readObject(new File(root, "data/settings.json"));
                Object params = settings.get("mainParams");
                if (params != JSONObject.NULL && !(params instanceof String)) throw new IOException("Invalid generation settings");
                JSONArray tables = manifest.getJSONArray("tables");
                Set<String> seen = new HashSet<>();
                JSONObject tableData = new JSONObject();
                JSONObject locations = new JSONObject();
                long metadataBytes = 0;
                long blobBytes = 0;
                for (int i = 0; i < tables.length(); i++) {
                    String table = tables.getString(i);
                    if (!TABLES.contains(table) || !seen.add(table)) throw new IOException("Invalid backup table");
                    String path = "data/tables/" + table + ".json";
                    check(path, checksums, entries);
                    metadataBytes += new File(root, path).length();
                    if (metadataBytes > 32L * 1024 * 1024) throw new IOException("Backup metadata exceeds supported size");
                    JSONArray rows = new JSONArray(readText(new File(root, path)));
                    if (manifest.getJSONObject("tableCounts").getInt(table) != rows.length()) throw new IOException("Backup row count mismatch");
                    Set<Long> ids = new HashSet<>();
                    for (int j = 0; j < rows.length(); j++) {
                        JSONObject row = rows.getJSONObject(j);
                        Object id = row.get("id");
                        if (!(id instanceof Number) || ((Number) id).doubleValue() != ((Number) id).longValue() ||
                            ((Number) id).longValue() < 1 || ((Number) id).longValue() >= 9007199254740991L ||
                            !ids.add(((Number) id).longValue())) throw new IOException("Invalid or duplicate backup row id");
                        Iterator<String> columns = row.keys();
                        while (columns.hasNext()) {
                            String column = columns.next();
                            if (!column.matches("^[a-zA-Z_][a-zA-Z0-9_]*$")) throw new IOException("Invalid backup column");
                            Object value = row.get(column);
                            if (value instanceof JSONObject) {
                                JSONObject reference = (JSONObject) value;
                                if (reference.length() != 1) throw new IOException("Invalid asset reference");
                                String asset = reference.getString("__asset");
                                if (!asset.startsWith("assets/")) throw new IOException("Invalid asset path");
                                check(asset, checksums, entries);
                                File assetFile = new File(root, asset);
                                if (column.equals("file_path")) {
                                    locations.put(table + ":" + row.getLong("id"), Uri.fromFile(assetFile).toString());
                                    row.put(column, "");
                                } else {
                                    blobBytes += assetFile.length();
                                    if (blobBytes > 16L * 1024 * 1024) throw new IOException("Backup thumbnails exceed supported metadata size");
                                    if (assetFile.length() > 4L * 1024 * 1024) throw new IOException("Backup thumbnail is too large");
                                    row.put(column, new JSONObject().put("__base64", android.util.Base64.encodeToString(readBytes(assetFile), android.util.Base64.NO_WRAP)));
                                }
                            } else if (column.equals("file_path")) throw new IOException("Missing backup image asset");
                            else if (value != JSONObject.NULL && !(value instanceof String) && !(value instanceof Number)) throw new IOException("Invalid backup value");
                        }
                    }
                    tableData.put(table, rows);
                }
                call.resolve(new JSObject().put("cancelled", false).put("stageId", root.getName())
                    .put("tables", tableData).put("mainParams", params).put("locations", locations));
            } catch (Exception error) { remove(root); call.reject("Cannot validate selected backup", error); }
        });
    }

    /** Only discard an uncommitted stage. Never accept an arbitrary filesystem path. */
    @PluginMethod public void discardStage(PluginCall call) {
        String id = call.getString("stageId", "");
        if (!id.matches("[a-f0-9-]{36}")) { call.reject("Invalid backup stage"); return; }
        io.execute(() -> {
            try {
                File root = new File(getContext().getNoBackupFilesDir(), "backup-imports/" + id);
                String workspace = new SecureSnapshot(getContext()).read();
                String recovery = new SecureSnapshot(getContext(), "before-import").read();
                if ((workspace != null && workspace.contains("backup-imports/" + id)) ||
                    (recovery != null && recovery.contains("backup-imports/" + id))) throw new IOException("Backup stage is in use");
                remove(root);
                call.resolve();
            } catch (Exception error) { call.reject("Cannot discard backup stage", error); }
        });
    }

    private static void safePath(String path) throws IOException {
        if (path.isEmpty() || path.contains("\\") || path.contains("\0") || path.startsWith("/") || path.matches("^[a-zA-Z]:.*") ||
            Arrays.asList(path.split("/")).contains("..")) throw new IOException("Unsafe archive path");
    }

    @PluginMethod public void stageLibraryImages(PluginCall call) {
        String id = call.getString("stageId", "");
        if (!id.matches("[a-f0-9-]{36}")) { call.reject("Invalid backup stage"); return; }
        io.execute(() -> {
            Uri created = null;
            try {
                String selected = getContext().getSharedPreferences("output-folders", 0).getString("library", null);
                if (selected == null) throw new IOException("Select a library folder before restoring images");
                Uri tree = Uri.parse(selected);
                boolean writable = getContext().getContentResolver().getPersistedUriPermissions().stream()
                    .anyMatch(p -> p.getUri().equals(tree) && p.isReadPermission() && p.isWritePermission());
                if (!writable) throw new IOException("Library folder access is unavailable");
                File root = new File(getContext().getNoBackupFilesDir(), "backup-imports/" + id);
                JSONObject manifest = readObject(new File(root, "manifest.json"));
                JSONArray tables = manifest.getJSONArray("tables");
                boolean hasLibrary = false;
                for (int i = 0; i < tables.length(); i++) if (tables.getString(i).equals("library_images")) hasLibrary = true;
                JSONObject locations = new JSONObject();
                if (hasLibrary) {
                    JSONArray rows = new JSONArray(readText(new File(root, "data/tables/library_images.json")));
                    if (rows.length() > 0) {
                        Uri parent = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
                        created = DocumentsContract.createDocument(getContext().getContentResolver(), parent,
                            DocumentsContract.Document.MIME_TYPE_DIR, "NAIS3-restored-" + id);
                        if (created == null) throw new IOException("Cannot create library restore folder");
                        JSONObject checksums = readObject(new File(root, "checksums.json"));
                        for (int i = 0; i < rows.length(); i++) {
                            JSONObject row = rows.getJSONObject(i);
                            String asset = row.getJSONObject("file_path").getString("__asset");
                            safePath(asset);
                            if (!asset.startsWith("assets/")) throw new IOException("Invalid library asset");
                            File source = new File(root, asset);
                            String extension = asset.substring(asset.lastIndexOf('.')).toLowerCase(Locale.ROOT);
                            if (!extension.matches("\\.[a-z0-9]{1,10}")) extension = ".bin";
                            String mime = extension.equals(".png") ? "image/png" : extension.equals(".webp") ? "image/webp" :
                                extension.equals(".jpg") || extension.equals(".jpeg") ? "image/jpeg" : "application/octet-stream";
                            Uri outputUri = DocumentsContract.createDocument(getContext().getContentResolver(), created, mime,
                                "library-" + row.getLong("id") + extension);
                            if (outputUri == null) throw new IOException("Cannot create restored image");
                            MessageDigest digest = MessageDigest.getInstance("SHA-256");
                            long bytes = 0;
                            try (InputStream input = new FileInputStream(source);
                                 OutputStream output = getContext().getContentResolver().openOutputStream(outputUri, "w")) {
                                if (output == null) throw new IOException("Cannot write restored image");
                                byte[] buffer = new byte[32768]; int n;
                                while ((n = input.read(buffer)) != -1) { output.write(buffer, 0, n); digest.update(buffer, 0, n); bytes += n; }
                            }
                            StringBuilder hash = new StringBuilder();
                            for (byte b : digest.digest()) hash.append(String.format(Locale.ROOT, "%02x", b & 255));
                            JSONObject expected = checksums.getJSONObject(asset);
                            if (bytes != expected.getLong("bytes") || !hash.toString().equals(expected.getString("sha256"))) throw new IOException("Restored image checksum mismatch");
                            locations.put("library_images:" + row.getLong("id"), outputUri.toString());
                        }
                    }
                }
                call.resolve(new JSObject().put("locations", locations)
                    .put("folderUri", created == null ? JSONObject.NULL : created.toString()));
            } catch (Exception error) {
                if (created != null) try { DocumentsContract.deleteDocument(getContext().getContentResolver(), created); } catch (Exception ignored) { }
                call.reject("Cannot stage library images", error);
            }
        });
    }
    private static void check(String path, JSONObject checksums, JSONObject entries) throws Exception {
        safePath(path);
        JSONObject expected = checksums.getJSONObject(path), actual = entries.getJSONObject(path);
        if (expected.getLong("bytes") != actual.getLong("bytes") || !expected.getString("sha256").equals(actual.getString("sha256"))) throw new IOException("Backup checksum mismatch: " + path);
    }
    private static byte[] readBytes(File file) throws IOException {
        if (file.length() > 32L * 1024 * 1024) throw new IOException("Backup metadata too large");
        try (InputStream input = new FileInputStream(file); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[32768]; int n;
            while ((n = input.read(buffer)) != -1) output.write(buffer, 0, n);
            return output.toByteArray();
        }
    }
    private static String readText(File file) throws IOException { return new String(readBytes(file), StandardCharsets.UTF_8); }
    private static JSONObject readObject(File file) throws Exception { return new JSONObject(readText(file)); }
    private static void remove(File file) {
        File[] children = file.listFiles();
        if (children != null) for (File child : children) remove(child);
        file.delete();
    }
}
