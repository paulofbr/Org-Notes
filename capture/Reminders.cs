using System.Diagnostics;
using System.Security;
using System.Text;
using System.Text.Json;

namespace OrgNotes.Capture;

/// <summary>
/// Shows the user's agenda reminders natively on this machine (notify-send / Windows toast). The server works them
/// out from the notes; this only asks for them through the API and shows each once, when it is due.
/// </summary>
public class Reminders(Config config)
{
    private record Shown(DateOnly Date, HashSet<string> Ids);

    private static string ShownPath => Path.Combine(Config.Dir, "shown.json");

    public async Task Run()
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(30));
        do
        {
            if (!config.Reminders || !Config.Exists || config.Token == "") continue;
            try { await Check(DateTime.Now); }
            // The server may be unreachable for a while (offline, asleep): try again on the next tick.
            catch (Exception e) when (e is HttpRequestException or TaskCanceledException or JsonException or IOException) { }
        } while (await timer.WaitForNextTickAsync());
    }

    private async Task Check(DateTime now)
    {
        var today = DateOnly.FromDateTime(now);
        var shown = Load() is { } s && s.Date == today ? s : new Shown(today, []);
        var due = (await new Api(config).Reminders(now)).Where(r => r.From <= now && now < r.Until && !shown.Ids.Contains(r.Id)).ToList();
        if (due.Count == 0) return;
        foreach (var r in due)
        {
            Show(r.Title, r.Body);
            shown.Ids.Add(r.Id);
        }
        Directory.CreateDirectory(Config.Dir);
        await File.WriteAllTextAsync(ShownPath, JsonSerializer.Serialize(shown));
    }

    private static Shown? Load()
    {
        try { return File.Exists(ShownPath) ? JsonSerializer.Deserialize<Shown>(File.ReadAllText(ShownPath)) : null; }
        catch (JsonException) { return null; }
    }

    /// <summary>Shows a native notification (also used to answer a manual update check).</summary>
    public static void Show(string title, string body)
    {
        var psi = OperatingSystem.IsWindows() ? WindowsToast(title, body) : new ProcessStartInfo("notify-send") { ArgumentList = { "-a", "Org Notes", title, body } };
        try { Process.Start(psi)?.Dispose(); }
        catch (Exception e) when (e is System.ComponentModel.Win32Exception or InvalidOperationException) { /* no notifier installed */ }
    }

    /// <summary>Toast through Windows PowerShell's WinRT bindings, so no Windows-only package is needed.</summary>
    private static ProcessStartInfo WindowsToast(string title, string body)
    {
        static string Text(string s) => SecurityElement.Escape(s).Replace("'", "''");
        var script = $$"""
            [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
            [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] > $null
            $x = New-Object Windows.Data.Xml.Dom.XmlDocument
            $x.LoadXml('<toast><visual><binding template="ToastGeneric"><text>{{Text(title)}}</text><text>{{Text(body)}}</text></binding></visual></toast>')
            [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe').Show([Windows.UI.Notifications.ToastNotification]::new($x))
            """;
        var encoded = Convert.ToBase64String(Encoding.Unicode.GetBytes(script));
        return new ProcessStartInfo("powershell.exe") { ArgumentList = { "-NoProfile", "-WindowStyle", "Hidden", "-EncodedCommand", encoded }, CreateNoWindow = true };
    }
}
