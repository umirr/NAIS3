package net.nais3.mobile;

import android.Manifest;
import android.content.Intent;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.PermissionState;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import org.json.JSONArray;

@CapacitorPlugin(name = "NaisGeneration", permissions = {
    @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
})
public class NaisGenerationPlugin extends Plugin {
    @Override public void load() {
        try {
            GenerationEngine.get(getContext()).observe(() -> {
                try { notifyListeners("changed", new JSObject(GenerationEngine.get(getContext()).snapshot().toString())); }
                catch (Exception ignored) { }
            });
        } catch (Exception ignored) { /* Methods surface persisted-state failures; never reset silently. */ }
    }
    @PluginMethod public void status(PluginCall call) {
        try { call.resolve(new JSObject(GenerationEngine.get(getContext()).snapshot().toString())); }
        catch (Exception error) { call.reject("Cannot read generation queue", error); }
    }
    @PluginMethod public void enqueue(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") == PermissionState.PROMPT) {
            requestPermissionForAlias("notifications", call, "enqueueAfterPermission");
        } else enqueueAfterPermission(call);
    }
    @PermissionCallback private void enqueueAfterPermission(PluginCall call) {
        try {
            JSONArray jobs = call.getArray("jobs");
            if (jobs == null) throw new IllegalArgumentException("Missing generation jobs");
            JSONArray ids = GenerationEngine.get(getContext()).enqueue(jobs);
            startService();
            call.resolve(new JSObject().put("ids", ids));
        } catch (Exception error) { call.reject("Cannot start generation", error); }
    }
    @PluginMethod public void resume(PluginCall call) {
        try {
            GenerationEngine.get(getContext()).prepareResume();
            startService();
            call.resolve();
        } catch (Exception error) { call.reject("Cannot resume generation", error); }
    }
    @PluginMethod public void cancel(PluginCall call) {
        try {
            JSONArray ids = call.getArray("ids");
            if (ids == null) throw new IllegalArgumentException("Missing job ids");
            GenerationEngine.get(getContext()).cancel(ids);
            call.resolve();
        } catch (Exception error) { call.reject("Cannot cancel generation", error); }
    }
    private void startService() {
        Intent intent = new Intent(getContext(), GenerationService.class);
        if (Build.VERSION.SDK_INT >= 26) getContext().startForegroundService(intent);
        else getContext().startService(intent);
    }
}
