package net.nais3.mobile;

import android.content.Context;
import android.net.Uri;
import android.os.PowerManager;
import android.os.SystemClock;
import android.provider.DocumentsContract;
import android.util.AtomicFile;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import org.json.JSONArray;
import org.json.JSONObject;

/** Native generation owns its queue and downloaded receipts independently of the WebView. */
final class GenerationEngine {
    interface Observer { void changed(); }
    private static GenerationEngine instance;
    static synchronized GenerationEngine get(Context context) throws Exception {
        if (instance == null) instance = new GenerationEngine(context.getApplicationContext());
        return instance;
    }

    private final Context context;
    private final SecureSnapshot store;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private JSONObject journal;
    private volatile boolean running;
    private volatile boolean stopRequested;
    private volatile HttpURLConnection connection;
    private Observer observer;

    private GenerationEngine(Context context) throws Exception {
        this.context = context;
        store = new SecureSnapshot(context, "queue");
        String stored = store.read();
        journal = stored == null ? new JSONObject().put("version", 1).put("jobs", new JSONArray()) : new JSONObject(stored);
        if (journal.getInt("version") != 1) throw new IllegalStateException("Unsupported queue format");
        boolean recovered = false;
        for (int i = 0; i < jobs().length(); i++) {
            JSONObject job = jobs().getJSONObject(i);
            String state = job.getString("state");
            if (!state.equals("done") && !state.equals("cancelled")) {
                if (!state.equals("pending")) job.put("interrupted", true);
                job.put("state", "pending");
                recovered = true;
            }
        }
        journal.put("recovered", recovered);
        persist();
    }

    private JSONArray jobs() throws Exception { return journal.getJSONArray("jobs"); }
    private void persist() throws Exception { store.write(journal.toString()); }
    synchronized void observe(Observer observer) { this.observer = observer; }
    private void emit() { Observer current = observer; if (current != null) current.changed(); }

    synchronized JSONObject snapshot() throws Exception {
        JSONArray items = new JSONArray();
        JSONArray completed = new JSONArray();
        for (int i = 0; i < jobs().length(); i++) {
            JSONObject job = jobs().getJSONObject(i);
            String state = job.getString("state");
            JSONObject item = new JSONObject().put("id", job.getString("id"))
                .put("request", job.getJSONObject("request"))
                .put("state", state.equals("running") || state.equals("saving") || state.equals("downloaded") ? "generating" : state);
            if (job.has("filePath")) item.put("filePath", job.getString("filePath"));
            if (job.has("error")) item.put("error", job.getString("error"));
            items.put(item);
            if (state.equals("done")) completed.put(new JSONObject(item.toString())
                .put("payloadJson", job.getJSONObject("payload").toString()).put("createdAt", job.getString("createdAt")));
        }
        return new JSONObject().put("items", items).put("running", running).put("delayMs", 600)
            .put("recovered", journal.optBoolean("recovered")).put("completed", completed);
    }

    synchronized JSONArray enqueue(JSONArray incoming) throws Exception {
        if (incoming.length() == 0 || incoming.length() > 1000) throw new IllegalArgumentException("Invalid batch size");
        JSONObject previous = new JSONObject(journal.toString());
        JSONArray ids = new JSONArray();
        try {
            for (int i = 0; i < incoming.length(); i++) {
                JSONObject job = new JSONObject(incoming.getJSONObject(i).toString());
                String id = job.getString("id");
                if (!id.matches("[a-zA-Z0-9-]{1,64}")) throw new IllegalArgumentException("Invalid job id");
                for (int j = 0; j < jobs().length(); j++) if (jobs().getJSONObject(j).getString("id").equals(id)) {
                    throw new IllegalArgumentException("Duplicate job id");
                }
                job.getJSONObject("request");
                job.getJSONObject("payload");
                if (job.getString("token").trim().isEmpty()) throw new IllegalArgumentException("Missing API token");
                requireOutputTree(job.getString("destinationUri"));
                job.put("state", "pending");
                jobs().put(job);
                ids.put(id);
            }
            persist();
        } catch (Exception error) { journal = previous; throw error; }
        emit();
        return ids;
    }

    private Uri requireOutputTree(String value) {
        Uri tree = Uri.parse(value);
        boolean allowed = "content".equals(tree.getScheme()) && DocumentsContract.isTreeUri(tree) &&
            context.getContentResolver().getPersistedUriPermissions().stream()
                .anyMatch(p -> p.getUri().equals(tree) && p.isWritePermission());
        if (!allowed) throw new IllegalStateException("Select an accessible output folder before generating");
        return tree;
    }

    synchronized void cancel(JSONArray ids) throws Exception {
        for (int i = 0; i < jobs().length(); i++) {
            JSONObject job = jobs().getJSONObject(i);
            for (int j = 0; j < ids.length(); j++) if (job.getString("id").equals(ids.getString(j))) {
                if (job.getString("state").equals("pending") || job.getString("state").equals("failed")) job.put("state", "cancelled");
                else if (job.getString("state").equals("running")) {
                    job.put("cancelRequested", true);
                    HttpURLConnection active = connection;
                    if (active != null) active.disconnect();
                }
            }
        }
        persist();
        emit();
    }

    void stop() { stopRequested = true; HttpURLConnection active = connection; if (active != null) active.disconnect(); }

    synchronized void prepareResume() throws Exception {
        if (running) return;
        for (int i = 0; i < jobs().length(); i++) {
            JSONObject job = jobs().getJSONObject(i);
            if (job.getString("state").equals("failed")) job.put("state", "pending");
        }
        persist();
    }

