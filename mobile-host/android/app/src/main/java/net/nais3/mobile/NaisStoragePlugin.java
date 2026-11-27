package net.nais3.mobile;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.OutputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

@CapacitorPlugin(name = "NaisStorage")
public class NaisStoragePlugin extends Plugin {
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private SecureSnapshot snapshot;
    private boolean pickerOpen;

    @Override public void load() { snapshot = new SecureSnapshot(getContext()); }

    private SharedPreferences folders() {
        return getContext().getSharedPreferences("output-folders", 0);
    }

    private String folderKey(PluginCall call) {
        String key = call.getString("key", "");
        if (!key.equals("main") && !key.equals("scene") && !key.equals("library") && !key.equals("export")) {
            throw new IllegalArgumentException("Invalid folder purpose");
        }
        return key;
    }

    @PluginMethod public void readSnapshot(PluginCall call) {
        io.execute(() -> {
            try {
                String value = snapshot.read();
                JSObject result = new JSObject();
                result.put("value", value == null ? JSONObject.NULL : value);
                call.resolve(result);
            } catch (Exception error) { call.reject("Cannot read saved workspace", error); }
        });
    }

    @PluginMethod public void writeSnapshot(PluginCall call) {
        String value = call.getString("value");
        if (value == null) { call.reject("Missing workspace"); return; }
        io.execute(() -> {
            try {
                new JSONObject(value);
                snapshot.write(value);
                call.resolve();
            } catch (Exception error) { call.reject("Cannot save workspace", error); }
        });
    }

    @PluginMethod public void chooseFolder(PluginCall call) {
        try {
            folderKey(call);
            if (pickerOpen) { call.reject("A folder picker is already open"); return; }
            pickerOpen = true;
            Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION |
                Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
            startActivityForResult(call, intent, "folderSelected");
        } catch (Exception error) { pickerOpen = false; call.reject("Cannot open folder picker", error); }
    }

    @ActivityCallback private void folderSelected(PluginCall call, ActivityResult result) {
        pickerOpen = false;
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.resolve(new JSObject().put("cancelled", true));
            return;
        }
        try {
            Intent data = result.getData();
            Uri uri = data.getData();
            int flags = data.getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            String key = folderKey(call);
            if ((flags & Intent.FLAG_GRANT_READ_URI_PERMISSION) == 0 ||
                (!key.equals("library") && (flags & Intent.FLAG_GRANT_WRITE_URI_PERMISSION) == 0)) {
                throw new IllegalStateException("The selected folder does not allow required access");
            }
            getContext().getContentResolver().takePersistableUriPermission(uri, flags);
            // Export location is independent from the configured generation output folders.
            if (!key.equals("export") && !folders().edit().putString(key, uri.toString()).commit()) {
                throw new IllegalStateException("Cannot remember selected folder");
            }
            call.resolve(new JSObject().put("uri", uri.toString()).put("cancelled", false));
        } catch (Exception error) { call.reject("Cannot use selected folder", error); }
    }

    @PluginMethod public void getFolders(PluginCall call) {
        JSObject result = new JSObject();
        for (String key : new String[]{"main", "scene", "library"}) {
            String uri = folders().getString(key, null);
            result.put(key, uri == null ? JSONObject.NULL : uri);
        }
        call.resolve(result);
    }

    private Uri grantedTree(String value, boolean write) {
        if (value == null) throw new IllegalArgumentException("Choose a folder first");
        Uri uri = Uri.parse(value);
        if (!"content".equals(uri.getScheme()) || !DocumentsContract.isTreeUri(uri)) {
            throw new IllegalArgumentException("Expected a selected document folder");
        }
        boolean granted = getContext().getContentResolver().getPersistedUriPermissions().stream()
            .anyMatch(permission -> permission.getUri().equals(uri) && permission.isReadPermission() &&
                (!write || permission.isWritePermission()));
        if (!granted) throw new IllegalStateException("Folder access expired; select the folder again");
        return uri;
    }

    @PluginMethod public void listFolder(PluginCall call) {
        io.execute(() -> {
            try {
                Uri tree = grantedTree(call.getString("uri"), false);
                Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
                JSArray entries = new JSArray();
                String[] columns = { DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                    DocumentsContract.Document.COLUMN_MIME_TYPE, DocumentsContract.Document.COLUMN_SIZE };
                try (Cursor cursor = getContext().getContentResolver().query(children, columns, null, null, null)) {
                    if (cursor == null) throw new IllegalStateException("Folder is unavailable");
                    while (cursor.moveToNext()) {
                        String mime = cursor.getString(2);
                        if (mime == null || !mime.startsWith("image/")) continue;
                        Uri document = DocumentsContract.buildDocumentUriUsingTree(tree, cursor.getString(0));
                        entries.put(new JSObject().put("uri", document.toString()).put("name", cursor.getString(1))
                            .put("mime", mime).put("size", cursor.getLong(3)));
                    }
                }
                call.resolve(new JSObject().put("entries", entries));
            } catch (Exception error) { call.reject("Cannot list selected folder", error); }
        });
    }

    @PluginMethod public void writeImage(PluginCall call) {
        io.execute(() -> {
            Uri created = null;
            try {
                Uri tree = grantedTree(call.getString("uri"), true);
                String name = call.getString("name", "");
                if (name.trim().isEmpty() || name.contains("/") || name.contains("\\") || name.contains("\0")) {
                    throw new IllegalArgumentException("Invalid image filename");
                }
                String data = call.getString("base64");
                if (data == null) throw new IllegalArgumentException("Missing image bytes");
                byte[] bytes = Base64.decode(data, Base64.DEFAULT);
                Uri parent = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
                created = DocumentsContract.createDocument(getContext().getContentResolver(), parent, "image/png", name);
                if (created == null) throw new IllegalStateException("Cannot create image");
                try (OutputStream output = getContext().getContentResolver().openOutputStream(created, "w")) {
                    if (output == null) throw new IllegalStateException("Cannot open image output");
                    output.write(bytes);
                    output.flush();
                }
                call.resolve(new JSObject().put("uri", created.toString()));
            } catch (Exception error) {
                if (created != null) {
                    try { DocumentsContract.deleteDocument(getContext().getContentResolver(), created); }
                    catch (Exception ignored) { /* Retain the original write error. */ }
                }
                call.reject("Cannot save image", error);
            }
        });
    }
}
