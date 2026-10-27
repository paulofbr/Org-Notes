using System.Diagnostics;
using System.Globalization;
using System.IO.Pipes;
using System.Text.Json;
using Avalonia;

namespace OrgNotes.Capture;

/// <summary>
/// Tray app that shows a capture window. One instance per user: running it again (e.g. from a desktop key binding
/// with `--show`) asks the running instance to show the window and exits.
/// </summary>
public static class Program
{
    public static readonly string PipeName = $"orgnotes-capture-{Environment.UserName}";

    [STAThread]
    public static void Main(string[] args)
    {
        if (TellRunningInstance()) return;
        AppDomain.CurrentDomain.UnhandledException += (_, e) => Log.Write("crash: " + e.ExceptionObject);
        TaskScheduler.UnobservedTaskException += (_, e) => Log.Write("task: " + e.Exception);
        if (OperatingSystem.IsLinux()) SetX11Scale(Config.Load().Scale);
        AppBuilder.Configure(() => new App(showOnStart: args.Contains("--show")))
            .UsePlatformDetect()
            .StartWithClassicDesktopLifetime(args, Avalonia.Controls.ShutdownMode.OnExplicitShutdown);
    }

    /// <summary>
    /// Avalonia runs under XWayland, which does not report HiDPI scales; pass them on so the window is not tiny.
    /// </summary>
    private static void SetX11Scale(double scale)
    {
        if (Environment.GetEnvironmentVariable("AVALONIA_GLOBAL_SCALE_FACTOR") != null || Environment.GetEnvironmentVariable("AVALONIA_SCREEN_SCALE_FACTORS") != null) return;
        if (scale > 0)
        {
            Environment.SetEnvironmentVariable("AVALONIA_GLOBAL_SCALE_FACTOR", scale.ToString(CultureInfo.InvariantCulture));
            return;
        }
        if (Environment.GetEnvironmentVariable("HYPRLAND_INSTANCE_SIGNATURE") == null) return;
        try
        {
            using var p = Process.Start(new ProcessStartInfo("hyprctl", "monitors -j") { RedirectStandardOutput = true })!;
            using var doc = JsonDocument.Parse(p.StandardOutput.ReadToEnd());
            var factors = doc.RootElement.EnumerateArray()
                .Select(m => $"{m.GetProperty("name").GetString()}={m.GetProperty("scale").GetDouble().ToString(CultureInfo.InvariantCulture)}");
            Environment.SetEnvironmentVariable("AVALONIA_SCREEN_SCALE_FACTORS", string.Join(';', factors));
        }
        catch (Exception e) when (e is System.ComponentModel.Win32Exception or JsonException or InvalidOperationException)
        {
            // No hyprctl: keep Avalonia's default.
        }
    }

    private static bool TellRunningInstance()
    {
        try
        {
            using var client = new NamedPipeClientStream(".", PipeName, PipeDirection.Out);
            client.Connect(200);
            client.WriteByte(1);
            return true;
        }
        catch (Exception e) when (e is TimeoutException or IOException)
        {
            return false;
        }
    }
}
