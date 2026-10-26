using System.Diagnostics;
using System.IO.Compression;
using System.Reflection;
using System.Text.Json;

namespace OrgNotes.Capture;

/// <summary>
/// Keeps the Windows app at the version the server offers: every hour, when the server's installer comes from another
/// commit and the capture window is closed, downloads it, quits, and lets a small script swap the files and restart.
/// </summary>
public class Updater(Config config, Func<bool> idle, Action quit)
{
    /// <summary>The commit this build comes from (set by deploy/package.sh), or null for a development build.</summary>
    public static string? Version =>
        Assembly.GetEntryAssembly()?.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion.Split('+') is [_, var rev] ? rev : null;

    public async Task Run()
    {
        if (!OperatingSystem.IsWindows() || Version == null) return;
        await Task.Delay(TimeSpan.FromSeconds(30));
        using var timer = new PeriodicTimer(TimeSpan.FromHours(1));
        do
        {
            if (!Config.Exists || config.Token == "") continue;
            try
            {
                var offered = (await new Api(config).Me()).WindowsVersion;
                if (offered != null && offered != Version && idle()) await Apply();
            }
            // Offline or a broken download: try again in an hour.
            catch (Exception e) when (e is HttpRequestException or TaskCanceledException or JsonException or IOException or InvalidDataException) { }
        } while (await timer.WaitForNextTickAsync());
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