    synchronized void start(Runnable finished) throws Exception {
        if (running) return;
        journal.put("recovered", false);
        persist();
        running = true;
        stopRequested = false;
        executor.execute(() -> {
            PowerManager.WakeLock lock = ((PowerManager) context.getSystemService(Context.POWER_SERVICE))
                .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "NAIS3:Generation");
            try {
                while (!stopRequested) {
                    JSONObject job;
                    synchronized (this) {
                        job = null;
                        for (int i = 0; i < jobs().length(); i++) if (jobs().getJSONObject(i).getString("state").equals("pending")) {
                            job = jobs().getJSONObject(i); break;
                        }
                        if (job == null) break;
                        job.put("state", "running");
                        persist();
                    }
                    lock.acquire(10 * 60 * 1000L);
                    emit();
                    try { execute(job); }
                    catch (Exception error) {
                        synchronized (this) {
                            job.put("state", job.optBoolean("cancelRequested") ? "cancelled" : "failed");
                            job.put("error", error.getMessage() == null ? "Generation interrupted" : error.getMessage());
                            persist();
                        }
                        // Stop the batch after a failure; never blindly repeat a paid request.
                        break;
                    } finally { if (lock.isHeld()) lock.release(); emit(); }
                    SystemClock.sleep(Math.max(600, Math.min(60000, job.optLong("delayMs", 600))));
                }
            } catch (Exception error) { /* Persisted unfinished state is recovered on next launch. */ }
            finally {
                running = false;
                synchronized (this) {
                    try {
                        boolean unfinished = false;
                        for (int i = 0; i < jobs().length(); i++) {
                            String state = jobs().getJSONObject(i).getString("state");
                            if (state.equals("pending") || state.equals("failed")) unfinished = true;
                        }
                        journal.put("recovered", unfinished);
                        persist();
                    } catch (Exception ignored) { }
                }
                if (lock.isHeld()) lock.release();
                emit();
                finished.run();
            }
        });
    }

    private void execute(JSONObject job) throws Exception {
        Uri tree = requireOutputTree(job.getString("destinationUri"));
        File directory = new File(context.getNoBackupFilesDir(), "generation-receipts");
        if (!directory.exists() && !directory.mkdirs()) throw new IllegalStateException("Cannot prepare image receipt");
        AtomicFile receipt = new AtomicFile(new File(directory, job.getString("id") + ".png"));
        if (!receipt.getBaseFile().exists()) {
            HttpURLConnection request = (HttpURLConnection) new URL("https://image.novelai.net/ai/generate-image").openConnection();
            connection = request;
            request.setInstanceFollowRedirects(false);
            request.setConnectTimeout(30000);
            request.setReadTimeout(240000);
            request.setRequestMethod("POST");
            request.setDoOutput(true);
            request.setRequestProperty("Authorization", "Bearer " + job.getString("token"));
            request.setRequestProperty("Content-Type", "application/json");
            try {
                byte[] payload = job.getJSONObject("payload").toString().getBytes(StandardCharsets.UTF_8);
                request.setFixedLengthStreamingMode(payload.length);
                try (OutputStream output = request.getOutputStream()) { output.write(payload); }
                int status = request.getResponseCode();
                if (status < 200 || status >= 300) throw new IllegalStateException("Image API returned HTTP " + status);
                boolean found = false;
                try (ZipInputStream zip = new ZipInputStream(request.getInputStream())) {
                    ZipEntry entry;
                    while ((entry = zip.getNextEntry()) != null) {
                        if (entry.isDirectory() || !entry.getName().toLowerCase(java.util.Locale.ROOT).endsWith(".png")) continue;
                        FileOutputStream output = null;
                        try {
                            output = receipt.startWrite();
                            byte[] buffer = new byte[32768];
                            long total = 0;
                            int count;
                            while ((count = zip.read(buffer)) != -1) {
                                total += count;
                                if (total > 128L * 1024 * 1024) throw new IllegalStateException("Image response too large");
                                output.write(buffer, 0, count);
                            }
                            if (total == 0) throw new IllegalStateException("Empty image response");
                            receipt.finishWrite(output);
                            found = true;
                        } catch (Exception error) { if (output != null) receipt.failWrite(output); throw error; }
                        break;
                    }
                }
                if (!found) throw new IllegalStateException("No image in server response");
            } finally { request.disconnect(); connection = null; }
        }
        synchronized (this) { job.put("state", "downloaded"); persist(); }
        Uri outputUri;
        synchronized (this) {
            if (job.has("outputUri")) outputUri = Uri.parse(job.getString("outputUri"));
            else {
                Uri parent = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
                outputUri = DocumentsContract.createDocument(context.getContentResolver(), parent, "image/png", "nais3-" + job.getString("id") + ".png");
                if (outputUri == null) throw new IllegalStateException("Cannot create output image");
                job.put("outputUri", outputUri.toString());
            }
            job.put("state", "saving");
            persist();
        }
        try (InputStream input = receipt.openRead(); OutputStream output = context.getContentResolver().openOutputStream(outputUri, "rwt")) {
            if (output == null) throw new IllegalStateException("Output folder is unavailable");
            byte[] buffer = new byte[32768]; int count;
            while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
            output.flush();
        }
        synchronized (this) {
            job.put("filePath", outputUri.toString());
            java.text.SimpleDateFormat timestamp = new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.ROOT);
            timestamp.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
            job.put("createdAt", timestamp.format(new java.util.Date()));
            job.put("state", "done");
            job.remove("error");
            job.remove("token");
            persist();
        }
        receipt.delete();
    }
}
