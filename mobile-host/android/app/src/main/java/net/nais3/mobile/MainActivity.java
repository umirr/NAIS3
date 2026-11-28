package net.nais3.mobile;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NaisStoragePlugin.class);
        registerPlugin(NaisBackupPlugin.class);
        registerPlugin(NaisGenerationPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
