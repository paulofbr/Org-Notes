using System.Diagnostics;
using System.IO.Compression;
using System.Reflection;
using System.Text.Json;

namespace OrgNotes.Capture;

/// <summary>
/// Keeps the Windows app at the version the server offers: shortly after starting and every 15 minutes (or when asked
/// from the tray), when the server's installer comes from another commit and the capture window is closed, downloads
/// it, quits, and lets a small script swap the files and restart.
/// </summary>
public class Updater(Config config, Func<bool> idle, Action quit)
{
    /// <summary>This build's version (1.0.&lt;commits&gt;, set by deploy/package.sh with the commit), or null for a development build.</summary>
    public static string? Version =>
        Assembly.GetEntryAssembly()?.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion.Split('+') is [var version, _] ? version : null;

    private static string LastRun => Path.Combine(Config.Dir, "version");

    /// <summary>Tells the user, once, that the app now runs a new version (after an update or a new install over an old one).</summary>
    public static void AnnounceUpdate()
    {
        if (Version is not { } version) return;
        try
        {
            var last = File.Exists(LastRun) ? File.ReadAllText(LastRun).Trim() : null;
            if (last == version) return;
            Directory.CreateDirectory(Config.Dir);
            File.WriteAllText(LastRun, version);
            if (last != null) Reminders.Show("Org Notes", L.Tr("Atualizada para v{0}", version));
        }
        catch (IOException)
        {
            // Not worth more than a missed message.
        }
    }

    /// <summary>Whether this build can update itself: an installed Windows build, not a development one.</summary>
    public static bool Supported => OperatingSystem.IsWindows() && Version != null;

    private int _busy;

    public async Task Run()
    {
        if (!Supported) return;
        await Task.Delay(TimeSpan.FromSeconds(30));
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(15));
        do await Check(manual: false);
        while (await timer.WaitForNextTickAsync());
    }

    /// <summary>
    /// Updates when the server offers another version (a manual check does not wait for the capture window to close);
    /// returns what happened, for a manual check to tell the user.
    /// </summary>
    public async Task<string> Check(bool manual)
    {
        if (!Config.Exists || config.Token == "") return L.Tr("Falta configurar o servidor e o token.");
        if (Interlocked.Exchange(ref _busy, 1) == 1) return "";
        try
        {
            var offered = (await new Api(config).Me()).WindowsVersion;
            if (offered == null) return L.Tr("O servidor não tem instalador.");
            if (offered == Version) return L.Tr("Já tens a versão mais recente ({0}).", "v" + Version);
            if (manual || idle()) await Apply();
            return "";
        }
        // Offline or a broken download: the next check tries again.
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException or JsonException or IOException or InvalidDataException)
        {
            return e.Message;
        }
        finally
        {
            Interlocked.Exchange(ref _busy, 0);
        }
    }

    private async Task Apply()
    {
        var work = Path.Combine(Path.GetTempPath(), "orgnotes-update");
        if (Directory.Exists(work)) Directory.Delete(work, true);
        Directory.CreateDirectory(work);
        var zip = Path.Combine(work, "client.zip");
        await new Api(config).DownloadInstaller(zip);
        ZipFile.ExtractToDirectory(zip, work);
        var source = Path.Combine(work, "OrgNotes-client-win-x64", "capture");
        if (!File.Exists(Path.Combine(source, "OrgNotes.Capture.exe"))) return;

        // A running program cannot replace its own files on Windows, so this waits for the app to quit first.
        var script = Path.Combine(work, "update.ps1");
        File.WriteAllText(script, $"""
            Wait-Process -Id {Environment.ProcessId} -ErrorAction SilentlyContinue
            robocopy "{source}" "{AppContext.BaseDirectory.TrimEnd('\\')}" /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
            Start-Process "{Environment.ProcessPath}"
            """);
        Process.Start(new ProcessStartInfo("powershell.exe")
        {
            ArgumentList = { "-NoProfile", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-File", script },
            CreateNoWindow = true,
        })?.Dispose();
        quit();
    }
}
