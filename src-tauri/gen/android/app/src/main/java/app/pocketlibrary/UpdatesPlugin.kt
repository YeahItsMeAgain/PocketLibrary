package app.pocketlibrary

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File

@InvokeArg
class InstallApkArgs {
  lateinit var path: String
}

/**
 * Opens Android's package installer for an APK already verified by Rust.
 *
 * The app never installs silently: the system installer shows its own consent
 * screen, and Android additionally requires the user to allow "install unknown
 * apps" for PocketLibrary. That setting is opened here on first use.
 */
@TauriPlugin
class UpdatesPlugin(private val activity: Activity) : Plugin(activity) {
  @Command
  fun installApk(invoke: Invoke) {
    val args = try {
      invoke.parseArgs(InstallApkArgs::class.java)
    } catch (error: Exception) {
      invoke.reject("The update path is invalid.", "installFailed")
      return
    }

    try {
      val apk = File(args.path)
      if (!apk.isFile) {
        invoke.reject("The downloaded update is missing. Download it again.", "missingApk")
        return
      }

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
        !activity.packageManager.canRequestPackageInstalls()
      ) {
        val settings = Intent(
          Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
          Uri.parse("package:${activity.packageName}")
        )
        activity.startActivity(settings)
        invoke.reject(
          "Allow PocketLibrary to install unknown apps, then tap Install again.",
          "installPermission"
        )
        return
      }

      val uri = FileProvider.getUriForFile(
        activity,
        "${activity.packageName}.fileprovider",
        apk
      )
      val intent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(uri, "application/vnd.android.package-archive")
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      activity.startActivity(intent)

      val result = JSObject()
      result.put("started", true)
      invoke.resolve(result)
    } catch (error: Exception) {
      invoke.reject(
        error.message ?: "Android could not open the package installer.",
        "installFailed"
      )
    }
  }
}
